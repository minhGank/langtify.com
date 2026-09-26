import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { TimezoneField } from '@/features/onboarding/timezone-field';
import { filterTimezones, timezoneOptions } from '@/features/onboarding/timezones';
import { isValidTimezone } from '@/features/onboarding/validation';
import { feedback } from '@/lib/haptics';

jest.mock('@/lib/haptics', () => ({ feedback: { selection: jest.fn() } }));

beforeEach(() => jest.clearAllMocks());

it('uses valid IANA zones, retaining saved aliases and UTC without accepting arbitrary text', () => {
  const options = timezoneOptions('US/Eastern', 'America/Toronto');
  expect(options).toEqual(expect.arrayContaining(['UTC', 'US/Eastern', 'America/Toronto']));
  expect(options.every(isValidTimezone)).toBe(true);
  expect(timezoneOptions('not/a-zone', 'bad')).not.toEqual(
    expect.arrayContaining(['not/a-zone', 'bad']),
  );
  expect(filterTimezones(options, 'america toronto')).toContain('America/Toronto');
  expect(filterTimezones(options, 'America/Toronto')).toContain('America/Toronto');
});

it('retains usable valid choices when the runtime cannot enumerate IANA zones', () => {
  const enumerate = jest.spyOn(Intl, 'supportedValuesOf').mockImplementationOnce(() => {
    throw new Error('unsupported');
  });
  expect(timezoneOptions('Europe/Paris', 'America/Toronto')).toEqual([
    'America/Toronto',
    'Europe/Paris',
    'UTC',
  ]);
  enumerate.mockRestore();
});

it('searches and selects a canonical value without saving free-text search as a timezone', async () => {
  const onChange = jest.fn();
  render(<TimezoneField value="America/Toronto" onChange={onChange} />);
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.press(screen.getByRole('button', { name: 'Timezone' }));
  fireEvent.changeText(screen.getByLabelText('Search timezones'), 'imaginary city');
  expect(screen.getByText('No timezone found. Try a nearby city or region.')).toBeVisible();
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Search timezones'), 'Paris');
  fireEvent.press(screen.getByRole('radio', { name: 'Europe / Paris' }));
  expect(onChange).toHaveBeenCalledWith('Europe/Paris');
  expect(feedback.selection).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText('Search timezones')).toBeNull();
});

it('keeps opening, searching, closing and reselecting the current timezone quiet', () => {
  render(<TimezoneField value="America/Toronto" onChange={jest.fn()} />);
  fireEvent.press(screen.getByRole('button', { name: 'Timezone' }));
  fireEvent.changeText(screen.getByLabelText('Search timezones'), 'Toronto');
  fireEvent.press(screen.getByRole('radio', { name: 'America / Toronto' }));
  fireEvent.press(screen.getByRole('button', { name: 'Timezone' }));
  fireEvent.press(screen.getByRole('button', { name: 'Close Choose your timezone' }));
  expect(feedback.selection).not.toHaveBeenCalled();
});
