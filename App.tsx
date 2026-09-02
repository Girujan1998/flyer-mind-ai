import React, {useState} from 'react';
import {SafeAreaView, StatusBar, StyleSheet, View} from 'react-native';

import PillNavBar, {TabKey} from './src/navigation/PillNavBar';
import ChatScreen from './src/screens/ChatScreen';
import SearchScreen from './src/screens/SearchScreen';
import UploadScreen from './src/screens/UploadScreen';
import {useTheme} from './src/theme';

function App(): React.JSX.Element {
  const {colors, dark} = useTheme();
  const [activeTab, setActiveTab] = useState<TabKey>('upload');

  // Every screen stays mounted so its state (an in-progress upload, the search
  // query + filters + scroll position) survives switching tabs, leaving the app,
  // or the phone sleeping. A full relaunch is the only thing that resets it.
  return (
    <SafeAreaView
      style={[styles.container, {backgroundColor: colors.background}]}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />

      <View style={[styles.screen, activeTab !== 'upload' && styles.hidden]}>
        <UploadScreen />
      </View>
      <View style={[styles.screen, activeTab !== 'search' && styles.hidden]}>
        <SearchScreen />
      </View>
      <View style={[styles.screen, activeTab !== 'chat' && styles.hidden]}>
        <ChatScreen />
      </View>

      <PillNavBar activeTab={activeTab} onTabPress={setActiveTab} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  // The active screen takes all the space; hidden ones are dropped from layout
  // but stay mounted, keeping their state.
  screen: {flex: 1},
  hidden: {display: 'none'},
});

export default App;
