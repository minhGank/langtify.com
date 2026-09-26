import { Easing } from 'react-native';

// One-shot feedback only. Native stack/sheet gestures keep platform timing.
export const motion = {
  duration: { press: 140, change: 220, step: 260 },
  easing: Easing.out(Easing.cubic),
  pressScale: 0.98,
  stepDistance: 20,
  spring: { damping: 22, stiffness: 240, mass: 0.8, overshootClamping: true },
} as const;
