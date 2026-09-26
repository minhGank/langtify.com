import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

// Conservative until the OS answers, with one native subscription for all controls.
let reduced = true;
let generation = 0;
let removeListener: (() => void) | undefined;
const listeners = new Set<() => void>();
const snapshot = () => reduced;
const serverSnapshot = () => true;
function update(value: boolean) {
  if (reduced === value) return;
  reduced = value;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    update(true);
    const request = ++generation;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      generation += 1; // A late initial query must not override a newer OS event.
      update(value);
    });
    removeListener = () => subscription?.remove();
    void Promise.resolve(AccessibilityInfo.isReduceMotionEnabled())
      .then((value) => {
        if (generation === request && listeners.size) update(value !== false);
      })
      .catch(() => {}); // Keep motion disabled if preferences cannot be read.
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      generation += 1;
      removeListener?.();
      removeListener = undefined;
    }
  };
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
