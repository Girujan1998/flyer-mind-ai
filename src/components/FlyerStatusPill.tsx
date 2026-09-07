import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {FlyerStatus} from '../api/extract';
import {Palette, useThemedStyles} from '../theme';

type Known = Exclude<FlyerStatus, 'unknown'>;

const LABEL: Record<Known, string> = {
  valid: 'Active',
  upcoming: 'Upcoming',
  expired: 'Expired',
};

type Props = {
  status: FlyerStatus;
  /** Smaller type + padding, for the search card. */
  compact?: boolean;
};

/** Coloured pill showing whether a flyer's prices are live, upcoming, or lapsed. */
function FlyerStatusPill({status, compact}: Props): React.JSX.Element | null {
  const {styles, colors} = useThemedStyles(makeStyles);
  if (status === 'unknown') {
    return null;
  }
  // Green is the only "prices are live now" state; upcoming and expired both
  // read as muted — the date line ("Starts …" / "Ended …") tells them apart.
  const bg = status === 'valid' ? colors.primary : colors.textMuted;
  return (
    <View
      style={[
        styles.pill,
        compact ? styles.pillCompact : styles.pillRegular,
        {backgroundColor: bg},
      ]}
      accessibilityLabel={`Flyer ${LABEL[status]}`}>
      {status === 'valid' ? (
        <View style={[styles.dot, compact && styles.dotCompact]} />
      ) : null}
      <Text
        style={[
          styles.text,
          compact ? styles.textCompact : styles.textRegular,
        ]}>
        {LABEL[status]}
      </Text>
    </View>
  );
}

const makeStyles = (_c: Palette) =>
  StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 999,
    },
    pillCompact: {gap: 4, paddingVertical: 3, paddingLeft: 6, paddingRight: 8},
    pillRegular: {gap: 5, paddingVertical: 4, paddingLeft: 7, paddingRight: 10},
    dot: {width: 5, height: 5, borderRadius: 3, backgroundColor: '#fff'},
    dotCompact: {width: 4, height: 4, borderRadius: 2},
    text: {color: '#fff', fontWeight: '800', letterSpacing: 0.3},
    textCompact: {fontSize: 10, letterSpacing: 0.2},
    textRegular: {fontSize: 11},
  });

export default FlyerStatusPill;
