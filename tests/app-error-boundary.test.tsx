import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { AppErrorBoundary } from '@/components/app-error-boundary';

it('shows safe recovery without exposing an unexpected error or its stack', async () => {
  const error = new Error('PostgreSQL private detail https://example.test/?token=secret');
  error.stack = 'private storage path and stack trace';
  const retry = jest.fn().mockResolvedValue(undefined);
  render(<AppErrorBoundary error={error} retry={retry} />);
  expect(screen.getByText('We couldn’t open this screen')).toBeVisible();
  expect(screen.queryByText(/PostgreSQL|private|token=|stack trace/)).toBeNull();
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Try again' })));
  expect(retry).toHaveBeenCalledTimes(1);
});

it('handles rejected retries without exposing their error or overlapping attempts', async () => {
  let rejectRetry: (error: Error) => void = () => {};
  const retry = jest.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectRetry = reject;
      }),
  );
  render(<AppErrorBoundary error={new Error('private original')} retry={retry} />);
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled();
  await act(async () => rejectRetry(new Error('private retry')));
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  expect(screen.queryByText(/private/)).toBeNull();
});
