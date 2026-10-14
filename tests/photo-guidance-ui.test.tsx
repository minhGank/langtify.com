import { fireEvent, render, screen, act } from '@testing-library/react-native';
import { PhotoGuidance } from '@/features/challenges/photo-guidance';
const guidance = {
  locale: 'en',
  primaryIdea: 'A favourite object beside a staged smile.',
  mode: 'interpretive',
  alternativeIdea: 'Use a paper face.',
  alternativeMode: 'interpretive',
  accessibility: 'No face is required.',
  safety: 'Do not photograph strangers.',
} as const;
it('starts collapsed and reveals example, alternative, access and safety together', async () => {
  render(<PhotoGuidance guidance={guidance} word="Happiness" />);
  await act(async () => {});
  const toggle = screen.getByRole('button', { name: 'Photo idea for Happiness' });
  expect(toggle.props.accessibilityState.expanded).toBe(false);
  expect(screen.queryByText(guidance.primaryIdea)).toBeNull();
  fireEvent.press(toggle);
  for (const value of [
    guidance.primaryIdea,
    guidance.alternativeIdea,
    guidance.accessibility,
    guidance.safety,
  ])
    expect(screen.getByText(value)).toBeVisible();
  expect(screen.getByText('Represent the meaning with a scene')).toBeVisible();
  fireEvent.press(toggle);
  expect(screen.queryByText(guidance.safety)).toBeNull();
});
it('shows literal wording and omits an unavailable alternative', async () => {
  render(
    <PhotoGuidance
      word="Bed"
      guidance={{ ...guidance, mode: 'literal', alternativeIdea: null, alternativeMode: null }}
    />,
  );
  await act(async () => {});
  fireEvent.press(screen.getByRole('button', { name: 'Photo idea for Bed' }));
  expect(screen.getByText('Show it in a photo')).toBeVisible();
  expect(screen.queryByText('Another idea')).toBeNull();
});
