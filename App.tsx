import React, {useState} from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  useColorScheme,
} from 'react-native';

import PillNavBar, {TabKey} from './src/navigation/PillNavBar';
import ChatScreen from './src/screens/ChatScreen';
import SearchScreen from './src/screens/SearchScreen';
import UploadScreen from './src/screens/UploadScreen';

function ActiveScreen({tab}: {tab: TabKey}): React.JSX.Element {
  switch (tab) {
    case 'search':
      return <SearchScreen />;
    case 'chat':
      return <ChatScreen />;
    default:
      return <UploadScreen />;
  }
}

function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';
  const [activeTab, setActiveTab] = useState<TabKey>('upload');

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <ActiveScreen tab={activeTab} />
      <PillNavBar activeTab={activeTab} onTabPress={setActiveTab} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});

export default App;
