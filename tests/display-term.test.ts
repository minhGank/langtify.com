import { displayTerm } from '@/utils/display-term';

it.each([
  ['le chien', 'Le chien'],
  ['la fenêtre', 'La fenêtre'],
  ['bondé', 'Bondé'],
  ['  éléphant\n', 'Éléphant'],
  ['e\u0301cole', 'E\u0301cole'],
  ['iPhone', 'IPhone'],
  ['NASA', 'NASA'],
  ['Straße', 'Straße'],
  ['ßeta', 'ßeta'],
  ['猫', '猫'],
  ['🦊 renard', '🦊 renard'],
  ['', ''],
  [' \n\t', ''],
])('formats %j without rewriting the rest of the phrase', (input, expected) => {
  expect(displayTerm(input)).toBe(expected);
});
it('honors an available language locale and safely handles an invalid one', () => {
  expect(displayTerm('istanbul', 'tr')).toBe('İstanbul');
  expect(displayTerm('élan', 'not_a_locale')).toBe('Élan');
});
