import { Tabs } from 'expo-router';

import { FloatingPillTabBar } from '@/components/FloatingPillTabBar';
import { colors } from '@/theme';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingPillTabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Upload',
        }}
      />
    </Tabs>
  );
}
