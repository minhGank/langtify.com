import type { Session } from '@supabase/supabase-js';
import { authSessionId } from '@/lib/auth-session-storage';
import { callbackCode, isCallbackUrl, validateAuthorizeUrl } from './callback';

export type PendingLogin = {
  id: string;
  createdAt: number;
  redirect: string;
  flowId?: string;
  phase: 'preparing' | 'waiting' | 'exchanging' | 'committing' | 'cancelled';
  candidateUserId?: string;
  candidateSessionId?: string;
};
export type OAuthState = { busy: boolean; message: string; receiving: boolean };
export type OAuthAttempt = {
  authorize: (redirect: string) => Promise<{ url: string; flowId: string }>;
  exchange: (code: string, flowId: string) => Promise<Session>;
  clear: () => Promise<void>;
};
export type OAuthPorts = {
  apiUrl: string;
  redirect: () => string;
  randomId: () => string;
  now: () => number;
  begin?: (id: string) => void;
  isCurrent?: (id: string) => boolean;
  invalidate?: (id: string) => void;
  read: () => Promise<PendingLogin | null>;
  write: (pending: PendingLogin) => Promise<void>;
  remove: (id: string) => Promise<void>;
  attempt: (id: string) => OAuthAttempt;
  session: () => Promise<Session | null>;
  install: (
    session: Session,
    current: () => boolean,
    finish: () => Promise<void>,
    retain: () => Promise<void>,
  ) => Promise<void>;
  browser: (url: string, redirect: string) => Promise<{ type: string; url?: string }>;
  dismiss: () => void;
};
const idle: OAuthState = { busy: false, message: '', receiving: false };
const failure = 'Google sign-in could not be completed. Please try again.';
const lifetime = 10 * 60 * 1000;
export class OAuthCoordinator {
  private state = idle;
  private listeners = new Set<() => void>();
  private active: PendingLogin | null = null;
  private generation = 0;
  private handling: { generation: number; promise: Promise<void> } | null = null;
  constructor(private ports: OAuthPorts) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(next: OAuthState) {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
  private async clear(pending: PendingLogin | null) {
    const saved = pending ? await this.ports.read() : null;
    if (
      saved?.id === pending?.id &&
      saved?.phase === 'committing' &&
      pending?.phase !== 'committing'
    )
      return;
    if (pending) await this.ports.attempt(pending.id).clear();
    if (pending) await this.ports.remove(pending.id);
  }
  // Invalidate synchronously, before waiting for storage/network cleanup.
  cancel = async (message = 'Google sign-in cancelled.') => {
    const cancelled = ++this.generation;
    let pending = this.active;
    this.active = null;
    this.ports.dismiss();
    this.update({ ...idle, message });
    // Cold callbacks also have a durable record, even before it is read into memory.
    if (!pending) pending = await this.ports.read();
    if (cancelled !== this.generation) return;
    if (pending) this.ports.invalidate?.(pending.id);
    // A committing marker survives until guarded installation has cleaned up.
    if (pending && pending.phase !== 'committing') {
      pending = { ...pending, phase: 'cancelled' };
      // A failed deletion must not make a cancelled flow valid after restart.
      try {
        await this.ports.write(pending);
      } catch {
        await this.clear(pending);
        return;
      }
      await this.clear(pending);
    }
  };
  accountChanged = () => {
    void this.cancel('').catch(() => {});
  };
  releaseScreen = () => {
    if (this.state.busy && !this.state.receiving) this.accountChanged();
  };
  start = async () => {
    if (this.state.busy) return;
    this.update({ busy: true, message: '', receiving: false });
    const request = ++this.generation;
    let pending: PendingLogin | null = null;
    try {
      if (await this.ports.session()) throw new Error('already_authenticated');
      if (request !== this.generation) return;
      const old = await this.ports.read();
      if (request !== this.generation) return;
      await this.clear(old);
      if (request !== this.generation) return;
      pending = {
        id: this.ports.randomId(),
        createdAt: this.ports.now(),
        redirect: this.ports.redirect(),
        phase: 'preparing',
      };
      this.active = pending;
      this.ports.begin?.(pending.id);
      await this.ports.write(pending);
      if (request !== this.generation) return;
      const result = await this.ports.attempt(pending.id).authorize(pending.redirect);
      if (request !== this.generation) {
        await this.ports.attempt(pending.id).clear();
        return;
      }
      const url = validateAuthorizeUrl(result.url, this.ports.apiUrl, pending.redirect);
      pending = { ...pending, flowId: result.flowId, phase: 'waiting' };
      this.active = pending;
      await this.ports.write(pending);
      if (request !== this.generation) return;
      const returned = await this.ports.browser(url, pending.redirect);
      if (request !== this.generation || this.state.receiving) return;
      if (returned.type === 'success' && returned.url) {
        if (!isCallbackUrl(returned.url, pending.redirect)) throw new Error('invalid_return');
        await this.receive(returned.url);
      } else await this.cancel();
    } catch {
      if (request === this.generation) {
        await this.cancel(failure).catch(() => {});
      }
    } finally {
      if (pending && request !== this.generation && pending.phase !== 'committing') {
        await this.clear(pending).catch(() => {});
      }
    }
  };
  receive = (url: string): Promise<void> => {
    // Only exact callbacks can consume a pending attempt. Never accept URL tokens.
    if (!isCallbackUrl(url, this.ports.redirect())) return Promise.resolve();
    if (this.handling?.generation === this.generation) return this.handling.promise;
    this.update({ busy: true, message: '', receiving: true });
    const request = this.generation;
    const promise = this.complete(url, request).finally(() => {
      if (this.handling?.promise === promise) this.handling = null;
    });
    this.handling = { generation: request, promise };
    return promise;
  };
  private async complete(url: string, request: number) {
    let pending: PendingLogin | null = null;
    try {
      pending = this.active ?? (await this.ports.read());
      if (request !== this.generation) return;
      if (
        !pending ||
        pending.redirect !== this.ports.redirect() ||
        pending.phase !== 'waiting' ||
        !pending.flowId ||
        this.ports.isCurrent?.(pending.id) === false ||
        this.ports.now() - pending.createdAt > lifetime ||
        pending.createdAt > this.ports.now()
      )
        throw new Error('expired_callback');
      const code = callbackCode(url, pending.redirect);
      const flowId = pending.flowId;
      if (await this.ports.session()) throw new Error('account_changed');
      if (request !== this.generation) return;
      pending = { ...pending, phase: 'exchanging' };
      this.active = pending;
      await this.ports.write(pending); // durable one-time claim, before the network
      if (request !== this.generation) return;
      const candidate = await this.ports.attempt(pending.id).exchange(code, flowId);
      if (request !== this.generation) return;
      const candidateSessionId = authSessionId(candidate.access_token);
      if (!candidateSessionId) throw new Error('Invalid Auth session.');
      pending = {
        ...pending,
        phase: 'committing',
        candidateUserId: candidate.user.id,
        candidateSessionId,
      };
      this.active = pending;
      await this.ports.write(pending);
      const owned = pending;
      await this.ports.install(
        candidate,
        () => request === this.generation && this.ports.isCurrent?.(owned.id) !== false,
        () => this.clear(owned),
        () => this.ports.write(owned),
      );
      if (request === this.generation) {
        this.active = null;
        this.update(idle);
        this.ports.dismiss();
      }
    } catch {
      if (request === this.generation) this.update({ ...idle, message: failure });
    } finally {
      if (
        pending &&
        pending.phase !== 'committing' &&
        (!this.active || this.active.id === pending.id)
      ) {
        await this.clear(pending).catch(() => {});
        if (this.active?.id === pending.id) this.active = null;
      }
    }
  }
}
