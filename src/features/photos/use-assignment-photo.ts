import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssignmentPhoto, PhotoGateway, Visibility } from '@/services/submissions';
import type { PreparedPhoto } from './photo-files';

export type DraftStore = {
  load: () => Promise<PreparedPhoto | null>;
  remove: (uri?: string) => void;
};
const cancelled = new Error('Photo operation cancelled.');
export function photoError(error: unknown) {
  const message =
    typeof error === 'object' && error !== null && 'message' in error ? error.message : '';
  if (message === 'upload_expired')
    return 'This upload expired. Discard it, then take a new photo.';
  if (message === 'assignment_unavailable')
    return 'This word is no longer available. Return to Today and refresh.';
  if (message === 'review_uploaded_photo')
    return 'An uploaded photo was recovered. Review it before submitting.';
  return 'We could not finish this action. Check your connection and refresh to recover the saved state.';
}
export function useAssignmentPhoto(gateway: PhotoGateway, drafts: DraftStore) {
  const [data, setData] = useState<AssignmentPhoto | null>(null);
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [remoteUri, setRemoteUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [isPublic, setPublic] = useState(false);
  const currentGateway = useRef(gateway),
    alive = useRef(true),
    working = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current = generation.current + 1;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (!alive.current || working.current) return;
    const request = ++generation.current;
    setLoading(true);
    try {
      const fresh = await currentGateway.current.load();
      const saved = fresh.submission;
      const uri =
        saved && saved.status !== 'deleted' ? await currentGateway.current.preview(saved) : null;
      const local =
        saved?.status === 'completed' || saved?.status === 'deleting' ? null : await drafts.load();
      if (!alive.current || request !== generation.current) return;
      setData(fresh);
      setRemoteUri(uri);
      if (saved?.status === 'completed' || saved?.status === 'deleting') {
        drafts.remove();
        setPhoto(null);
      } else setPhoto((previous) => local ?? previous);
      if (saved?.status === 'completed') setPublic(saved.visibility === 'public');
      setError('');
    } catch (cause) {
      if (alive.current && request === generation.current) {
        setError(photoError(cause));
        setRemoteUri(null);
      }
    } finally {
      if (alive.current && request === generation.current) setLoading(false);
    }
  }, [drafts]);
  useEffect(() => {
    currentGateway.current = gateway;
    void refresh();
  }, [gateway, refresh]);
  const run = useCallback(
    async (action: (check: () => void) => Promise<void>) => {
      if (!alive.current || working.current) return;
      working.current = true;
      generation.current = generation.current + 1;
      setBusy(true);
      setError('');
      const check = () => {
        if (!alive.current) throw cancelled;
      };
      let failure = '';
      try {
        await action(check);
      } catch (cause) {
        if (cause !== cancelled) failure = photoError(cause);
      } finally {
        working.current = false;
        if (alive.current) {
          setBusy(false);
          await refresh();
          if (alive.current && failure) setError(failure);
        }
      }
    },
    [refresh],
  );
  const submit = () =>
    run(async (check) => {
      const saved = await currentGateway.current.reserve();
      check();
      if (saved.status === 'completed') return;
      if (saved.status !== 'pending') throw new Error('submission_unavailable');
      const existing = await currentGateway.current.preview(saved);
      check();
      if (existing) {
        // Never finalize another device's upload before showing that actual image.
        if (!remoteUri || data?.submission?.id !== saved.id)
          throw new Error('review_uploaded_photo');
      } else {
        if (!photo) throw new Error('No photo to upload.');
        await currentGateway.current.upload(saved, photo.bytes);
        check();
      }
      await currentGateway.current.finalize(saved.id, isPublic ? 'public' : 'private');
      check();
      drafts.remove();
      setPhoto(null);
    });
  const changeVisibility = (visibility: Visibility) =>
    run(async (check) => {
      if (!data?.submission) return;
      await currentGateway.current.visibility(data.submission.id, visibility);
      check();
    });
  const deletePhoto = () =>
    run(async (check) => {
      if (data?.submission) {
        const saved = await currentGateway.current.beginDelete(data.submission.id);
        check();
        if (saved.status !== 'deleted') {
          await currentGateway.current.removeObject(saved);
          check();
          await currentGateway.current.finishDelete(saved.id);
          check();
        }
      }
      drafts.remove();
      setPhoto(null);
      setRemoteUri(null);
      setPublic(false);
    });
  const acceptPhoto = (prepared: PreparedPhoto) => {
    if (!alive.current) {
      drafts.remove(prepared.uri);
      return;
    }
    generation.current++;
    setLoading(false);
    setPhoto(prepared);
    setPublic(false);
    setError('');
  };
  const retake = () => {
    generation.current++;
    setLoading(false);
    drafts.remove();
    setPhoto(null);
    setPublic(false);
  };
  return {
    data,
    photo,
    remoteUri,
    loading,
    busy,
    error,
    isPublic,
    setPublic,
    refresh,
    submit,
    changeVisibility,
    deletePhoto,
    acceptPhoto,
    retake,
  };
}
