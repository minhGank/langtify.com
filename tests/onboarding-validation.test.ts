import {
  detectTimezone,
  isCefrLevel,
  isValidTimezone,
  normalizeUsername,
  validateOnboarding,
} from '@/features/onboarding/validation';
import { hasCompletedOnboarding } from '@/features/auth/session-state';
import { makeAccount, makeSession } from './fixtures';

const valid = {
  username: ' Learner_1 ',
  referenceLanguageId: 'en',
  targetLanguageId: 'fr',
  cefrLevel: 'A1',
  timezone: 'America/Toronto',
};
it.each(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])('accepts CEFR %s', (value) =>
  expect(isCefrLevel(value)).toBe(true),
);
it.each(['', 'a1', 'A0', 'C3', 'D1'])('rejects invalid CEFR %s', (value) =>
  expect(isCefrLevel(value)).toBe(false),
);
it('normalizes usernames and accepts valid complete data', () => {
  expect(normalizeUsername(valid.username)).toBe('learner_1');
  expect(validateOnboarding(valid, ['en', 'fr'])).toEqual({});
});
it.each(['', 'ab', '_abc', 'a b c', 'a'.repeat(31), 'learner!'])(
  'rejects invalid username %s',
  (username) => {
    expect(validateOnboarding({ ...valid, username }, ['en', 'fr']).username).toBeDefined();
  },
);
it('rejects equal, inactive, or missing catalog selections', () => {
  expect(
    validateOnboarding({ ...valid, targetLanguageId: 'en' }, ['en', 'fr']).targetLanguageId,
  ).toBeDefined();
  expect(validateOnboarding(valid, ['en']).targetLanguageId).toBeDefined();
  expect(
    validateOnboarding({ ...valid, referenceLanguageId: '' }, ['en', 'fr']).referenceLanguageId,
  ).toBeDefined();
});
it.each(['UTC', 'Europe/Paris', 'America/Toronto'])('accepts named timezone %s', (zone) =>
  expect(isValidTimezone(zone)).toBe(true),
);
it.each(['', '+02:00', 'Mars/Olympus', 'EST', 'posix/Europe/Paris'])(
  'rejects invalid timezone %s',
  (zone) => expect(isValidTimezone(zone)).toBe(false),
);
it('requires manual timezone input if the device cannot detect it', () => {
  const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
    throw new Error('Unavailable');
  });
  expect(detectTimezone()).toBe('');
  spy.mockRestore();
});
it('requires matching persisted profile, learning record and completion', () => {
  const account = makeAccount();
  const id = makeSession().user.id;
  expect(hasCompletedOnboarding(account, id)).toBe(true);
  expect(hasCompletedOnboarding({ ...account, learning: null }, id)).toBe(false);
  expect(hasCompletedOnboarding({ ...account, profile: null }, id)).toBe(false);
  expect(hasCompletedOnboarding(account, 'other-user')).toBe(false);
  expect(
    hasCompletedOnboarding(
      {
        ...account,
        profile: account.profile && { ...account.profile, onboarding_completed_at: null },
      },
      id,
    ),
  ).toBe(false);
});

it('trusts the database timezone validation when the device has older timezone data', () => {
  const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
    throw new Error('Unavailable timezone');
  });
  try {
    expect(hasCompletedOnboarding(makeAccount(), makeSession().user.id)).toBe(true);
  } finally {
    spy.mockRestore();
  }
});
