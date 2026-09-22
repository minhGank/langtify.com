import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { FormField } from '@/components/ui/form-field';
import { Sheet } from '@/components/ui/sheet';
import { useAppTheme } from '@/hooks/use-app-theme';
import { detectTimezone } from './validation';
import { filterTimezones, timezoneLabel, timezoneOptions } from './timezones';

export function TimezoneField({
  value,
  onChange,
  error,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const options = useMemo(() => timezoneOptions(value, detectTimezone()), [value]);
  const matches = useMemo(() => filterTimezones(options, query), [options, query]);
  return (
    <View style={styles.field}>
      <AppText variant="label">
        Timezone <AppText style={{ color: colors.muted }}>*</AppText>
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Timezone"
        accessibilityValue={{ text: value || 'Choose a timezone' }}
        accessibilityHint={error ?? 'Required. Choose your city or region'}
        accessibilityState={{ disabled: Boolean(disabled), expanded: open }}
        disabled={disabled}
        onPress={() => {
          setQuery('');
          setOpen(true);
        }}
        style={[
          styles.select,
          {
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.border,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        <AppText style={styles.selection}>
          {value ? timezoneLabel(value) : 'Choose a timezone'}
        </AppText>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      {error ? (
        <AppText variant="caption" style={{ color: colors.danger }} accessibilityRole="alert">
          {error}
        </AppText>
      ) : (
        <AppText variant="caption" style={{ color: colors.muted }}>
          Used for your daily challenge and streak.
        </AppText>
      )}
      <Sheet
        title="Choose your timezone"
        visible={open}
        onClose={() => setOpen(false)}
        scroll={false}
      >
        <View style={styles.search}>
          <FormField
            label="Search timezones"
            placeholder="City or region"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
        <FlatList
          data={matches}
          keyExtractor={(item) => item}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={10}
          style={styles.list}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel={timezoneLabel(item)}
              accessibilityState={{ checked: value === item }}
              onPress={() => {
                onChange(item);
                setOpen(false);
              }}
              style={[styles.option, { borderBottomColor: colors.border }]}
            >
              <AppText style={styles.selection}>{timezoneLabel(item)}</AppText>
              {value === item && <Ionicons name="checkmark" size={22} color={colors.primary} />}
            </Pressable>
          )}
          ListEmptyComponent={
            <AppText style={{ color: colors.muted, paddingVertical: 24 }}>
              No timezone found. Try a nearby city or region.
            </AppText>
          }
        />
      </Sheet>
    </View>
  );
}
const styles = StyleSheet.create({
  field: { gap: 8 },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 54,
    padding: 14,
    borderWidth: 1,
    borderRadius: 14,
  },
  selection: { flex: 1 },
  search: { marginBottom: 8 },
  list: { flex: 1 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
