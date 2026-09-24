import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { useAppTheme } from '@/hooks/use-app-theme';

const hours = Array.from({ length: 24 }, (_, value) => String(value).padStart(2, '0'));
const minutes = Array.from({ length: 60 }, (_, value) => String(value).padStart(2, '0'));
const ROW_HEIGHT = 48;

export function NotificationTimeField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { colors } = useAppTheme();
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState('08');
  const [minute, setMinute] = useState('00');
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value }}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => {
          const [nextHour, nextMinute] = value.split(':');
          setHour(nextHour ?? '08');
          setMinute(nextMinute ?? '00');
          setOpen(true);
        }}
        style={styles.row}
      >
        <AppText style={styles.label}>{label}</AppText>
        <AppText
          variant="label"
          style={{ color: disabled ? colors.textSecondary : colors.brandText }}
        >
          {value}
        </AppText>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </Pressable>
      <Sheet visible={open} title={label} onClose={() => setOpen(false)} scroll={false}>
        <AppText variant="caption" style={{ color: colors.textSecondary }}>
          24-hour time
        </AppText>
        <View style={styles.columns}>
          {[
            { label: 'Hour', data: hours, value: hour, onChange: setHour },
            { label: 'Minute', data: minutes, value: minute, onChange: setMinute },
          ].map((column) => (
            <View key={column.label} style={styles.column}>
              <AppText variant="label" style={styles.columnTitle}>
                {column.label}
              </AppText>
              <FlatList
                data={column.data}
                keyExtractor={(item) => item}
                initialScrollIndex={Math.max(0, column.data.indexOf(column.value) - 2)}
                getItemLayout={(_, index) => ({
                  length: ROW_HEIGHT,
                  offset: ROW_HEIGHT * index,
                  index,
                })}
                style={styles.list}
                renderItem={({ item }) => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityLabel={`${column.label} ${item}`}
                    accessibilityState={{ checked: column.value === item }}
                    onPress={() => column.onChange(item)}
                    style={[
                      styles.option,
                      {
                        backgroundColor: column.value === item ? colors.brandSoft : colors.surface,
                      },
                    ]}
                  >
                    <AppText
                      variant="subtitle"
                      style={{
                        color: column.value === item ? colors.brandText : colors.textPrimary,
                      }}
                    >
                      {item}
                    </AppText>
                  </Pressable>
                )}
              />
            </View>
          ))}
        </View>
        <Button
          label="Done"
          onPress={() => {
            onChange(`${hour}:${minute}`);
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 48 },
  label: { flex: 1 },
  columns: { flexDirection: 'row', gap: 16, marginVertical: 12 },
  column: { flex: 1, gap: 8 },
  columnTitle: { textAlign: 'center' },
  list: { flexGrow: 0, height: ROW_HEIGHT * 4 },
  option: { height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
});
