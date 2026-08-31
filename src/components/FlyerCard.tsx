import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Flyer } from '@/store/flyerStore';
import { colors, radius, spacing } from '@/theme';

export function FlyerCard({ flyer }: { flyer: Flyer }) {
  return (
    <Link href={`/flyer/${flyer.id}`} asChild>
      <Pressable style={styles.card} accessibilityRole="button">
        <Text style={styles.title} numberOfLines={1}>
          {flyer.title}
        </Text>
        <Text style={styles.summary} numberOfLines={2}>
          {flyer.summary}
        </Text>
        <View style={styles.tagRow}>
          {flyer.tags.slice(0, 3).map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  summary: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tag: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  tagText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
});
