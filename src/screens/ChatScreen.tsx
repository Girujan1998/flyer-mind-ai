import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

function ChatScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Chat</Text>
      <Text style={styles.subtitle}>Ask about your flyers.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 96,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 15,
    color: '#666',
  },
});

export default ChatScreen;
