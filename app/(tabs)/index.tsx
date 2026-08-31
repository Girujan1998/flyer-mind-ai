import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FlyerCard } from '@/components/FlyerCard';
import { useFlyerStore } from '@/store/flyerStore';
import { colors, spacing } from '@/theme';

export default function FlyersScreen() {
  const insets = useSafeAreaInsets();
  const { flyers, isAnalyzing, error, analyzeFlyer } = useFlyerStore();

  return (
    <View style={styles.container}>
      <FlatList
        data={flyers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
        renderItem={({ item }) => <FlyerCard flyer={item} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            No flyers yet. Capture or import one and let the AI break it down.
          </Text>
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.subtitle}>
              Point Flyer Mind AI at an event poster and get a clean, structured summary.
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              title={isAnalyzing ? 'Analyzing…' : 'Analyze a sample flyer'}
              loading={isAnalyzing}
              onPress={() => analyzeFlyer({ imageUrl: 'https://example.com/sample-flyer.jpg' })}
            />
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.md },
  header: { gap: spacing.md, marginBottom: spacing.lg },
  subtitle: { color: colors.textMuted, fontSize: 15, lineHeight: 21 },
  error: { color: colors.danger, fontSize: 14 },
  empty: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: spacing.xl },
});
