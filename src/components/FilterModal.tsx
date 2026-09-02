import React, {useEffect, useState} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  EMPTY_FILTERS,
  FilterFacets,
  ProductFilters,
  countActiveFilters,
} from '../api/extract';
import {colors, radius, spacing} from '../theme';

type Props = {
  visible: boolean;
  facets: FilterFacets;
  value: ProductFilters;
  onApply: (next: ProductFilters) => void;
  onClose: () => void;
};

const STATUS_LABEL: Record<string, string> = {
  valid: 'Valid',
  upcoming: 'Upcoming',
  expired: 'Expired',
  unknown: 'Unknown / no dates',
};

const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter(x => x !== v) : [...list, v];
}

function FilterModal({
  visible,
  facets,
  value,
  onApply,
  onClose,
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState<ProductFilters>(value);

  // reseed the draft each time the sheet opens
  useEffect(() => {
    if (visible) {
      setDraft(value);
    }
  }, [visible, value]);

  const active = countActiveFilters(draft);

  const section = (
    title: string,
    facetList: {value: string; count: number}[],
    selected: string[],
    onToggle: (v: string) => void,
    labelFor: (v: string) => string,
  ) => {
    if (facetList.length === 0) {
      return null;
    }
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {facetList.map(f => {
          const on = selected.includes(f.value);
          return (
            <Pressable
              key={f.value}
              onPress={() => onToggle(f.value)}
              accessibilityRole="checkbox"
              accessibilityState={{checked: on}}
              style={({pressed}) => [styles.row, pressed && styles.rowPressed]}>
              <View style={[styles.box, on && styles.boxOn]}>
                {on ? <View style={styles.tick} /> : null}
              </View>
              <Text style={styles.rowLabel}>{labelFor(f.value)}</Text>
              <Text style={styles.rowCount}>{f.count}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Filter</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              style={styles.close}>
              <View style={[styles.closeBar, styles.closeBarA]} />
              <View style={[styles.closeBar, styles.closeBarB]} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}>
            {section(
              'Status',
              facets.statuses,
              draft.statuses,
              v => setDraft(d => ({...d, statuses: toggle(d.statuses, v)})),
              v => STATUS_LABEL[v] ?? titleCase(v),
            )}
            {section(
              'Category',
              facets.departments,
              draft.departments,
              v =>
                setDraft(d => ({...d, departments: toggle(d.departments, v)})),
              titleCase,
            )}
            {section(
              'Store',
              facets.stores,
              draft.stores,
              v => setDraft(d => ({...d, stores: toggle(d.stores, v)})),
              v => v,
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={() => setDraft(EMPTY_FILTERS)}
              disabled={active === 0}
              style={({pressed}) => [
                styles.reset,
                active === 0 && styles.resetOff,
                pressed && styles.rowPressed,
              ]}>
              <Text style={styles.resetText}>Reset</Text>
            </Pressable>
            <Pressable
              onPress={() => onApply(draft)}
              style={({pressed}) => [styles.apply, pressed && styles.applyOn]}>
              <Text style={styles.applyText}>
                {active > 0 ? `Apply (${active})` : 'Apply'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  backdropFill: {flex: 1},
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {fontSize: 18, fontWeight: '700', color: colors.text},
  close: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBar: {
    position: 'absolute',
    width: 16,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.textMuted,
  },
  closeBarA: {transform: [{rotate: '45deg'}]},
  closeBarB: {transform: [{rotate: '-45deg'}]},
  body: {alignSelf: 'stretch'},
  bodyContent: {padding: spacing.md, paddingBottom: spacing.lg},
  section: {marginBottom: spacing.lg},
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
  },
  rowPressed: {opacity: 0.6},
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  tick: {width: 8, height: 8, borderRadius: 2, backgroundColor: '#fff'},
  rowLabel: {flex: 1, fontSize: 15, color: colors.text},
  rowCount: {
    fontSize: 13,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  reset: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetOff: {opacity: 0.4},
  resetText: {fontSize: 15, fontWeight: '600', color: colors.textMuted},
  apply: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyOn: {opacity: 0.85},
  applyText: {fontSize: 15, fontWeight: '700', color: '#fff'},
});

export default FilterModal;
