import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, type ViewProps } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { motion } from '@/lib/motion';

type MotionProps = ViewProps & {
  trigger: string | number | null;
  kind?: 'change' | 'reward' | 'step';
  direction?: 1 | -1;
  animateOnMount?: boolean;
};

export function MotionView({
  trigger,
  kind = 'change',
  direction = 1,
  animateOnMount = false,
  style,
  ...props
}: MotionProps) {
  const reduced = useReducedMotion();
  const [value] = useState(() => new Animated.Value(1));
  const previous = useRef(trigger);
  const initialized = useRef(false);
  const initialAnimation = useRef(animateOnMount);
  useEffect(() => {
    const changed = initialized.current ? previous.current !== trigger : initialAnimation.current;
    initialized.current = true;
    previous.current = trigger;
    value.stopAnimation();
    value.setValue(1);
    if (!changed || trigger === null || reduced || AppState.currentState !== 'active') return;
    value.setValue(0);
    const animation =
      kind === 'reward'
        ? Animated.spring(value, {
            ...motion.spring,
            toValue: 1,
            useNativeDriver: true,
            isInteraction: false,
          })
        : Animated.timing(value, {
            toValue: 1,
            duration: motion.duration[kind],
            easing: motion.easing,
            useNativeDriver: true,
            isInteraction: false,
          });
    animation.start();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        animation.stop();
        value.setValue(1);
      }
    });
    return () => {
      subscription.remove();
      animation.stop();
      value.setValue(1);
    };
  }, [trigger, kind, direction, reduced, value]);
  return (
    <Animated.View
      {...props}
      style={[
        style,
        !reduced && {
          opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }),
          transform:
            kind === 'step'
              ? [
                  {
                    translateX: value.interpolate({
                      inputRange: [0, 1],
                      outputRange: [direction * motion.stepDistance, 0],
                    }),
                  },
                ]
              : kind === 'reward'
                ? [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }]
                : [],
        },
      ]}
    />
  );
}
