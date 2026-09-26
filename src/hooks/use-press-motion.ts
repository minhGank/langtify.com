import { useEffect, useState } from 'react';
import { Animated, AppState } from 'react-native';
import { useReducedMotion } from './use-reduced-motion';
import { motion } from '@/lib/motion';

export function usePressMotion(disabled: boolean) {
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced || disabled) {
      scale.stopAnimation();
      scale.setValue(1);
      return;
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        scale.stopAnimation();
        scale.setValue(1);
      }
    });
    return () => {
      subscription.remove();
      scale.stopAnimation();
    };
  }, [disabled, reduced, scale]);
  function press(pressed: boolean) {
    if (reduced || disabled || AppState.currentState !== 'active') return;
    scale.stopAnimation();
    Animated.timing(scale, {
      toValue: pressed ? motion.pressScale : 1,
      duration: motion.duration.press,
      easing: motion.easing,
      useNativeDriver: true,
      isInteraction: false,
    }).start();
  }
  return {
    style: { transform: [{ scale: reduced || disabled ? 1 : scale }] },
    onPressIn: () => press(true),
    onPressOut: () => press(false),
  };
}
