import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  LayoutChangeEvent,
  LayoutRectangle,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export type TabKey = 'upload' | 'search' | 'chat';

const ACCENT = '#4285f4';
const MUTED = '#5f6368';
const BAR_PADDING = 6;
const ITEM_HEIGHT = 44;

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
  // Measured frame of each tab within the bar — the highlight springs to
  // whichever one is active. Re-measured whenever a tab grows/shrinks
  // (a label mounting/unmounting changes its width).
  const layouts = useRef<Partial<Record<TabKey, LayoutRectangle>>>({}).current;
  const [ready, setReady] = useState(false);

  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;

  const springTo = (key: TabKey, initial = false) => {
    const l = layouts[key];
    if (!l) {
      return;
    }
    if (initial) {
      x.setValue(l.x);
      width.setValue(l.width);
      return;
    }
    Animated.parallel([
      // Bouncy on travel — this is the "spring" of the mockup.
      Animated.spring(x, {
        toValue: l.x,
        useNativeDriver: false,
        stiffness: 190,
        damping: 15,
        mass: 1,
      }),
      // Snappier on resize so the pill doesn't visibly overshoot its width.
      Animated.spring(width, {
        toValue: l.width,
        useNativeDriver: false,
        stiffness: 220,
        damping: 26,
        mass: 1,
      }),
      // Small scale pop on landing.
      Animated.sequence([
        Animated.timing(pop, {
          toValue: 1.06,
          duration: 110,
          useNativeDriver: false,
        }),
        Animated.spring(pop, {
          toValue: 1,
          useNativeDriver: false,
          stiffness: 240,
          damping: 12,
        }),
      ]),
    ]).start();
  };

  useEffect(() => {
    springTo(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const onTabLayout = (key: TabKey) => (e: LayoutChangeEvent) => {
    layouts[key] = e.nativeEvent.layout;
    if (key !== activeTab) {
      return;
    }
    if (!ready) {
      springTo(key, true);
      setReady(true);
    } else {
      springTo(key);
    }
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        <View style={styles.track}>
          {ready ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.highlight,
                {width, transform: [{translateX: x}, {scale: pop}]},
              ]}
            />
          ) : null}
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
                onLayout={onTabLayout(key)}
                style={styles.item}>
                <Icon color={active ? ACCENT : MUTED} />
                {active ? <Text style={styles.label}>{label}</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 28,
    alignItems: 'center',
  },
  bar: {
    padding: BAR_PADDING,
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
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  highlight: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: ITEM_HEIGHT,
    borderRadius: 22,
    backgroundColor: 'rgba(66, 133, 244, 0.12)',
  },
  item: {
    minHeight: ITEM_HEIGHT,
    paddingHorizontal: 16,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
