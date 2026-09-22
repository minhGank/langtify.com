import { avatarCrop } from '@/features/profile/prepare-avatar';

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
it('centers a square avatar crop without trusting nonfinite or excessive source dimensions', () => {
  expect(avatarCrop(1200, 800)).toEqual({ originX: 200, originY: 0, width: 800, height: 800 });
  expect(avatarCrop(800, 1200)).toEqual({ originX: 0, originY: 200, width: 800, height: 800 });
  for (const [width, height] of [
    [0, 100],
    [NaN, 100],
    [100, Infinity],
    [8000, 6000],
  ])
    expect(() => avatarCrop(width, height)).toThrow('Choose a smaller photo.');
});
