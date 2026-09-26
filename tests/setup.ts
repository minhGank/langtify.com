import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';

import mockSafeAreaContext from 'react-native-safe-area-context/jest/mock';
import { clearServerData } from '@/lib/server-cache';
import { AccessibilityInfo } from 'react-native';

beforeEach(() => {
  clearServerData();
  // Deterministic baseline; motion-specific tests exercise OS queries/events and
  // native-driver transitions explicitly. Product behavior is never mocked out.
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});

jest.mock('react-native-safe-area-context', () => mockSafeAreaContext);

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
