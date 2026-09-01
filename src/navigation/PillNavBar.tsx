import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';

export type TabKey = 'upload' | 'search' | 'chat';

const ACCENT = '#4285f4';
const MUTED = '#5f6368';

type IconProps = {color: string};

function UploadIcon({color}: IconProps): React.JSX.Element {
  return (
    <View style={styles.icon}>
      <View style={[styles.arrowHead, {borderBottomColor: color}]} />
      <View style={[styles.arrowStem, {backgroundColor: color}]} />
      <View style={[styles.arrowBase, {backgroundColor: color}]} />
    </View>
  );
}

function SearchIcon({color}: IconProps): React.JSX.Element {
  return (
    <View style={styles.icon}>
      <View style={[styles.lens, {borderColor: color}]} />
      <View style={[styles.handle, {backgroundColor: color}]} />
    </View>
  );
}

function ChatIcon({color}: IconProps): React.JSX.Element {
  return (
    <View style={styles.icon}>
      <View style={[styles.bubble, {borderColor: color}]} />
      <View style={[styles.bubbleTail, {borderColor: color}]} />
    </View>
  );
}

type TabConfig = {
  key: TabKey;
  label: string;
  Icon: (p: IconProps) => React.JSX.Element;
};

const TABS: TabConfig[] = [
  {key: 'upload', label: 'Upload', Icon: UploadIcon},
  {key: 'search', label: 'Search', Icon: SearchIcon},
  {key: 'chat', label: 'Chat', Icon: ChatIcon},
];

type Props = {
  activeTab: TabKey;
  onTabPress: (tab: TabKey) => void;
};

function PillNavBar({activeTab, onTabPress}: Props): React.JSX.Element {
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        {TABS.map(({key, label, Icon}) => {
          const active = key === activeTab;
          return (
            <TouchableOpacity
              key={key}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{selected: active}}
              onPress={() => onTabPress(key)}
              style={[styles.item, active && styles.itemActive]}>
              <Icon color={active ? ACCENT : MUTED} />
              {active ? <Text style={styles.label}>{label}</Text> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 12,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 6,
    borderRadius: 28,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e0e0e0',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 10,
  },
  item: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  itemActive: {
    backgroundColor: 'rgba(66, 133, 244, 0.12)',
  },
  label: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: '600',
  },
  icon: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowHead: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderBottomWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  arrowStem: {
    width: 2.5,
    height: 7,
  },
  arrowBase: {
    width: 14,
    height: 2.5,
    borderRadius: 1,
    marginTop: 2,
  },
  lens: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
  },
  handle: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 6,
    height: 2,
    borderRadius: 1,
    transform: [{rotate: '45deg'}],
  },
  bubble: {
    width: 18,
    height: 14,
    borderRadius: 5,
    borderWidth: 2,
  },
  bubbleTail: {
    position: 'absolute',
    left: 4,
    bottom: 1,
    width: 5,
    height: 5,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    transform: [{rotate: '45deg'}],
  },
});

export default PillNavBar;
