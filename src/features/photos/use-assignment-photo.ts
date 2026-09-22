import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssignmentPhoto, PhotoGateway, Visibility } from '@/services/submissions';
import type { PreparedPhoto } from './photo-files';
import { createServerCache, isolatedCacheKey } from '@/lib/server-cache';

const assignments = createServerCache<AssignmentPhoto>({ maxEntries: 12 });

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
  if (
    [
      'photo_capture_unavailable',
      'capture_kind_conflict',
      'historical_assignment_required',
      'past_word_requires_historical_capture',
    ].includes(String(message))
  )
    return 'This word is not available for a new photo in this view. Return to Today or Past Words to refresh.';
  return 'We could not finish this action. Check your connection and refresh to recover the saved state.';
}
export function useAssignmentPhoto(gateway: PhotoGateway, drafts: DraftStore, visible = true) {
  const key = gateway.cacheKey ?? isolatedCacheKey(gateway);
  const entry = useMemo(
    () => assignments.entry(key, ['owner-photo', 'vocabulary', 'unfinished-photos', 'media']),
    [key],
  );
  const [data, setData] = useState<AssignmentPhoto | null>(() => entry.getSnapshot().data);
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [remoteUri, updateRemoteUri] = useState<string | null>(() => {
    const saved = entry.getSnapshot().data?.submission;
    return saved ? (gateway.cachedPreview?.(saved) ?? null) : null;
  });
  const currentRemoteUri = useRef(remoteUri);
  const setRemoteUri = useCallback((uri: string | null) => {
    currentRemoteUri.current = uri;
    updateRemoteUri(uri);
  }, []);
  const [loading, setLoading] = useState(!data);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [isPublic, setPublic] = useState(data?.submission?.visibility === 'public');
  const visibleRef = useRef(visible),
    currentData = useRef<AssignmentPhoto | null>(data);
  const reading = useRef(false);
  const pendingRefresh = useRef(false);
  const previewRequest = useRef<AbortController | null>(null);
  const currentGateway = useRef(gateway),
    alive = useRef(true),
    working = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current = generation.current + 1;
      previewRequest.current?.abort();
    };
  }, []);
  const refresh = useCallback(
    async function readPhoto(force = true): Promise<void> {
      if (!alive.current || !visibleRef.current || working.current || reading.current) return;
      reading.current = true;
      pendingRefresh.current = false;
      const request = ++generation.current;
      const controller = new AbortController();
      previewRequest.current = controller;
      setLoading(true);
      try {
        await entry.read((signal) => currentGateway.current.load(signal), {
          staleTime: Infinity,
          force,
          discardOnError: () => true,
        });
        if (!alive.current || request !== generation.current) return;
        const snapshot = entry.getSnapshot();
        const fresh = snapshot.data;
        if (!fresh || snapshot.error || snapshot.retired) throw new Error('Photo unavailable.');
        const saved = fresh.submission;
        const uri =
          saved && saved.status !== 'deleted'
            ? await currentGateway.current.preview(saved, controller.signal)
            : null;
        const local =
          saved?.status === 'completed' || saved?.status === 'deleting'
            ? null
            : await drafts.load();
        if (!alive.current || request !== generation.current || pendingRefresh.current) return;
        currentData.current = fresh;
        setData(fresh);
        // preview() returns already downloaded, session-scoped pixels. It never
        // exposes a signed capability to the Image component or starts a timer.
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
        if (alive.current && request === generation.current) {
          reading.current = false;
          previewRequest.current = null;
          setLoading(false);
          if (pendingRefresh.current && visibleRef.current && !working.current)
            void readPhoto(false);
        }
      }
    },
    [drafts, entry, setRemoteUri],
  );
  useEffect(() => {
    let invalidation = entry.getSnapshot().invalidation;
    const unsubscribe = entry.subscribe(() => {
      const snapshot = entry.getSnapshot();
      if (snapshot.invalidation !== invalidation) {
        invalidation = snapshot.invalidation;
        setRemoteUri(null);
        if (snapshot.retired) {
          generation.current++;
          previewRequest.current?.abort();
          reading.current = false;
          currentData.current = null;
          setData(null);
        } else if (reading.current || working.current) pendingRefresh.current = true;
        else if (visibleRef.current) void refresh(false);
      }
    });
    return unsubscribe;
  }, [entry, refresh, setRemoteUri]);
  useEffect(() => {
    if (visible) return entry.retain();
  }, [entry, visible]);
  useEffect(() => {
    currentGateway.current = gateway;
    generation.current++;
    previewRequest.current?.abort();
    reading.current = false;
    const status = entry.getSnapshot().data?.submission?.status;
    const revision = generation.current;
    void Promise.resolve().then(() => {
      if (alive.current && generation.current === revision)
        void refresh(status === 'pending' || status === 'deleting');
    });
  }, [gateway, refresh, entry]);
  useEffect(() => {
    visibleRef.current = visible;
    if (visible) {
      const status = currentData.current?.submission?.status;
      const revision = generation.current;
      void Promise.resolve().then(() => {
        if (!alive.current || generation.current !== revision) return;
        if (status === 'pending' || status === 'deleting') void refresh();
        else if (
          !currentData.current ||
          !Number.isFinite(entry.getSnapshot().updatedAt) ||
          (status === 'completed' && !currentRemoteUri.current)
        )
          void refresh(false);
      });
    } else {
      generation.current++;
      previewRequest.current?.abort();
      reading.current = false;
      const revision = generation.current;
      void Promise.resolve().then(() => {
        if (alive.current && generation.current === revision) setLoading(false);
      });
    }
  }, [visible, refresh, entry]);
  const run = useCallback(
    async (action: (check: () => void) => Promise<void>) => {
      if (!alive.current || working.current) return;
      working.current = true;
      reading.current = false;
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
        // Revalidate server-owned daily/historical admission for a restored
        // library draft. Already-uploaded recovery never uploads another object.
        if (photo.source === 'library' && !(await currentGateway.current.canChooseLibraryPhoto()))
          throw new Error('photo_capture_unavailable');
        check();
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
    reading.current = false;
    previewRequest.current?.abort();
    setLoading(false);
    setPhoto(prepared);
    setPublic(false);
    setError('');
  };
  const retake = () => {
    generation.current++;
    reading.current = false;
    previewRequest.current?.abort();
    setLoading(false);
    drafts.remove();
    setPhoto(null);
    setPublic(false);
  };
  return {
    data,
    photo,
    remoteUri: visible ? remoteUri : null,
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
