import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {Palette, fonts, spacing, useThemedStyles} from '../theme';

type Props = {
  title: string;
  /** Muted text on the right, e.g. "815 items". */
  trailing?: string;
  /** A control on the right (e.g. a "New chat" button). Wins over `trailing`. */
  action?: React.ReactNode;
};

/** The small masthead at the top of Search and Upload. */
function ScreenHeader({title, trailing, action}: Props): React.JSX.Element {
  const {styles} = useThemedStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.rule} />
      {action ??
        (trailing ? <Text style={styles.trailing}>{trailing}</Text> : null)}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    title: {
      fontFamily: fonts.display,
      fontSize: 17,
      fontWeight: '700',
      color: c.text,
      letterSpacing: 0.1,
    },
    rule: {flex: 1, height: 1, backgroundColor: c.border},
    trailing: {
      fontSize: 11,
      color: c.textMuted,
      fontVariant: ['tabular-nums'],
    },
  });

export default ScreenHeader;
