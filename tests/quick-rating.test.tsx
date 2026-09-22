import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QuickRating } from '@/features/ratings/quick-rating';
import { ratingOptions, type RatingSummary } from '@/features/ratings/rating';

afterEach(async () => {
  await act(async () => {});
});

const unrated: RatingSummary = {
  canRate: true,
  viewerRating: null,
  ratingCount: 2,
  averageRating: 4,
};

it('keeps the feed compact and reveals accessible semantic choices only on demand', async () => {
  const onRate = jest.fn();
  render(
    <QuickRating
      word="Le chien"
      summary={unrated}
      action={null}
      disabled={false}
      onRate={onRate}
    />,
  );
  await act(async () => {});
  expect(screen.getByText('4.0 / 5 · 2 ratings')).toBeVisible();
  expect(screen.queryByRole('radio')).toBeNull();
  fireEvent.press(screen.getByLabelText('Rate photo: Le chien'));
  for (const option of ratingOptions) {
    expect(
      screen.getByRole('radio', { name: `${option.score} — ${option.label} for Le chien` }),
    ).toBeVisible();
  }
  fireEvent.press(screen.getByRole('radio', { name: '4 — Clear match for Le chien' }));
  expect(onRate).toHaveBeenCalledTimes(1);
  expect(onRate).toHaveBeenCalledWith(4);
  expect(screen.queryByRole('radio')).toBeNull();
  // No optimistic vote or aggregate change before the server acknowledges.
  expect(screen.getByLabelText('Rate photo: Le chien')).toBeVisible();
  expect(screen.getByText('4.0 / 5 · 2 ratings')).toBeVisible();
});

it('shows the confirmed score, edits immediately and does not resend the same selection', () => {
  const onRate = jest.fn();
  render(
    <QuickRating
      word="Le chien"
      summary={{ ...unrated, viewerRating: 4 }}
      action={null}
      disabled={false}
      onRate={onRate}
    />,
  );
  const button = () =>
    screen.getByRole('button', { name: 'Your rating: 4 — Clear match. Edit rating for Le chien' });
  fireEvent.press(button());
  expect(screen.getByRole('radio', { name: '4 — Clear match for Le chien' })).toBeChecked();
  fireEvent.press(screen.getByRole('radio', { name: '4 — Clear match for Le chien' }));
  expect(onRate).not.toHaveBeenCalled();
  fireEvent.press(button());
  fireEvent.press(screen.getByRole('radio', { name: '5 — Perfect match for Le chien' }));
  expect(onRate).toHaveBeenCalledWith(5);
});

it('dismisses without a mutation and forbids self-rating', () => {
  const onRate = jest.fn();
  const view = render(
    <QuickRating
      word="Le chien"
      summary={unrated}
      action={null}
      disabled={false}
      onRate={onRate}
    />,
  );
  fireEvent.press(screen.getByLabelText('Rate photo: Le chien'));
  fireEvent.press(screen.getByLabelText('Close rating'));
  expect(onRate).not.toHaveBeenCalled();
  view.rerender(
    <QuickRating
      word="Le chien"
      summary={{ ...unrated, canRate: false }}
      action={null}
      disabled={false}
      onRate={onRate}
    />,
  );
  expect(screen.getByText('Your photo')).toBeVisible();
  expect(screen.queryByRole('button')).toBeNull();
});

it('prevents duplicate pending writes and preserves the confirmed score after uncertainty', () => {
  const onRate = jest.fn();
  const view = render(
    <QuickRating
      word="Le chien"
      summary={{ ...unrated, viewerRating: 3 }}
      action={{ id: 'post', score: 5, status: 'saving' }}
      disabled
      onRate={onRate}
    />,
  );
  expect(screen.getByRole('button')).toBeDisabled();
  fireEvent.press(screen.getByRole('button'));
  expect(onRate).not.toHaveBeenCalled();
  expect(screen.queryByRole('radio')).toBeNull();
  view.rerender(
    <QuickRating
      word="Le chien"
      summary={{ ...unrated, viewerRating: 3 }}
      action={{ id: 'post', score: 5, status: 'error' }}
      disabled={false}
      onRate={onRate}
    />,
  );
  expect(
    screen.getByRole('button', {
      name: 'Your rating: 3 — Understandable. Edit rating for Le chien',
    }),
  ).toBeEnabled();
  expect(screen.getByRole('alert')).toBeVisible();
});
