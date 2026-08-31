import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { env } from '@/config/env';
import { useFlyerStore } from '@/store/flyerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { colors, radius, spacing } from '@/theme';

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export default function SettingsScreen() {
  const { useMockAi, notificationsEnabled, setUseMockAi, setNotificationsEnabled } =
    useSettingsStore();
  const clear = useFlyerStore((s) => s.clear);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Row>
          <Text style={styles.label}>Use mock AI responses</Text>
          <Switch value={useMockAi} onValueChange={setUseMockAi} />
        </Row>
        <Row>
          <Text style={styles.label}>Event reminders</Text>
          <Switch value={notificationsEnabled} onValueChange={setNotificationsEnabled} />
        </Row>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Environment</Text>
        <Text style={styles.meta}>API base URL: {env.apiBaseUrl}</Text>
        <Text style={styles.meta}>AI model: {env.aiModel}</Text>
      </View>

      <Text style={styles.link} onPress={clear}>
        Clear all saved flyers
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: colors.text, fontSize: 15 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: spacing.xs },
  meta: { color: colors.textMuted, fontSize: 13 },
  link: { color: colors.danger, fontSize: 14, textAlign: 'center', padding: spacing.md },
});
