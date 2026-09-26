import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAssignmentPhoto } from '@/features/photos/use-assignment-photo';
import type { PhotoGateway, Submission } from '@/services/submissions';
import { makeSubmission, photoFixture, preparedPhoto } from './photo-fixtures';
import { invalidateServerData } from '@/lib/server-cache';
import type { PreparedPhoto } from '@/features/photos/photo-files';
import { feedback } from '@/lib/haptics';
jest.mock('@/lib/haptics', () => ({ feedback: { success: jest.fn(), warning: jest.fn() } }));
beforeEach(() => jest.clearAllMocks());
const libraryPhoto: PreparedPhoto = { ...preparedPhoto, source: 'library' };
async function mounted(fixture = photoFixture()) {
  const hook = renderHook(() => useAssignmentPhoto(fixture.gateway, fixture.drafts));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return { ...hook, ...fixture };
}
it('previews captured photos with private default and never uploads automatically', async () => {
  const { result, gateway } = await mounted();
  act(() => result.current.acceptPhoto(preparedPhoto));
  expect(result.current.photo).toEqual(preparedPhoto);
  expect(result.current.isPublic).toBe(false);
  expect(gateway.reserve).not.toHaveBeenCalled();
  expect(gateway.upload).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.submit();
  });
  expect(gateway.finalize).toHaveBeenCalledWith(makeSubmission().id, 'private');
  expect(result.current.data?.submission?.status).toBe('completed');
  expect(result.current.acknowledgedCompletionId).toBe(makeSubmission().id);
  expect(feedback.success).toHaveBeenCalledTimes(1);
});
it('retake removes the old draft and resets sharing to private', async () => {
  const { result, drafts } = await mounted();
  act(() => {
    result.current.acceptPhoto(preparedPhoto);
    result.current.setPublic(true);
  });
  act(() => result.current.retake());
  expect(result.current.photo).toBeNull();
  expect(result.current.isPublic).toBe(false);
  expect(drafts.remove).toHaveBeenCalled();
});
it('recovers an interrupted finalization and retries without a second upload', async () => {
  const { result, gateway } = await mounted();
  gateway.finalize.mockRejectedValueOnce(new Error('network interrupted'));
  act(() => result.current.acceptPhoto(preparedPhoto));
  await act(async () => {
    await result.current.submit();
  });
  expect(result.current.data?.submission?.status).toBe('pending');
  expect(result.current.remoteUri).toContain('signed-photo');
  expect(result.current.error).not.toBe('');
  await act(async () => {
    await result.current.submit();
  });
  expect(gateway.upload).toHaveBeenCalledTimes(1);
  expect(gateway.finalize).toHaveBeenCalledTimes(2);
  expect(result.current.data?.submission?.status).toBe('completed');
});
it('retries a failed upload using the same server reservation', async () => {
  const { result, gateway } = await mounted();
  gateway.upload.mockRejectedValueOnce(new Error('offline'));
  act(() => result.current.acceptPhoto(preparedPhoto));
  await act(async () => {
    await result.current.submit();
  });
  expect(gateway.finalize).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.submit();
  });
  expect(gateway.upload).toHaveBeenCalledTimes(2);
  expect(gateway.upload.mock.calls[0]).toEqual(gateway.upload.mock.calls[1]);
});
it('blocks duplicate taps and reconciles refresh after an in-flight upload', async () => {
  const { result, gateway } = await mounted();
  let finish: () => void = () => {};
  gateway.upload.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  act(() => result.current.acceptPhoto(preparedPhoto));
  let pending: Promise<void> | undefined;
  act(() => {
    pending = result.current.submit();
    void result.current.submit();
    void result.current.refresh();
  });
  await waitFor(() => expect(gateway.upload).toHaveBeenCalledTimes(1));
  expect(gateway.reserve).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish();
    await pending;
  });
  expect(gateway.finalize).toHaveBeenCalledTimes(1);
  expect(feedback.success).toHaveBeenCalledTimes(1);
});
it('clears account state and never continues a reserved upload after unmount/account switch', async () => {
  const first = await mounted();
  let finish: (value: Submission) => void = () => {};
  first.gateway.reserve.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  act(() => first.result.current.acceptPhoto(preparedPhoto));
  act(() => {
    void first.result.current.submit();
  });
  first.unmount();
  const second = await mounted();
  await act(async () => finish(makeSubmission()));
  expect(first.gateway.upload).not.toHaveBeenCalled();
  expect(first.gateway.finalize).not.toHaveBeenCalled();
  expect(second.result.current.photo).toBeNull();
  expect(second.result.current.data?.submission).toBeNull();
});
it('uses the refreshed same-account gateway after an interrupted upload', async () => {
  const first = photoFixture(),
    second = photoFixture(makeSubmission());
  const { result, rerender } = renderHook(
    ({ gateway }: { gateway: PhotoGateway }) => useAssignmentPhoto(gateway, first.drafts),
    { initialProps: { gateway: first.gateway } },
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  let finish: () => void = () => {};
  first.gateway.upload.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  act(() => result.current.acceptPhoto(preparedPhoto));
  let pending: Promise<void> | undefined;
  act(() => {
    pending = result.current.submit();
  });
  await waitFor(() => expect(first.gateway.upload).toHaveBeenCalledTimes(1));
  rerender({ gateway: second.gateway });
  await act(async () => {
    finish();
    await pending;
  });
  expect(first.gateway.finalize).not.toHaveBeenCalled();
  expect(second.gateway.finalize).toHaveBeenCalledTimes(1);
  expect(result.current.data?.submission?.status).toBe('completed');
  expect(result.current.acknowledgedCompletionId).toBeNull();
  expect(feedback.success).not.toHaveBeenCalled();
});
it('requires previewing a recovered upload before finalizing it', async () => {
  const fixture = photoFixture();
  const { result, gateway } = await mounted(fixture);
  gateway.preview.mockResolvedValue('https://example.test/recovered');
  act(() => result.current.acceptPhoto(preparedPhoto));
  await act(async () => {
    await result.current.submit();
  });
  expect(gateway.finalize).not.toHaveBeenCalled();
  expect(result.current.remoteUri).toContain('recovered');
  await act(async () => {
    await result.current.submit();
  });
  expect(gateway.finalize).toHaveBeenCalledTimes(1);
  expect(gateway.upload).not.toHaveBeenCalled();
});
it('applies visibility only after backend confirmation', async () => {
  const { result, gateway } = await mounted(
    photoFixture(makeSubmission({ status: 'completed', submitted_at: '2026-09-12T13:00:00Z' })),
  );
  gateway.visibility.mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    await result.current.changeVisibility('public');
  });
  expect(result.current.data?.submission?.visibility).toBe('private');
  await act(async () => {
    await result.current.changeVisibility('public');
  });
  expect(result.current.data?.submission?.visibility).toBe('public');
});
it('retains deletion intent on failure and releases completion only after object removal', async () => {
  const { result, gateway } = await mounted(
    photoFixture(makeSubmission({ status: 'completed', submitted_at: '2026-09-12T13:00:00Z' })),
  );
  gateway.removeObject.mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    await result.current.deletePhoto();
  });
  expect(result.current.data?.submission?.status).toBe('deleting');
  expect(gateway.finishDelete).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.deletePhoto();
  });
  expect(result.current.data?.submission).toBeNull();
  expect(result.current.photo).toBeNull();
});

it('does not resurrect an old draft when refresh finishes after retake or a new capture', async () => {
  const { result, drafts } = await mounted();
  let finish: (photo: typeof preparedPhoto | null) => void = () => {};
  drafts.load.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let refresh: Promise<void> | undefined;
  act(() => {
    refresh = result.current.refresh();
  });
  await waitFor(() => expect(drafts.load).toHaveBeenCalledTimes(2));
  act(() => result.current.retake());
  await act(async () => {
    finish(preparedPhoto);
    await refresh;
  });
  expect(result.current.photo).toBeNull();
  expect(result.current.loading).toBe(false);
});

it('does not finalize a late upload after session loss or account switching', async () => {
  const first = await mounted();
  let finish: () => void = () => {};
  first.gateway.upload.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  act(() => first.result.current.acceptPhoto(preparedPhoto));
  let pending: Promise<void> | undefined;
  act(() => {
    pending = first.result.current.submit();
  });
  await waitFor(() => expect(first.gateway.upload).toHaveBeenCalledTimes(1));
  first.unmount();
  const next = await mounted();
  await act(async () => {
    finish();
    await pending;
  });
  expect(first.gateway.finalize).not.toHaveBeenCalled();
  expect(next.result.current.photo).toBeNull();
  expect(next.result.current.data?.submission).toBeNull();
});

it('recovers a committed finalization after its response is lost without another upload', async () => {
  const { result, gateway } = await mounted();
  const finalize = gateway.finalize.getMockImplementation();
  gateway.finalize.mockImplementationOnce(async (id, visibility) => {
    await finalize?.(id, visibility);
    throw new Error('response lost after commit');
  });
  act(() => result.current.acceptPhoto(preparedPhoto));
  await act(async () => {
    await result.current.submit();
  });
  expect(result.current.data?.submission?.status).toBe('completed');
  await act(async () => {
    await result.current.submit();
  });
  expect(gateway.upload).toHaveBeenCalledTimes(1);
  expect(gateway.finalize).toHaveBeenCalledTimes(1);
  expect(result.current.acknowledgedCompletionId).toBeNull();
  expect(feedback.success).not.toHaveBeenCalled();
});

it('never celebrates an existing completion from load, refresh or an already-completed reservation', async () => {
  const { result, gateway } = await mounted(photoFixture(makeSubmission({ status: 'completed' })));
  await act(async () => result.current.refresh());
  await act(async () => result.current.submit());
  expect(gateway.finalize).not.toHaveBeenCalled();
  expect(result.current.acknowledgedCompletionId).toBeNull();
  expect(feedback.success).not.toHaveBeenCalled();
});

it('does not replay completion feedback when finalization settles after leaving and returning to the screen', async () => {
  const fixture = photoFixture();
  const view = renderHook(
    ({ visible }: { visible: boolean }) =>
      useAssignmentPhoto(fixture.gateway, fixture.drafts, visible),
    { initialProps: { visible: true } },
  );
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  const finalize = fixture.gateway.finalize.getMockImplementation();
  let finish = () => {};
  fixture.gateway.finalize.mockImplementationOnce(async (id, visibility) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    if (!finalize) throw new Error('Missing finalization fixture');
    return finalize(id, visibility);
  });
  act(() => view.result.current.acceptPhoto(preparedPhoto));
  let pending: Promise<void> | undefined;
  act(() => {
    pending = view.result.current.submit();
  });
  await waitFor(() => expect(fixture.gateway.finalize).toHaveBeenCalledTimes(1));
  view.rerender({ visible: false });
  view.rerender({ visible: true });
  await act(async () => {
    finish();
    await pending;
  });
  expect(view.result.current.data?.submission?.status).toBe('completed');
  expect(view.result.current.acknowledgedCompletionId).toBeNull();
  expect(feedback.success).not.toHaveBeenCalled();
});

it('forgets presentation feedback on background without changing completion authority', async () => {
  const fixture = photoFixture();
  const view = renderHook(
    ({ visible }: { visible: boolean }) =>
      useAssignmentPhoto(fixture.gateway, fixture.drafts, visible),
    { initialProps: { visible: true } },
  );
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  act(() => view.result.current.acceptPhoto(preparedPhoto));
  await act(async () => view.result.current.submit());
  expect(view.result.current.acknowledgedCompletionId).toBe(makeSubmission().id);
  view.rerender({ visible: false });
  view.rerender({ visible: true });
  await act(async () => {});
  expect(view.result.current.acknowledgedCompletionId).toBeNull();
  expect(view.result.current.data?.submission?.status).toBe('completed');
  expect(feedback.success).toHaveBeenCalledTimes(1);
});

it('reuses a completed owner photo on revisit and never polls when minutes pass', async () => {
  jest.useFakeTimers();
  try {
    const fixture = photoFixture(makeSubmission({ status: 'completed' }));
    const first = renderHook(() => useAssignmentPhoto(fixture.gateway, fixture.drafts));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    await act(async () => jest.advanceTimersByTime(600000));
    expect(fixture.gateway.load).toHaveBeenCalledTimes(1);
    expect(fixture.gateway.preview).toHaveBeenCalledTimes(1);
    first.unmount();
    const next = renderHook(() => useAssignmentPhoto(fixture.gateway, fixture.drafts));
    expect(next.result.current.data?.submission?.status).toBe('completed');
    await waitFor(() => expect(next.result.current.loading).toBe(false));
    expect(fixture.gateway.load).toHaveBeenCalledTimes(1);
    await act(async () => next.result.current.refresh());
    expect(fixture.gateway.load).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

it.each(['completed', 'pending', 'deleting'] as const)(
  'only automatically recovers unfinished %s owner state on foreground',
  async (status) => {
    const fixture = photoFixture(makeSubmission({ status }));
    const view = renderHook(
      ({ visible }: { visible: boolean }) =>
        useAssignmentPhoto(fixture.gateway, fixture.drafts, visible),
      {
        initialProps: { visible: true },
      },
    );
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    view.rerender({ visible: false });
    expect(view.result.current.remoteUri).toBeNull();
    view.rerender({ visible: true });
    await act(async () => {});
    expect(fixture.gateway.load).toHaveBeenCalledTimes(status === 'completed' ? 1 : 2);
  },
);

it('invalidates cached owner state on deletion/media events and defers reads while inactive', async () => {
  const fixture = photoFixture(makeSubmission({ status: 'completed' }));
  const view = renderHook(
    ({ visible }: { visible: boolean }) =>
      useAssignmentPhoto(fixture.gateway, fixture.drafts, visible),
    {
      initialProps: { visible: true },
    },
  );
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  view.rerender({ visible: false });
  act(() => invalidateServerData(['media'], { discard: true }));
  await act(async () => {});
  expect(fixture.gateway.load).toHaveBeenCalledTimes(1);
  view.rerender({ visible: true });
  await waitFor(() => expect(fixture.gateway.load).toHaveBeenCalledTimes(2));
  expect(fixture.gateway.finalize).not.toHaveBeenCalled();
});

it('reconciles pending recovery when revisiting an already cached assignment', async () => {
  const fixture = photoFixture(makeSubmission());
  const first = await mounted(fixture);
  first.unmount();
  const next = await mounted(fixture);
  expect(next.gateway.load).toHaveBeenCalledTimes(2);
  expect(next.gateway.finalize).not.toHaveBeenCalled();
});

it('queues invalidation behind an in-flight owner read instead of accepting obsolete state', async () => {
  const fixture = photoFixture(makeSubmission({ status: 'completed' }));
  const saved = await fixture.gateway.load();
  fixture.gateway.load.mockClear();
  let finish = () => {};
  fixture.gateway.load.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = () => resolve(saved);
    }),
  );
  const view = renderHook(() => useAssignmentPhoto(fixture.gateway, fixture.drafts));
  await waitFor(() => expect(fixture.gateway.load).toHaveBeenCalledTimes(1));
  act(() => invalidateServerData(['media'], { discard: true }));
  await act(async () => finish());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(fixture.gateway.load).toHaveBeenCalledTimes(2);
  expect(fixture.gateway.preview).toHaveBeenCalledTimes(1);
});

it('recovers interrupted completed-photo pixels on resume without rereading fresh metadata', async () => {
  const fixture = photoFixture(makeSubmission({ status: 'completed' }));
  const view = renderHook(
    ({ visible }: { visible: boolean }) =>
      useAssignmentPhoto(fixture.gateway, fixture.drafts, visible),
    { initialProps: { visible: true } },
  );
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(view.result.current.remoteUri).toContain('signed-photo');
  let finish = () => {};
  fixture.gateway.preview.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = () => resolve('obsolete pixels');
    }),
  );
  act(() => invalidateServerData(['media'], { discard: true }));
  await waitFor(() => expect(fixture.gateway.preview).toHaveBeenCalledTimes(2));
  expect(view.result.current.remoteUri).toBeNull();
  view.rerender({ visible: false });
  view.rerender({ visible: true });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(fixture.gateway.load).toHaveBeenCalledTimes(2);
  expect(fixture.gateway.preview).toHaveBeenCalledTimes(3);
  expect(view.result.current.remoteUri).toContain('signed-photo');
  await act(async () => finish());
  expect(view.result.current.remoteUri).toContain('signed-photo');
});

it.each(['private', 'public'] as const)(
  'submits a current-day gallery photo through the same %s reserve/upload/finalize lifecycle',
  async (visibility) => {
    const { result, gateway } = await mounted();
    act(() => {
      result.current.acceptPhoto(libraryPhoto);
      result.current.setPublic(visibility === 'public');
    });
    expect(gateway.upload).not.toHaveBeenCalled();
    await act(async () => result.current.submit());
    expect(gateway.canChooseLibraryPhoto).toHaveBeenCalledTimes(1);
    expect(gateway.reserve).toHaveBeenCalledTimes(1);
    expect(gateway.upload).toHaveBeenCalledWith(makeSubmission(), libraryPhoto.bytes);
    expect(gateway.finalize).toHaveBeenCalledWith(makeSubmission().id, visibility);
    expect(result.current.data?.submission?.status).toBe('completed');
    expect(result.current.data?.submission?.visibility).toBe(visibility);
  },
);

it('keeps a restored daily gallery draft recoverable but refuses bytes after server eligibility expires', async () => {
  const fixture = photoFixture();
  fixture.drafts.load.mockResolvedValue(libraryPhoto);
  fixture.gateway.canChooseLibraryPhoto.mockResolvedValue(false);
  const { result, gateway } = await mounted(fixture);
  expect(result.current.photo?.source).toBe('library');
  await act(async () => result.current.submit());
  expect(gateway.upload).not.toHaveBeenCalled();
  expect(gateway.finalize).not.toHaveBeenCalled();
  expect(result.current.error).toBe(
    'You can’t add a photo here right now. Refresh Today or Past Words.',
  );
  expect(result.current.photo).toEqual(libraryPhoto);
});

it('does not upload or finalize a gallery image when current-day verification fails', async () => {
  const { result, gateway } = await mounted();
  gateway.canChooseLibraryPhoto.mockRejectedValue(new Error('offline'));
  act(() => result.current.acceptPhoto(libraryPhoto));
  await act(async () => result.current.submit());
  expect(gateway.upload).not.toHaveBeenCalled();
  expect(gateway.finalize).not.toHaveBeenCalled();
  expect(result.current.error).not.toBe('');
  expect(result.current.photo).toEqual(libraryPhoto);
});

it('rechecks current-day gallery eligibility before retrying a failed upload', async () => {
  const { result, gateway } = await mounted();
  gateway.upload.mockRejectedValueOnce(new Error('offline'));
  act(() => result.current.acceptPhoto(libraryPhoto));
  await act(async () => result.current.submit());
  expect(gateway.upload).toHaveBeenCalledTimes(1);
  gateway.canChooseLibraryPhoto.mockResolvedValue(false);
  await act(async () => result.current.submit());
  expect(gateway.canChooseLibraryPhoto).toHaveBeenCalledTimes(2);
  expect(gateway.upload).toHaveBeenCalledTimes(1);
  expect(gateway.finalize).not.toHaveBeenCalled();
  expect(result.current.error).toBe(
    'You can’t add a photo here right now. Refresh Today or Past Words.',
  );
});

it('recovers an acknowledged-lost gallery upload after midnight without uploading another object', async () => {
  const { result, gateway } = await mounted();
  const upload = gateway.upload.getMockImplementation();
  gateway.upload.mockImplementationOnce(async () => {
    await upload?.();
    throw new Error('upload acknowledgement lost');
  });
  act(() => result.current.acceptPhoto(libraryPhoto));
  await act(async () => result.current.submit());
  expect(result.current.remoteUri).toContain('signed-photo');
  expect(gateway.finalize).not.toHaveBeenCalled();
  gateway.canChooseLibraryPhoto.mockResolvedValue(false);
  await act(async () => result.current.submit());
  expect(gateway.canChooseLibraryPhoto).toHaveBeenCalledTimes(1);
  expect(gateway.upload).toHaveBeenCalledTimes(1);
  expect(gateway.finalize).toHaveBeenCalledTimes(1);
  expect(result.current.data?.submission?.status).toBe('completed');
});

it('recovers a committed gallery finalization after lost acknowledgement without a duplicate finalization', async () => {
  const { result, gateway } = await mounted();
  const finalize = gateway.finalize.getMockImplementation();
  gateway.finalize.mockImplementationOnce(async (id, visibility) => {
    await finalize?.(id, visibility);
    throw new Error('finalize acknowledgement lost');
  });
  act(() => result.current.acceptPhoto(libraryPhoto));
  await act(async () => result.current.submit());
  expect(result.current.data?.submission?.status).toBe('completed');
  await act(async () => result.current.submit());
  expect(gateway.upload).toHaveBeenCalledTimes(1);
  expect(gateway.finalize).toHaveBeenCalledTimes(1);
});

it('finishes an older pending uploaded photo without requiring new gallery eligibility', async () => {
  const fixture = photoFixture(makeSubmission());
  fixture.drafts.load.mockResolvedValue(libraryPhoto);
  fixture.gateway.preview.mockResolvedValue('https://example.test/previous-day-upload');
  fixture.gateway.canChooseLibraryPhoto.mockResolvedValue(false);
  const { result, gateway } = await mounted(fixture);
  await act(async () => result.current.submit());
  expect(gateway.canChooseLibraryPhoto).not.toHaveBeenCalled();
  expect(gateway.upload).not.toHaveBeenCalled();
  expect(gateway.finalize).toHaveBeenCalledTimes(1);
  expect(result.current.data?.submission?.status).toBe('completed');
});

it('ignores gallery eligibility that resolves after account switching', async () => {
  const first = await mounted();
  let finish: (allowed: boolean) => void = () => {};
  first.gateway.canChooseLibraryPhoto.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  act(() => first.result.current.acceptPhoto(libraryPhoto));
  let pending: Promise<void> | undefined;
  act(() => {
    pending = first.result.current.submit();
  });
  await waitFor(() => expect(first.gateway.canChooseLibraryPhoto).toHaveBeenCalledTimes(1));
  first.unmount();
  const next = await mounted();
  await act(async () => {
    finish(true);
    await pending;
  });
  expect(first.gateway.upload).not.toHaveBeenCalled();
  expect(first.gateway.finalize).not.toHaveBeenCalled();
  expect(next.result.current.photo).toBeNull();
  expect(next.result.current.data?.submission).toBeNull();
});

it.each([
  ['camera', 'private'],
  ['camera', 'public'],
  ['library', 'private'],
  ['library', 'public'],
] as const)(
  'preserves historical server semantics for %s bytes and %s visibility in the shared uploader',
  async (source, visibility) => {
    const { result, gateway } = await mounted(
      photoFixture(null, { captureKind: 'historical', localDate: '2026-08-01' }),
    );
    act(() => {
      result.current.acceptPhoto(source === 'library' ? libraryPhoto : preparedPhoto);
      result.current.setPublic(visibility === 'public');
    });
    await act(async () => result.current.submit());
    expect(gateway.reserve).toHaveBeenCalledTimes(1);
    expect(gateway.upload).toHaveBeenCalledWith(
      makeSubmission({ capture_kind: 'historical' }),
      preparedPhoto.bytes,
    );
    expect(gateway.finalize).toHaveBeenCalledWith(makeSubmission().id, visibility);
    expect(result.current.data).toMatchObject({
      captureKind: 'historical',
      localDate: '2026-08-01',
      submission: { capture_kind: 'historical', status: 'completed', visibility },
    });
    expect(gateway.canChooseLibraryPhoto).toHaveBeenCalledTimes(source === 'library' ? 1 : 0);
  },
);

it.each(['camera', 'library'] as const)(
  'reconciles committed historical %s finalization after a lost acknowledgement without another upload or award request',
  async (source) => {
    const { result, gateway } = await mounted(photoFixture(null, { captureKind: 'historical' }));
    const finalize = gateway.finalize.getMockImplementation();
    gateway.finalize.mockImplementationOnce(async (id, visibility) => {
      await finalize?.(id, visibility);
      throw new Error('finalize acknowledgement lost');
    });
    act(() => result.current.acceptPhoto(source === 'library' ? libraryPhoto : preparedPhoto));
    await act(async () => result.current.submit());
    expect(result.current.data?.submission).toMatchObject({
      capture_kind: 'historical',
      status: 'completed',
    });
    await act(async () => result.current.submit());
    expect(gateway.upload).toHaveBeenCalledTimes(1);
    expect(gateway.finalize).toHaveBeenCalledTimes(1);
  },
);

it('preserves historical deletion and resubmission context instead of turning the assignment into a daily completion', async () => {
  const { result, gateway } = await mounted(
    photoFixture(
      makeSubmission({
        capture_kind: 'historical',
        status: 'completed',
        submitted_at: '2026-09-23T12:00:00Z',
      }),
    ),
  );
  await act(async () => result.current.deletePhoto());
  expect(gateway.beginDelete).toHaveBeenCalledWith(makeSubmission().id);
  expect(gateway.removeObject).toHaveBeenCalledWith(
    expect.objectContaining({ capture_kind: 'historical', status: 'deleting' }),
  );
  expect(gateway.finishDelete).toHaveBeenCalledTimes(1);
  expect(result.current.data).toMatchObject({ captureKind: 'historical', submission: null });
  act(() => result.current.acceptPhoto(libraryPhoto));
  await act(async () => result.current.submit());
  expect(result.current.data?.submission).toMatchObject({
    capture_kind: 'historical',
    status: 'completed',
  });
  expect(gateway.finalize).toHaveBeenCalledTimes(1);
});

it('serializes two historical submit taps and reconciles without changing capture kind', async () => {
  const { result, gateway } = await mounted(photoFixture(null, { captureKind: 'historical' }));
  let finish: () => void = () => {};
  gateway.upload.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  act(() => result.current.acceptPhoto(libraryPhoto));
  let pending: Promise<void> | undefined;
  act(() => {
    pending = result.current.submit();
    void result.current.submit();
  });
  await waitFor(() => expect(gateway.upload).toHaveBeenCalledTimes(1));
  await act(async () => {
    finish();
    await pending;
  });
  expect(gateway.reserve).toHaveBeenCalledTimes(1);
  expect(gateway.finalize).toHaveBeenCalledTimes(1);
  expect(result.current.data?.submission?.capture_kind).toBe('historical');
});
