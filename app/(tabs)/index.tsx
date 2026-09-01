import { Feather } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useMemo, useState } from 'react';
import { Dimensions, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  extractFlyer,
  NoServerError,
  sampleFlyerFile,
  type ExtractResult,
  type Product,
  type SelectedPdf,
} from '@/api/extract';
import { Button } from '@/components/Button';
import { ProductCard } from '@/components/ProductCard';
import { SourcePageModal } from '@/components/SourcePageModal';
import { colors, spacing } from '@/theme';

type Phase =
  | { kind: 'idle' }
  | { kind: 'extracting' }
  | { kind: 'done'; result: ExtractResult }
  | { kind: 'error'; message: string };

const GAP = spacing.sm;
const COLUMN_WIDTH = (Dimensions.get('window').width - spacing.md * 2 - GAP) / 2;

export default function UploadScreen() {
  const insets = useSafeAreaInsets();
  const [file, setFile] = useState<SelectedPdf | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [selected, setSelected] = useState<Product | null>(null);

  const pagesByNumber = useMemo(() => {
    if (phase.kind !== 'done') return new Map<number, ExtractResult['pages'][number]>();
    return new Map(phase.result.pages.map((p) => [p.page, p]));
  }, [phase]);

  const selectPdf = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setFile({ uri: asset.uri, name: asset.name, size: asset.size, mimeType: asset.mimeType });
    setPhase({ kind: 'idle' });
  };

  const runExtract = async (load: () => Promise<ExtractResult>) => {
    setPhase({ kind: 'extracting' });
    try {
      setPhase({ kind: 'done', result: await load() });
    } catch (error) {
      setPhase({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Extraction failed',
      });
    }
  };

  const upload = () => {
    if (file) runExtract(() => extractFlyer(file));
  };

  // Real pipeline on the bundled sample PDF; canned data if no server is up.
  const trySample = () =>
    runExtract(async () => {
      const sample = await sampleFlyerFile();
      try {
        return await extractFlyer(sample);
      } catch (error) {
        if (error instanceof NoServerError) return extractFlyer(sample, { mock: true });
        throw error;
      }
    });

  const reset = () => {
    setFile(null);
    setPhase({ kind: 'idle' });
  };

  if (phase.kind === 'done') {
    return (
      <View style={styles.container}>
        <FlatList
          data={phase.result.products}
          keyExtractor={(p) => p.id}
          numColumns={2}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={[
            styles.grid,
            { paddingBottom: insets.bottom + spacing.xl * 3, gap: GAP },
          ]}
          ListHeaderComponent={
            <View style={styles.gridHeader}>
              <Text style={styles.count}>
                {phase.result.products.length} products · {file?.name}
              </Text>
              <Text style={styles.link} onPress={reset}>
                New flyer
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              page={pagesByNumber.get(item.page)}
              width={COLUMN_WIDTH}
              onPress={setSelected}
            />
          )}
        />
        <SourcePageModal
          product={selected}
          page={selected ? pagesByNumber.get(selected.page) : undefined}
          onClose={() => setSelected(null)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, styles.pad, { paddingBottom: insets.bottom + spacing.xl * 3 }]}>
      <Text style={styles.subtitle}>
        Select a flyer PDF and upload it — each product is pulled out with its price and a crop
        from the page.
      </Text>

      <View style={styles.fileBox}>
        <Feather
          name={file ? 'file-text' : 'upload-cloud'}
          size={28}
          color={file ? colors.primary : colors.textMuted}
        />
        <Text style={styles.fileName} numberOfLines={1}>
          {file ? file.name : 'No PDF selected'}
        </Text>
        {file?.size != null ? <Text style={styles.fileMeta}>{formatBytes(file.size)}</Text> : null}
      </View>

      <View style={styles.actions}>
        <Button title="Select PDF" variant="ghost" onPress={selectPdf} />
        <Button
          title={phase.kind === 'extracting' ? 'Extracting…' : 'Upload flyer'}
          loading={phase.kind === 'extracting'}
          disabled={!file}
          onPress={upload}
        />
      </View>

      {phase.kind === 'error' ? <Text style={styles.error}>{phase.message}</Text> : null}

      <Text style={styles.sampleLink} onPress={trySample}>
        or try a sample Walmart flyer
      </Text>
    </View>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  pad: { padding: spacing.md, gap: spacing.lg },
  subtitle: { color: colors.textMuted, fontSize: 15, lineHeight: 21 },
  fileBox: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
  },
  fileName: { color: colors.text, fontSize: 15, fontWeight: '600', maxWidth: '100%' },
  fileMeta: { color: colors.textMuted, fontSize: 13 },
  actions: { gap: spacing.sm },
  error: { color: colors.danger, fontSize: 14 },
  sampleLink: { color: colors.primary, fontSize: 14, textAlign: 'center' },
  grid: { padding: spacing.md },
  gridHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  count: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
  link: { color: colors.primary, fontSize: 14, fontWeight: '600' },
});
