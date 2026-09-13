import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useAssignmentPhoto } from '@/features/photos/use-assignment-photo';
import type { PhotoGateway, Submission } from '@/services/submissions';
import { makeSubmission, photoFixture, preparedPhoto } from './photo-fixtures';
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
});
