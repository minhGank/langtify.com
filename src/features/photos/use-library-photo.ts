import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { PhotoGateway } from '@/services/submissions';
import { pickLibraryPhoto, PhotoLibraryError } from './pick-library-photo';
import { preparePhoto, type PreparedPhoto } from './photo-files';

// Native picker presentation may temporarily make iOS inactive. Keep its result
// in this screen's operation, and wait for foreground before installing a draft.
function foreground(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('cancelled'));
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      listener.remove();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      finish();
      reject(new Error('cancelled'));
    };
    const listener = AppState.addEventListener('change', (value) => {
      if (value === 'active') {
        finish();
        resolve();
      }
    });
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function useLibraryPhoto({
  gateway,
  userId,
  assignmentId,
  enabled,
  eligibilityRevision,
  onPrepared,
  remove,
}: {
  gateway: PhotoGateway;
  userId: string;
  assignmentId: string;
  enabled: boolean;
  eligibilityRevision?: unknown;
  onPrepared: (photo: PreparedPhoto) => void;
  remove: (uri: string) => void;
}) {
  const operation = useRef<AbortController | null>(null);
  const scope = useMemo(
    () => ({ gateway, enabled, userId, assignmentId }),
    [gateway, enabled, userId, assignmentId],
  );
  const [eligibilityAttempt, setEligibilityAttempt] = useState(0);
  const eligibilityKey = useMemo(
    () => ({ scope, eligibilityRevision, eligibilityAttempt }),
    [scope, eligibilityRevision, eligibilityAttempt],
  );
  const [eligibility, setEligibility] = useState({
    key: eligibilityKey,
    available: false,
    error: '',
  });
  const eligibilityRequest = useRef<AbortController | null>(null);
  const retryQueued = useRef(false);
  const available = eligibility.key === eligibilityKey && eligibility.available;
  const eligibilityError = eligibility.key === eligibilityKey ? eligibility.error : '';
  const [interaction, setInteraction] = useState({
    scope,
    busy: false,
    error: '',
    permissionDenied: false,
  });
  const status =
    interaction.scope === scope ? interaction : { busy: false, error: '', permissionDenied: false };
  const lifetime = useRef<{ scope: typeof scope; controller: AbortController } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = { scope, controller };
    return () => {
      controller.abort();
      operation.current?.abort();
      operation.current = null;
    };
  }, [scope]);
  useEffect(() => {
    const controller = new AbortController();
    eligibilityRequest.current = controller;
    retryQueued.current = false;
    void (async () => {
      if (!enabled) return;
      try {
        const allowed = await gateway.canChooseLibraryPhoto(controller.signal);
        if (!controller.signal.aborted)
          setEligibility({ key: eligibilityKey, available: allowed, error: '' });
      } catch {
        if (!controller.signal.aborted)
          setEligibility({
            key: eligibilityKey,
            available: false,
            error:
              'We couldn’t check whether you can add a photo. Check your connection and try again.',
          });
      } finally {
        if (eligibilityRequest.current === controller) eligibilityRequest.current = null;
      }
    })();
    return () => {
      controller.abort();
      if (eligibilityRequest.current === controller) eligibilityRequest.current = null;
    };
  }, [gateway, enabled, eligibilityKey]);

  const retryEligibility = () => {
    const parent = lifetime.current;
    if (
      !enabled ||
      !eligibilityError ||
      operation.current ||
      eligibilityRequest.current ||
      retryQueued.current ||
      !parent ||
      parent.scope !== scope ||
      parent.controller.signal.aborted
    )
      return;
    retryQueued.current = true;
    setEligibilityAttempt((previous) => previous + 1);
  };

  const choose = async () => {
    const parent = lifetime.current;
    if (
      !enabled ||
      !available ||
      operation.current ||
      !parent ||
      parent.scope !== scope ||
      parent.controller.signal.aborted
    )
      return;
    const controller = new AbortController();
    operation.current = controller;
    const current = () => !controller.signal.aborted && !parent.controller.signal.aborted;
    setInteraction({ scope, busy: true, error: '', permissionDenied: false });
    let draft: PreparedPhoto | undefined;
    try {
      // Launch synchronously from the button so web retains user activation.
      const selected = await pickLibraryPhoto();
      if (!selected || !current()) return;
      await foreground(controller.signal);
      if (!(await gateway.canChooseLibraryPhoto(controller.signal))) {
        if (current()) {
          setEligibility({ key: eligibilityKey, available: false, error: '' });
          setInteraction({
            scope,
            busy: true,
            error: 'You can’t add a photo to this word right now. Refresh Today or Past Words.',
            permissionDenied: false,
          });
        }
        return;
      }
      if (!current()) return;
      const prepared = await preparePhoto(selected, userId, assignmentId, current, {
        removeSource: false,
        source: 'library',
      });
      draft = prepared;
      await foreground(controller.signal);
      if (!current()) return;
      onPrepared(prepared);
      draft = undefined;
    } catch (cause) {
      if (current()) {
        setInteraction({
          scope,
          busy: true,
          error:
            cause instanceof PhotoLibraryError
              ? cause.message
              : 'We couldn’t prepare this photo. Try again or choose another.',
          permissionDenied: cause instanceof PhotoLibraryError && cause.code === 'permission',
        });
      }
    } finally {
      if (draft) remove(draft.uri);
      if (current())
        setInteraction((previous) =>
          previous.scope === scope ? { ...previous, busy: false } : previous,
        );
      if (operation.current === controller) operation.current = null;
    }
  };
  return {
    available: enabled && available,
    busy: status.busy,
    error: status.error,
    permissionDenied: status.permissionDenied,
    eligibilityError,
    retryEligibility,
    choose,
  };
}
