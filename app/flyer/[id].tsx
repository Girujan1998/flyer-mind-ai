import { Link, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useFlyerStore } from '@/store/flyerStore';
import { colors, radius, spacing } from '@/theme';

export default function FlyerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const flyer = useFlyerStore((s) => s.flyers.find((f) => f.id === id));

  if (!flyer) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>This flyer no longer exists.</Text>
        <Link href="/" style={styles.link}>
          Back to flyers
        </Link>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{flyer.title}</Text>
      <Text style={styles.summary}>{flyer.summary}</Text>

      <View style={styles.card}>
        {flyer.eventDate ? <Detail label="When" value={formatDate(flyer.eventDate)} /> : null}
        {flyer.location ? <Detail label="Where" value={flyer.location} /> : null}
        <Detail label="Tags" value={flyer.tags.join(', ')} />
        <Detail label="Saved" value={formatDate(flyer.createdAt)} />
      </View>
    </ScrollView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  summary: { color: colors.textMuted, fontSize: 15, lineHeight: 22 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  detailLabel: { color: colors.textMuted, fontSize: 14 },
  detailValue: { color: colors.text, fontSize: 14, flexShrink: 1, textAlign: 'right' },
  muted: { color: colors.textMuted },
  link: { color: colors.primary },
});
