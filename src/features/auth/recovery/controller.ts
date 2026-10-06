import { callbackCode } from '../oauth/callback';
import { authErrorCode } from '../errors';
import { passwordRejection, validateSignupPassword } from '../password-policy';
import { recoveryRedirect, type RecoveryClient } from './client';

export type RecoveryState = {
  phase:
    | 'idle'
    | 'requesting'
    | 'sent'
    | 'receiving'
    | 'ready'
    | 'updating'
    | 'success'
    | 'error'
    | 'failed';
  message: string;
};
type Pending = { id: string; createdAt: number; phase: 'waiting' | 'exchanging' };
type Ports = {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  client: (id: string) => RecoveryClient;
  current: (id: string) => boolean;
  signedIn: () => Promise<boolean>;
  now: () => number;
};
const invalidLink = 'This reset link is invalid or has expired. Request a new one from this app.';
export class RecoveryController {
  private state: RecoveryState = { phase: 'idle', message: '' };
  private listeners = new Set<() => void>();
  private generation = 0;
  private active: { pending: Pending; client: RecoveryClient } | null = null;
  private receiving: Promise<boolean> | null = null;
  constructor(private ports: Ports) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(phase: RecoveryState['phase'], message = '') {
    this.state = { phase, message };
    this.listeners.forEach((listener) => listener());
  }
  private async pending(): Promise<Pending | null> {
    const raw = await this.ports.read();
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      if (
        typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        typeof value.id === 'string' &&
        /^[a-f0-9-]{36}$/.test(value.id) &&
        'createdAt' in value &&
        typeof value.createdAt === 'number' &&
        Number.isFinite(value.createdAt) &&
        'phase' in value &&
        (value.phase === 'waiting' || value.phase === 'exchanging')
      )
        return { id: value.id, createdAt: value.createdAt, phase: value.phase };
    } catch {
      /* Invalid local state cannot authorize recovery. */
    }
    return null;
  }
  cancel = async (preserveState = false) => {
    const generation = ++this.generation;
    const active = this.active;
    this.active = null;
    if (!preserveState) this.set('idle');
    const pending = active?.pending ?? (await this.pending());
    try {
      try {
        if (pending && (await this.pending())?.id === pending.id)
          await this.ports.remove(pending.id);
      } finally {
        if (pending) await (active?.client ?? this.ports.client(pending.id)).clear();
      }
    } catch (error) {
      if (preserveState && generation === this.generation)
        this.set(
          'failed',
          'We couldn’t finish clearing recovery. Return to Sign in and try your new password.',
        );
      throw error;
    }
    return generation;
  };
  async request(email: string, id: string) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      throw new Error('Enter a valid email address.');
    const generation = ++this.generation;
    this.set('requesting');
    const pending: Pending = { id, createdAt: this.ports.now(), phase: 'waiting' };
    const client = this.ports.client(id);
    this.active = { pending, client };
    try {
      if (await this.ports.signedIn()) throw new Error('Session changed');
      if (generation !== this.generation || !this.ports.current(id))
        throw new Error('Session changed');
      await this.ports.write(JSON.stringify(pending));
      if (generation !== this.generation || !this.ports.current(id))
        throw new Error('Session changed');
      try {
        await client.request(email.trim());
      } catch (error) {
        if (!['user_not_found', 'email_not_found'].includes(String(authErrorCode(error))))
          throw error;
      }
      if (generation !== this.generation || !this.ports.current(id))
        throw new Error('Session changed');
      this.set(
        'sent',
        'If an account can use this email, we’ll send a password reset link. Check your inbox and spam folder. Open the link on this device.',
      );
    } catch (error) {
      if (generation === this.generation) {
        const cancelled = await this.cancel();
        if (cancelled !== this.generation) return;
        this.set(
          'error',
          ['over_request_rate_limit', 'over_email_send_rate_limit'].includes(
            String(authErrorCode(error)),
          )
            ? 'Too many requests. Try again later.'
            : 'We couldn’t request a reset email. Check your connection and try again.',
        );
      }
    } finally {
      if (generation !== this.generation) await client.clear();
    }
  }
  receive(url: string): Promise<boolean> {
    if (this.receiving) return this.receiving;
    const work = this.complete(url).finally(() => {
      if (this.receiving === work) this.receiving = null;
    });
    this.receiving = work;
    return work;
  }
  private async complete(url: string): Promise<boolean> {
    const generation = this.generation;
    const pending = this.active?.pending ?? (await this.pending());
    if (!pending) return false;
    if (generation !== this.generation) return true;
    if (['ready', 'updating', 'success'].includes(this.state.phase)) return true;
    const client = this.active?.client ?? this.ports.client(pending.id);
    this.active = { pending, client };
    this.set('receiving');
    const current = () => generation === this.generation && this.ports.current(pending.id);
    try {
      if (
        !current() ||
        pending.phase !== 'waiting' ||
        this.ports.now() - pending.createdAt > 3600000 ||
        pending.createdAt > this.ports.now() ||
        (await this.ports.signedIn())
      )
        throw new Error('Invalid recovery');
      const code = callbackCode(url, recoveryRedirect);
      pending.phase = 'exchanging';
      await this.ports.write(JSON.stringify(pending));
      if (!current()) throw new Error('Session changed');
      await client.exchange(code);
      if (!current()) throw new Error('Session changed');
      this.set('ready');
    } catch {
      if (generation === this.generation) {
        const cancelled = await this.cancel();
        if (cancelled !== this.generation) return true;
        this.set('error', invalidLink);
      }
    } finally {
      if (!current()) await client.clear();
    }
    return true;
  }
  async update(password: string) {
    if (this.state.phase !== 'ready' || !this.active) return;
    const policy = validateSignupPassword(password);
    if (policy) {
      this.set('ready', policy);
      return;
    }
    const generation = this.generation;
    const { pending, client } = this.active;
    const current = () => generation === this.generation && this.ports.current(pending.id);
    this.set('updating');
    try {
      if (!current() || (await this.ports.signedIn())) throw new Error('Session changed');
      if (!current()) throw new Error('Session changed');
      await client.update(password);
      if (!current()) throw new Error('Session changed');
      const cancelled = await this.cancel(true);
      if (cancelled !== this.generation) return;
      this.set('success', 'Your password has been updated. Sign in with your new password.');
    } catch (error) {
      if (generation !== this.generation) return;
      const policy = passwordRejection(error);
      if (policy || authErrorCode(error) === 'same_password') {
        this.set('ready', policy ?? 'Choose a password different from your current password.');
      } else {
        const cancelled = await this.cancel(true);
        if (cancelled !== this.generation) return;
        this.set(
          'failed',
          'We couldn’t confirm the password change. Try signing in with your new password, or request a new reset link.',
        );
      }
    }
  }
}
