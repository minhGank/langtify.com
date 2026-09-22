import { router } from 'expo-router';
import { IconButton } from './icon-button';

// Return undefined during ordinary stack navigation so iOS keeps its native
// back item and interactive edge gesture. Direct entries get one fixed fallback.
export function nativeBackFallback() {
  return router.canGoBack()
    ? undefined
    : () => (
        <IconButton
          name="chevron-back"
          label="Back to Discover"
          onPress={() => router.replace('/discover')}
        />
      );
}
