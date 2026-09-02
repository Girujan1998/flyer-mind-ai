import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

import {Palette, fonts, spacing, useThemedStyles} from '../theme';

function ChatScreen(): React.JSX.Element {
  const {styles} = useThemedStyles(makeStyles);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Chat</Text>
      <Text style={styles.subtitle}>Ask about your flyers.</Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      paddingBottom: 96,
    },
    title: {
      fontFamily: fonts.display,
      fontSize: 24,
      fontWeight: '700',
      color: c.text,
    },
    subtitle: {
      marginTop: spacing.sm,
      fontSize: 15,
      color: c.textMuted,
    },
  });

export default ChatScreen;
