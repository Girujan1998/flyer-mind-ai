import React, {useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DocumentPicker, {isCancel, types} from 'react-native-document-picker';

import {
  ExtractResult,
  NoServerError,
  Product,
  SelectedPdf,
  extractFlyer,
} from '../api/extract';
import ProductCard from '../components/ProductCard';
import SourcePageModal from '../components/SourcePageModal';
import {colors, radius, spacing} from '../theme';

const GAP = spacing.sm;
const COLUMN_WIDTH =
  (Dimensions.get('window').width - spacing.md * 2 - GAP) / 2;

type Phase =
  | {kind: 'idle'}
  | {kind: 'extracting'}
  | {kind: 'done'; result: ExtractResult}
  | {kind: 'error'; message: string};

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadScreen(): React.JSX.Element {
  const [file, setFile] = useState<SelectedPdf | null>(null);
  const [phase, setPhase] = useState<Phase>({kind: 'idle'});
  const [selected, setSelected] = useState<Product | null>(null);

  const pagesByNumber = useMemo(() => {
    if (phase.kind !== 'done') {
      return new Map<number, ExtractResult['pages'][number]>();
    }
    return new Map(phase.result.pages.map(p => [p.page, p]));
  }, [phase]);

  const selectPdf = async () => {
    try {
      const res = await DocumentPicker.pickSingle({
        type: [types.pdf],
        copyTo: 'cachesDirectory',
      });
      setFile({
        uri: res.fileCopyUri ?? res.uri,
        name: res.name ?? 'flyer.pdf',
        size: res.size ?? undefined,
        mimeType: res.type ?? 'application/pdf',
      });
      setPhase({kind: 'idle'});
    } catch (err) {
      if (!isCancel(err)) {
        setPhase({
          kind: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Could not open the file picker',
        });
      }
    }
  };

  const upload = async () => {
    if (!file) {
      return;
    }
    setPhase({kind: 'extracting'});
    try {
      const result = await extractFlyer(file);
      setPhase({kind: 'done', result});
    } catch (err) {
      setPhase({
        kind: 'error',
        message:
          err instanceof NoServerError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Extraction failed',
      });
    }
  };

  const reset = () => {
    setFile(null);
    setPhase({kind: 'idle'});
  };

  if (phase.kind === 'done') {
    const {products, meta} = phase.result;
    return (
      <View style={styles.flex}>
        <FlatList
          data={products}
          keyExtractor={p => p.id}
          numColumns={2}
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.grid}
          ListHeaderComponent={
            <View style={styles.gridHeader}>
              <View style={styles.headerText}>
                <Text style={styles.count}>
                  {products.length} product{products.length === 1 ? '' : 's'}
                  {meta
                    ? ` · ${meta.renderedPages} page${
                        meta.renderedPages === 1 ? '' : 's'
                      }`
                    : ''}
                </Text>
                {meta?.failedPages && meta.failedPages.length > 0 ? (
                  <Text style={styles.warn}>
                    couldn't read page{meta.failedPages.length === 1 ? '' : 's'}{' '}
                    {meta.failedPages.join(', ')}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.link} onPress={reset}>
                New flyer
              </Text>
            </View>
          }
          renderItem={({item}) => (
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
    <View style={styles.container}>
      <Text style={styles.title}>Upload</Text>
      <Text style={styles.subtitle}>
        Add a flyer PDF from your device, then upload it to pull out each
        product with its price and a crop from the page.
      </Text>

      <View style={styles.fileBox}>
        <Text style={styles.fileName} numberOfLines={1}>
          {file ? file.name : 'No PDF selected'}
        </Text>
        {file?.size != null ? (
          <Text style={styles.fileMeta}>{formatBytes(file.size)}</Text>
        ) : null}
      </View>

      <Pressable
        onPress={selectPdf}
        style={({pressed}) => [
          styles.btn,
          styles.btnGhost,
          pressed && styles.pressed,
        ]}>
        <Text style={styles.btnGhostText}>Select PDF</Text>
      </Pressable>

      <Pressable
        onPress={upload}
        disabled={!file || phase.kind === 'extracting'}
        style={({pressed}) => [
          styles.btn,
          styles.btnPrimary,
          (!file || phase.kind === 'extracting') && styles.btnDisabled,
          pressed && styles.pressed,
        ]}>
        {phase.kind === 'extracting' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnPrimaryText}>Upload flyer</Text>
        )}
      </Pressable>

      {phase.kind === 'error' ? (
        <Text style={styles.error}>{phase.message}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  container: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    gap: spacing.md,
  },
  title: {fontSize: 24, fontWeight: '700', color: colors.text},
  subtitle: {fontSize: 15, color: colors.textMuted, lineHeight: 21},
  fileBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  fileName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    maxWidth: '100%',
  },
  fileMeta: {color: colors.textMuted, fontSize: 13},
  btn: {
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  btnGhost: {borderWidth: 1, borderColor: colors.border},
  btnGhostText: {color: colors.textMuted, fontSize: 15, fontWeight: '600'},
  btnPrimary: {backgroundColor: colors.primary},
  btnPrimaryText: {color: '#fff', fontSize: 15, fontWeight: '600'},
  btnDisabled: {opacity: 0.5},
  pressed: {opacity: 0.7},
  error: {color: colors.danger, fontSize: 14},
  grid: {padding: spacing.md, paddingBottom: 96, gap: GAP},
  column: {gap: GAP},
  gridHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  headerText: {flexShrink: 1, gap: 2},
  count: {color: colors.textMuted, fontSize: 13},
  warn: {color: colors.danger, fontSize: 12},
  link: {color: colors.primary, fontSize: 14, fontWeight: '600'},
});

export default UploadScreen;
