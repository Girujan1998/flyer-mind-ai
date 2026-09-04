import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  Dimensions,
  GestureResponderEvent,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {boxToRect, FlyerPage, Product} from '../api/extract';
import {Palette, fonts, radius, spacing, useThemedStyles} from '../theme';

type Props = {
  product: Product | null;
  page: FlyerPage | undefined;
  onClose: () => void;
};

/** Full flyer page with the product's detected region outlined. */
function SourcePageModal({product, page, onClose}: Props): React.JSX.Element {
  const {styles} = useThemedStyles(makeStyles);
  const visible = product != null && page != null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.name} numberOfLines={1}>
                {product?.name || 'Unnamed item'}
              </Text>
              {product?.price ? (
                <Text style={styles.price}>{product.price}</Text>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
              style={styles.close}>
              <View style={[styles.closeBar, styles.closeBarA]} />
              <View style={[styles.closeBar, styles.closeBarB]} />
            </Pressable>
          </View>

          {visible ? <PageWithBox product={product} page={page} /> : null}
        </View>
      </View>
    </Modal>
  );
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

/** Fraction of the viewport the product box fills when zoomed to it. */
const FILL = 0.64;
const MIN_SCALE = 1; // 1 = fit-width
const MAX_SCALE = 6;
const DOUBLE_TAP_MS = 280;

type Touch = {pageX: number; pageY: number};
const spread = (t: Touch[]) =>
  Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
const midpoint = (t: Touch[]) => ({
  x: (t[0].pageX + t[1].pageX) / 2,
  y: (t[0].pageY + t[1].pageY) / 2,
});

/**
 * Pinch-to-zoom + pan on the flyer page, pure JS (PanResponder + Animated) so
 * it works on Android as well as iOS. Opens zoomed to the product; double-tap
 * or the pill toggles between the product and the whole page.
 */
function PageWithBox({
  product,
  page,
}: {
  product: Product;
  page: FlyerPage;
}): React.JSX.Element {
  const {styles} = useThemedStyles(makeStyles);

  const rect = boxToRect(product.box, page.width, page.height);
  const frac = rect
    ? {
        x: rect.x / page.width,
        y: rect.y / page.height,
        w: rect.width / page.width,
        h: rect.height / page.height,
      }
    : null;

  const viewRef = useRef<View>(null);
  const [vp, setVp] = useState<{w: number; h: number} | null>(null);
  const [zoomedOut, setZoomedOut] = useState(false);
  const origin = useRef({x: 0, y: 0}); // viewport top-left in window coords

  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;

  // committed transform (between gestures) + gesture snapshot
  const cur = useRef({s: 1, x: 0, y: 0});
  const snap = useRef({s: 1, x: 0, y: 0, dist: 0, px: 0, py: 0, pinch: false});
  const lastTap = useRef(0);

  const winW = Dimensions.get('window').width;
  const aspect = page.width > 0 ? page.height / page.width : 1;
  const baseW = vp?.w || winW;
  const baseH = baseW * aspect;

  const boundFor = (s: number) => ({
    x: Math.max(0, (baseW * s - (vp?.w ?? winW)) / 2),
    y: Math.max(0, (baseH * s - (vp?.h ?? 0)) / 2),
  });
  const clampT = (x: number, y: number, s: number) => {
    const b = boundFor(s);
    return {x: clamp(x, -b.x, b.x), y: clamp(y, -b.y, b.y)};
  };

  const apply = (
    sRaw: number,
    xRaw: number,
    yRaw: number,
    animate: boolean,
  ) => {
    const s = Number.isFinite(sRaw) ? clamp(sRaw, MIN_SCALE, MAX_SCALE) : 1;
    const x = Number.isFinite(xRaw) ? xRaw : 0;
    const y = Number.isFinite(yRaw) ? yRaw : 0;
    cur.current = {s, x, y};
    if (animate) {
      Animated.parallel([
        Animated.spring(scale, {
          toValue: s,
          useNativeDriver: false,
          stiffness: 220,
          damping: 24,
        }),
        Animated.spring(tx, {
          toValue: x,
          useNativeDriver: false,
          stiffness: 220,
          damping: 24,
        }),
        Animated.spring(ty, {
          toValue: y,
          useNativeDriver: false,
          stiffness: 220,
          damping: 24,
        }),
      ]).start();
    } else {
      scale.setValue(s);
      tx.setValue(x);
      ty.setValue(y);
    }
  };

  // Transform that centres the product box in the viewport at ~FILL.
  const productView = () => {
    if (
      !frac ||
      !vp ||
      baseW <= 0 ||
      baseH <= 0 ||
      frac.w <= 0 ||
      frac.h <= 0
    ) {
      return {s: 1, x: 0, y: 0};
    }
    const s = clamp(
      Math.min(
        (vp.w * FILL) / (frac.w * baseW),
        (vp.h * FILL) / (frac.h * baseH),
      ),
      MIN_SCALE,
      MAX_SCALE,
    );
    const x = -(frac.x + frac.w / 2 - 0.5) * baseW * s;
    const y = -(frac.y + frac.h / 2 - 0.5) * baseH * s;
    const c = clampT(x, y, s);
    return {s, x: c.x, y: c.y};
  };

  // The first onLayout can land mid slide-in with a bad frame — re-measure once
  // it settles.
  useEffect(() => {
    const t = setTimeout(measure, 250);
    return () => clearTimeout(t);
  }, []);

  // Zoom to the product once the viewport is measured.
  useEffect(() => {
    if (!vp) {
      return;
    }
    const t = productView();
    apply(t.s, t.x, t.y, false);
    setZoomedOut(t.s <= MIN_SCALE + 0.01);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vp?.w, vp?.h]);

  const toggle = () => {
    const t = zoomedOut ? productView() : {s: 1, x: 0, y: boundFor(1).y}; // whole page, scrolled to the top
    apply(t.s, t.x, t.y, true);
    setZoomedOut(!zoomedOut);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (e, g) =>
        e.nativeEvent.touches.length >= 2 ||
        Math.abs(g.dx) > 4 ||
        Math.abs(g.dy) > 4,
      onPanResponderTerminationRequest: () => false,

      onPanResponderGrant: (e: GestureResponderEvent) => {
        // re-read the viewport's window position — a mid-slide onLayout can
        // leave it stale, which throws off the pinch focal point
        viewRef.current?.measureInWindow((x, y) => {
          origin.current = {x, y};
        });
        const touches = e.nativeEvent.touches;
        const now = Date.now();
        if (touches.length === 1 && now - lastTap.current < DOUBLE_TAP_MS) {
          lastTap.current = 0;
          toggle();
          return;
        }
        lastTap.current = now;
        snap.current = {
          s: cur.current.s,
          x: cur.current.x,
          y: cur.current.y,
          dist: 0,
          px: 0,
          py: 0,
          pinch: false,
        };
      },

      onPanResponderMove: (e: GestureResponderEvent, g) => {
        const touches = e.nativeEvent.touches as Touch[];

        if (touches.length >= 2) {
          const d = spread(touches);
          const m = midpoint(touches);
          if (!snap.current.pinch) {
            // start of a pinch
            snap.current = {
              s: cur.current.s,
              x: cur.current.x,
              y: cur.current.y,
              dist: d,
              px: m.x - origin.current.x,
              py: m.y - origin.current.y,
              pinch: true,
            };
            return;
          }
          const s = clamp(
            (snap.current.s * d) / snap.current.dist,
            MIN_SCALE,
            MAX_SCALE,
          );
          // keep the point that was under the starting focal anchored to it
          const vpW = vp?.w ?? winW;
          const vpH = vp?.h ?? 0;
          const f0x = snap.current.px - vpW / 2;
          const f0y = snap.current.py - vpH / 2;
          const cx = (f0x - snap.current.x) / snap.current.s;
          const cy = (f0y - snap.current.y) / snap.current.s;
          const fx = m.x - origin.current.x - vpW / 2;
          const fy = m.y - origin.current.y - vpH / 2;
          const x = fx - cx * s;
          const y = fy - cy * s;
          scale.setValue(s);
          tx.setValue(x);
          ty.setValue(y);
          cur.current = {s, x, y};
          return;
        }

        // single-finger pan
        const x = snap.current.x + g.dx;
        const y = snap.current.y + g.dy;
        tx.setValue(x);
        ty.setValue(y);
        cur.current = {s: cur.current.s, x, y};
      },

      onPanResponderRelease: () => {
        const s = clamp(cur.current.s, MIN_SCALE, MAX_SCALE);
        const c = clampT(cur.current.x, cur.current.y, s);
        apply(s, c.x, c.y, true);
        setZoomedOut(s <= MIN_SCALE + 0.01);
        snap.current.pinch = false;
      },
    }),
  ).current;

  const measure = () => {
    viewRef.current?.measureInWindow((x, y, w, h) => {
      if (w <= 0 || h <= 0) {
        return;
      }
      origin.current = {x, y};
      setVp(prev => (prev && prev.w === w && prev.h === h ? prev : {w, h}));
    });
  };

  return (
    <View
      ref={viewRef}
      style={styles.stage}
      onLayout={measure}
      {...pan.panHandlers}>
      <Animated.View
        style={{
          width: baseW,
          height: baseH,
          transform: [{translateX: tx}, {translateY: ty}, {scale}],
        }}>
        <Image
          source={{uri: page.image}}
          style={{width: baseW, height: baseH}}
          resizeMode="cover"
        />
        {frac ? (
          <View
            style={[
              styles.outline,
              {
                left: frac.x * baseW,
                top: frac.y * baseH,
                width: frac.w * baseW,
                height: frac.h * baseH,
              },
            ]}
          />
        ) : null}
      </Animated.View>

      {frac ? (
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          style={({pressed}) => [
            styles.toggle,
            pressed && styles.togglePressed,
          ]}>
          <Text style={styles.toggleText}>
            {zoomedOut ? 'Find product' : 'Whole page'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      height: '92%',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingBottom: spacing.md,
    },
    headerText: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: spacing.sm,
    },
    name: {
      color: c.text,
      fontFamily: fonts.display,
      fontSize: 16,
      fontWeight: '700',
      flexShrink: 1,
    },
    price: {
      color: c.primary,
      fontFamily: fonts.display,
      fontSize: 15,
      fontWeight: '700',
    },
    close: {
      width: 24,
      height: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeBar: {
      position: 'absolute',
      width: 18,
      height: 2,
      borderRadius: 1,
      backgroundColor: c.textMuted,
    },
    closeBarA: {transform: [{rotate: '45deg'}]},
    closeBarB: {transform: [{rotate: '-45deg'}]},
    stage: {
      flex: 1,
      marginHorizontal: -spacing.md,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.imageBackdrop,
    },
    outline: {
      position: 'absolute',
      borderWidth: 2,
      borderColor: c.primary,
      borderRadius: 4,
      backgroundColor: c.primaryTint,
    },
    toggle: {
      position: 'absolute',
      bottom: spacing.lg,
      alignSelf: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.pill,
      backgroundColor: c.navBackground,
    },
    togglePressed: {opacity: 0.8},
    toggleText: {
      color: '#ffffff',
      fontFamily: fonts.semibold,
      fontSize: 13,
      fontWeight: '600',
    },
  });

export default SourcePageModal;
