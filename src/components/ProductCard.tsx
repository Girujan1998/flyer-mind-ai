import React from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';

import {Product} from '../api/extract';
import {colors, radius, spacing} from '../theme';

const THUMB_HEIGHT = 116;

/** Below this the model isn't sure it read the tile right — flag for review. */
const LOW_CONFIDENCE = 55;

type Props = {
  product: Product;
  width: number;
  onPress: (product: Product) => void;
};

function ProductCard({product, width, onPress}: Props): React.JSX.Element {
  const lowConfidence =
    product.confidence != null && product.confidence < LOW_CONFIDENCE;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(product)}
      style={({pressed}) => [styles.card, {width}, pressed && styles.pressed]}>
      <View style={styles.thumb}>
        {product.thumb ? (
          <Image
            source={{uri: product.thumb}}
            style={styles.thumbImage}
            resizeMode="cover"
          />
        ) : (
          <Text style={styles.noImage}>no image</Text>
        )}
        {lowConfidence ? (
          <View
            style={styles.badge}
            accessibilityLabel={`Low confidence (${product.confidence}) — check this one`}>
            <Text style={styles.badgeText}>?</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name || 'Unnamed item'}
        </Text>
        <View style={styles.metaRow}>
          {product.price ? (
            <Text style={styles.price}>{product.price}</Text>
          ) : null}
          <Text style={styles.page}>p.{product.page}</Text>
        </View>
        {product.info ? (
          <Text style={styles.info} numberOfLines={2}>
            {product.info}
          </Text>
        ) : null}
        {product.store ? (
          <Text style={styles.store} numberOfLines={1}>
            {product.store}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pressed: {opacity: 0.7},
  thumb: {
    height: THUMB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  thumbImage: {width: '100%', height: '100%'},
  noImage: {color: colors.textMuted, fontSize: 12},
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {color: '#fff', fontSize: 12, fontWeight: '800', lineHeight: 14},
  body: {padding: spacing.sm, gap: 4},
  name: {color: colors.text, fontSize: 13, fontWeight: '600', lineHeight: 17},
  metaRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  price: {color: colors.primary, fontSize: 15, fontWeight: '700'},
  page: {color: colors.textMuted, fontSize: 11},
  info: {color: colors.textMuted, fontSize: 11, lineHeight: 15},
  store: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});

export default ProductCard;
