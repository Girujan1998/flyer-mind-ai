import React, {useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DocumentPicker, {isCancel, types} from 'react-native-document-picker';

import {
  NoServerError,
  SelectedPdf,
  UploadResult,
  extractFlyer,
} from '../api/extract';
import {colors, radius, spacing} from '../theme';

type Phase =
  | {kind: 'idle'}
  | {kind: 'uploading'}
  | {kind: 'done'; result: UploadResult}
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
    setPhase({kind: 'uploading'});
    try {
      const result = await extractFlyer(file);
      setPhase({kind: 'done', result});
      setFile(null);
    } catch (err) {
      setPhase({
        kind: 'error',
        message:
          err instanceof NoServerError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'Upload failed',
      });
    }
  };

  if (phase.kind === 'done') {
    const {savedProducts, renderedPages, failedPages, reused, name} =
      phase.result;
    return (
      <View style={styles.container}>
        <View style={styles.doneCard}>
          <Text style={styles.check}>✓</Text>
          <Text style={styles.doneTitle}>
            {reused ? 'Already extracted' : 'Saved'}
          </Text>
          <Text style={styles.doneBody}>
            {savedProducts} product{savedProducts === 1 ? '' : 's'} from {name}
            {'\n'}
            {renderedPages} page{renderedPages === 1 ? '' : 's'}
            {failedPages.length > 0
              ? ` · couldn't read ${failedPages.length}`
              : ''}
          </Text>
          <Text style={styles.hint}>Browse them on the Search tab.</Text>
        </View>
        <Pressable
          onPress={() => setPhase({kind: 'idle'})}
          style={({pressed}) => [
            styles.btn,
            styles.btnGhost,
            pressed && styles.pressed,
          ]}>
          <Text style={styles.btnGhostText}>Upload another</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Upload</Text>
      <Text style={styles.subtitle}>
        Add a flyer PDF from your device. Its products, prices and bounding
        boxes are extracted and saved — find them on Search.
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
        disabled={!file || phase.kind === 'uploading'}
        style={({pressed}) => [
          styles.btn,
          styles.btnPrimary,
          (!file || phase.kind === 'uploading') && styles.btnDisabled,
          pressed && styles.pressed,
        ]}>
        {phase.kind === 'uploading' ? (
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
  doneCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  check: {
    fontSize: 28,
    color: colors.primary,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  doneTitle: {fontSize: 18, fontWeight: '700', color: colors.text},
  doneBody: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  hint: {
    fontSize: 13,
    color: colors.primary,
    marginTop: spacing.sm,
  },
});

export default UploadScreen;
