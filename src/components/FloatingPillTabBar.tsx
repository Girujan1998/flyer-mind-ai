import { Feather } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/theme';

/** Route name -> Feather icon. Add an entry when a route joins the pill. */
const ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  index: 'upload',
};

/**
 * Floating pill navigation bar: a detached, rounded bar centered above the
 * home indicator. The focused route expands into a tinted label pill; other
 * routes render as icon-only targets.
 */
export function FloatingPillTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { bottom: insets.bottom + spacing.md }]} pointerEvents="box-none">
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : (options.title ?? route.name);
          const focused = state.index === index;
          const iconName = ICONS[route.name] ?? 'circle';

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              onPress={onPress}
              style={[styles.item, focused && styles.itemFocused]}
            >
              <Feather
                name={iconName}
                size={20}
                color={focused ? colors.primary : colors.textMuted}
              />
              {focused && <Text style={styles.label}>{label}</Text>}
            </Pressable>
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
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 28,
    padding: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  item: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg + 2,
  },
  itemFocused: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md + 2,
    backgroundColor: 'rgba(91, 140, 255, 0.16)',
  },
  label: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
});
