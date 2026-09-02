import React, {useRef, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DocumentPicker, {isCancel, types} from 'react-native-document-picker';

import {
  AbortedError,
  NoServerError,
  SelectedPdf,
  UploadResult,
  extractFlyer,
  formatValidity,
} from '../api/extract';
import {MAX_UPLOAD_MB} from '../config';
import {colors, radius, spacing} from '../theme';

type Phase =
  | {kind: 'idle'}
  | {kind: 'uploading'}
  | {kind: 'reconnecting'; attempt: number}
  | {kind: 'done'; result: UploadResult}
  | {kind: 'error'; message: string};

/** How long to keep retrying after the connection drops (phone lock, Wi-Fi blip). */
const RETRY_WINDOW_MS = 5 * 60 * 1000;
const RETRY_GAP_MS = 3000;

/** Sleep that resolves early if the signal aborts. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal.addEventListener?.('abort', onAbort);
  });
}

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
  const abortRef = useRef<AbortController | null>(null);
  const working = phase.kind === 'uploading' || phase.kind === 'reconnecting';

  const selectPdf = async () => {
    try {
      const res = await DocumentPicker.pickSingle({
        type: [types.pdf],
        copyTo: 'cachesDirectory',
      });
      const size = res.size ?? undefined;
      if (size != null && size > MAX_UPLOAD_MB * 1024 * 1024) {
        setFile(null);
        setPhase({
          kind: 'error',
          message: `That PDF is ${formatBytes(
            size,
          )} — larger than the ${MAX_UPLOAD_MB} MB limit. Split it or lower its resolution first.`,
        });
        return;
      }
      setFile({
        uri: res.fileCopyUri ?? res.uri,
        name: res.name ?? 'flyer.pdf',
        size,
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
    if (!file || working) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({kind: 'uploading'});

    const stopAt = Date.now() + RETRY_WINDOW_MS;
    let attempt = 0;
    try {
      for (;;) {
        try {
          const result = await extractFlyer(file, controller.signal);
          setPhase({kind: 'done', result});
          setFile(null);
          return;
        } catch (err) {
          if (err instanceof AbortedError || controller.signal.aborted) {
            setPhase({kind: 'idle'}); // user stopped it — no error
            return;
          }
          // The phone locking / Wi-Fi dropping kills the request, but the
          // server keeps going and dedups the retry — so keep trying rather
          // than failing. A retry after unlock usually resolves on attempt 1.
          if (err instanceof NoServerError && Date.now() < stopAt) {
            attempt += 1;
            setPhase({kind: 'reconnecting', attempt});
            await delay(RETRY_GAP_MS, controller.signal);
            if (controller.signal.aborted) {
              setPhase({kind: 'idle'});
              return;
            }
            continue;
          }
          setPhase({
            kind: 'error',
            message:
              err instanceof NoServerError
                ? err.message
                : err instanceof Error
                ? err.message
                : 'Upload failed',
          });
          return;
        }
      }
    } finally {
      abortRef.current = null;
    }
  };

  const stopUpload = () => abortRef.current?.abort();

  if (phase.kind === 'done') {
    const {
      savedProducts,
      renderedPages,
      failedPages,
      reused,
      name,
      store,
      validFrom,
      validTo,
    } = phase.result;
    const validity = formatValidity(validFrom, validTo);
    return (
      <View style={styles.container}>
        <View style={styles.doneCard}>
          <Text style={styles.check}>✓</Text>
          <Text style={styles.doneTitle}>
            {reused ? 'Already extracted' : 'Saved'}
          </Text>
          {store ? <Text style={styles.doneStore}>{store}</Text> : null}
          {validity ? (
            <Text style={styles.doneValidity}>Prices valid {validity}</Text>
          ) : null}
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
        disabled={working}
        style={({pressed}) => [
          styles.btn,
          styles.btnGhost,
          working && styles.btnDisabled,
          pressed && styles.pressed,
        ]}>
        <Text style={styles.btnGhostText}>Select PDF</Text>
      </Pressable>

      {working ? (
        <>
          <View style={styles.uploadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.uploadingText}>
              {phase.kind === 'reconnecting'
                ? `Connection dropped — reconnecting. Your flyer is still being processed on the server${
                    phase.attempt > 1 ? ` (attempt ${phase.attempt})` : ''
                  }.`
                : 'Extracting products… this keeps running if you switch tabs or leave the app.'}
            </Text>
          </View>
          <Pressable
            onPress={stopUpload}
            style={({pressed}) => [
              styles.btn,
              styles.btnStop,
              pressed && styles.pressed,
            ]}>
            <Text style={styles.btnStopText}>Stop upload</Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          onPress={upload}
          disabled={!file}
          style={({pressed}) => [
            styles.btn,
            styles.btnPrimary,
            !file && styles.btnDisabled,
            pressed && styles.pressed,
          ]}>
          <Text style={styles.btnPrimaryText}>Upload flyer</Text>
        </Pressable>
      )}

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
  btnStop: {borderWidth: 1, borderColor: colors.danger},
  btnStopText: {color: colors.danger, fontSize: 15, fontWeight: '600'},
  btnDisabled: {opacity: 0.5},
  pressed: {opacity: 0.7},
  uploadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  uploadingText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
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
  doneStore: {fontSize: 15, fontWeight: '600', color: colors.text},
  doneValidity: {fontSize: 13, color: colors.textMuted},
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
