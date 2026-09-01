import React from 'react';
import {StyleSheet, Text, View} from 'react-native';

function UploadScreen(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Upload</Text>
      <Text style={styles.subtitle}>Pick a flyer to get started.</Text>
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

export default UploadScreen;
