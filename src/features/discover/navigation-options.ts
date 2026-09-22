// Native stack owns the status-bar inset, header and iOS edge-back recognizer.
export const postScreenOptions = {
  headerShown: true,
  title: 'Photo',
  presentation: 'card',
  gestureEnabled: true,
  headerBackButtonDisplayMode: 'minimal',
} as const;
