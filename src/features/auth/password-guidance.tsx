import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from '@/components/ui/app-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import { validateSignupPassword } from './password-policy';

export function PasswordGuidance({ password }: { password: string }) {
  const { colors } = useAppTheme();
  const error = validateSignupPassword(password);
  return (
    <View style={{ gap: 6 }}>
      {!!password && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons
            name={error ? 'ellipse-outline' : 'checkmark-circle'}
            color={error ? colors.textSecondary : colors.success}
            size={18}
            accessible={false}
          />
          <AppText variant="caption" accessibilityLiveRegion="polite">
            {error ?? 'Length requirement met'}
          </AppText>
        </View>
      )}
    </View>
  );
}
