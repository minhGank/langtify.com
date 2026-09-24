import { palette } from '@/lib/theme';
import appConfig from '../app.json';

// WCAG sRGB relative luminance. Evaluate full-opacity colors actually paired by
// components; disabled/pressed states no longer dim their complete text subtree.
function luminance(hex: string) {
  const rgb = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(foreground: string, background: string) {
  const [low, high] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  return (high + 0.05) / (low + 0.05);
}
for (const mode of ['light', 'dark'] as const) {
  const colors = palette[mode];
  const neutrals = [colors.background, colors.surface, colors.surfaceMuted];
  describe(`${mode} color accessibility`, () => {
    it('keeps regular, secondary, disabled and selected text readable on their surfaces', () => {
      for (const background of [...neutrals, colors.brandSoft, colors.errorSoft]) {
        for (const foreground of [
          colors.textPrimary,
          colors.textSecondary,
          colors.brandText,
          colors.error,
        ]) {
          expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
    it('keeps primary action labels readable at rest and while pressed', () => {
      for (const background of [colors.brandPrimary, colors.brandPrimaryPressed]) {
        expect(contrast(colors.textOnPrimary, background)).toBeGreaterThanOrEqual(4.5);
      }
    });
    it('uses readable ink inside energy/reward badges instead of yellow/orange text on white', () => {
      for (const background of [colors.accentEnergy, colors.accentReward]) {
        expect(contrast(colors.textOnAccent, background)).toBeGreaterThanOrEqual(4.5);
      }
    });
    it('keeps confirmed completion and warning text readable on their neutral containers', () => {
      for (const background of [colors.background, colors.surface]) {
        expect(contrast(colors.success, background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(colors.warning, background)).toBeGreaterThanOrEqual(4.5);
      }
    });
    it('distinguishes inputs, selected controls and loading indicators from adjacent surfaces', () => {
      for (const background of neutrals) {
        expect(contrast(colors.controlBorder, background)).toBeGreaterThanOrEqual(3);
        expect(contrast(colors.brandPrimary, background)).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(colors.brandPrimary, colors.brandSoft)).toBeGreaterThanOrEqual(3);
      expect(contrast(colors.mediaForeground, colors.mediaBackground)).toBeGreaterThanOrEqual(4.5);
    });
    it('keeps XP progress distinguishable with an ink outline and completion segments readable', () => {
      expect(contrast(colors.textOnAccent, colors.accentReward)).toBeGreaterThanOrEqual(3);
      expect(
        Math.max(
          contrast(colors.accentReward, colors.border),
          contrast(colors.textOnAccent, colors.border),
        ),
      ).toBeGreaterThanOrEqual(3);
      expect(contrast(colors.success, colors.surface)).toBeGreaterThanOrEqual(3);
      expect(contrast(colors.success, colors.border)).toBeGreaterThanOrEqual(3);
    });
  });
}
it('keeps native splash backgrounds aligned with the neutral UI rather than a legacy brand tint', () => {
  const plugin = appConfig.expo.plugins.find(
    (entry) => Array.isArray(entry) && entry[0] === 'expo-splash-screen',
  );
  expect(plugin).toEqual([
    'expo-splash-screen',
    expect.objectContaining({
      backgroundColor: palette.light.background,
      dark: expect.objectContaining({ backgroundColor: palette.dark.background }),
    }),
  ]);
  expect(appConfig.expo.android.adaptiveIcon.backgroundColor).toBe(palette.light.background);
});
