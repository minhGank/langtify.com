import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { NotificationProvider } from '@/features/notifications/notification-provider';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider, useAuth } from '@/features/auth/auth-provider';

import { useAppTheme } from '@/hooks/use-app-theme';
import { postScreenOptions } from '@/features/discover/navigation-options';

export { ErrorBoundary } from 'expo-router';

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}

export function RootNavigator() {
  const { status } = useAuth();
  const { isDark, colors } = useAppTheme();
  const baseTheme = isDark ? DarkTheme : DefaultTheme;

  return (
    <ThemeProvider
      value={{
        ...baseTheme,
        colors: {
          ...baseTheme.colors,
          primary: colors.primary,
          background: colors.background,
          card: colors.surface,
          text: colors.text,
          border: colors.border,
        },
      }}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <NotificationProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected
            guard={status === 'loading' || status === 'error' || status === 'unconfigured'}
          >
            <Stack.Screen name="session" />
          </Stack.Protected>
          <Stack.Protected guard={status === 'signed-out'}>
            <Stack.Screen name="sign-in" />
            <Stack.Screen name="sign-up" />
          </Stack.Protected>
          <Stack.Protected guard={status === 'onboarding'}>
            <Stack.Screen name="onboarding" />
          </Stack.Protected>
          <Stack.Protected guard={status === 'ready'}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="photo" />
            <Stack.Screen
              name="past-words"
              options={{
                headerShown: true,
                title: 'Past Words',
                gestureEnabled: true,
                headerBackButtonDisplayMode: 'minimal',
              }}
            />
            <Stack.Screen name="post" options={postScreenOptions} />
            <Stack.Screen
              name="explore"
              options={{
                headerShown: true,
                title: 'Search',
                gestureEnabled: true,
                headerBackButtonDisplayMode: 'minimal',
              }}
            />
            <Stack.Screen
              name="explore-concept"
              options={{
                headerShown: true,
                title: 'Word',
                gestureEnabled: true,
                headerBackButtonDisplayMode: 'minimal',
              }}
            />
            <Stack.Screen name="vocabulary-concept" />
            <Stack.Screen name="blocked-users" />
            <Stack.Screen name="moderation" />
            <Stack.Screen name="notification-settings" />
            <Stack.Screen name="edit-profile" />
            <Stack.Screen name="learning-settings" />
            <Stack.Screen
              name="people"
              options={{
                headerShown: true,
                title: 'Search',
                gestureEnabled: true,
                headerBackButtonDisplayMode: 'minimal',
              }}
            />
            <Stack.Screen name="public-profile" />
            <Stack.Screen name="connections" />
            <Stack.Screen name="notifications" />
          </Stack.Protected>
          <Stack.Screen name="auth/callback" />
        </Stack>
      </NotificationProvider>
    </ThemeProvider>
  );
}
