import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Appearance, Modal, View } from 'react-native';
import { AccentBadge } from '@/components/ui/accent-badge';
import { palette } from '@/lib/theme';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { ChoiceField } from '@/components/ui/choice-field';
import { FormField } from '@/components/ui/form-field';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from '@/components/ui/sheet';

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

it('keeps busy actions unavailable and exposes a distinct accessible label', () => {
  const onPress = jest.fn();
  const view = render(
    <Button
      label="Take photo"
      accessibilityLabel="Take a photo of une pomme"
      onPress={onPress}
      loading
    />,
  );
  const button = screen.getByRole('button', { name: 'Take a photo of une pomme' });
  expect(button).toBeDisabled();
  fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
  view.rerender(
    <Button label="Take photo" accessibilityLabel="Take a photo of une pomme" onPress={onPress} />,
  );
  fireEvent.press(screen.getByRole('button', { name: 'Take a photo of une pomme' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('prioritizes field errors and restores help after the field recovers', () => {
  const view = render(
    <FormField label="Username" required hint="Letters and numbers" error="Choose a username" />,
  );
  expect(screen.getByLabelText('Username')).toHaveProp(
    'accessibilityHint',
    'Required. Choose a username',
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a username');
  expect(screen.queryByText('Letters and numbers')).toBeNull();
  view.rerender(<FormField label="Username" required hint="Letters and numbers" />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Letters and numbers')).toBeVisible();
});

it('retains one checked radio and prevents changing disabled choices', () => {
  const onChange = jest.fn();
  render(
    <ChoiceField
      label="Visibility"
      value="private"
      options={[
        { value: 'private', label: 'Private' },
        { value: 'public', label: 'Public' },
      ]}
      onChange={onChange}
      disabled
    />,
  );
  expect(screen.getByRole('radio', { name: 'Private' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Public' })).not.toBeChecked();
  fireEvent.press(screen.getByRole('radio', { name: 'Public' }));
  expect(onChange).not.toHaveBeenCalled();
});

it('labels icon actions and prevents disabled activation', () => {
  const onPress = jest.fn();
  render(
    <IconButton name="ellipsis-horizontal" label="Photo options" onPress={onPress} disabled />,
  );
  const action = screen.getByRole('button', { name: 'Photo options' });
  expect(action).toBeDisabled();
  fireEvent.press(action);
  expect(onPress).not.toHaveBeenCalled();
});

function SheetExample() {
  const [visible, setVisible] = useState(true);
  return (
    <Sheet title="Photo options" visible={visible} onClose={() => setVisible(false)}>
      <AppText>Report this photo</AppText>
    </Sheet>
  );
}

it('dismisses secondary content from the visible close action', () => {
  render(<SheetExample />);
  expect(screen.getByText('Report this photo')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Close Photo options' }));
  expect(screen.queryByText('Report this photo')).toBeNull();
});

it('handles a native modal dismissal through the same close authority', () => {
  const onClose = jest.fn();
  const view = render(
    <Sheet title="Photo options" visible onClose={onClose}>
      <AppText>Report this photo</AppText>
    </Sheet>,
  );
  fireEvent(view.UNSAFE_getByType(Modal), 'requestClose');
  expect(onClose).toHaveBeenCalledTimes(1);
});

it.each(['light', 'dark'] as const)(
  'keeps %s actions and energy/reward labels readable without changing interaction state',
  (mode) => {
    const scheme = jest.spyOn(Appearance, 'getColorScheme').mockReturnValue(mode);
    const colors = palette[mode];
    const onPress = jest.fn();
    try {
      render(
        <View>
          <Button label="Save profile" onPress={onPress} />
          <Button label="Unavailable action" disabled onPress={onPress} />
          <AccentBadge tone="reward" label="+10 XP" announce />
          <AccentBadge tone="energy" icon="flame" label="7 day streak" />
        </View>,
      );
      expect(screen.getByRole('button', { name: 'Save profile' })).toHaveStyle({
        backgroundColor: colors.brandPrimary,
      });
      expect(screen.getByText('Save profile')).toHaveStyle({ color: colors.textOnPrimary });
      expect(screen.getByRole('button', { name: 'Unavailable action' })).toBeDisabled();
      expect(screen.getByText('Unavailable action')).toHaveStyle({ color: colors.textSecondary });
      expect(screen.getByText('+10 XP')).toHaveStyle({ color: colors.textOnAccent });
      expect(screen.getByText('+10 XP')).toHaveProp('accessibilityLiveRegion', 'polite');
      expect(screen.getByText('7 day streak')).toHaveStyle({ color: colors.textOnAccent });
      fireEvent.press(screen.getByRole('button', { name: 'Save profile' }));
      fireEvent.press(screen.getByRole('button', { name: 'Unavailable action' }));
      expect(onPress).toHaveBeenCalledTimes(1);
    } finally {
      scheme.mockRestore();
    }
  },
);
