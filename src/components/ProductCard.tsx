import React from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';

import {Product, formatShortDate, isFlyerValid} from '../api/extract';
import {colors, radius, spacing} from '../theme';

const THUMB_HEIGHT = 116;

/** Below this the model isn't sure it read the tile right — flag for review. */
const LOW_CONFIDENCE = 55;

type Props = {
  product: Product;
  width: number;
  onPress: (product: Product) => void;
};

/** A tiny calendar mark drawn with Views (no icon lib). */
function CalendarMark({color}: {color: string}): React.JSX.Element {
  return (
    <View style={[styles.cal, {borderColor: color}]}>
      <View style={[styles.calHead, {backgroundColor: color}]} />
    </View>
  );
}

function ProductCard({product, width, onPress}: Props): React.JSX.Element {
  const lowConfidence =
    product.confidence != null && product.confidence < LOW_CONFIDENCE;

  const valid = isFlyerValid(product.validFrom, product.validTo);
  const endShort = formatShortDate(product.validTo);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name || 'Unnamed item'}, ${
        product.price || 'no price'
      }`}
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
        {valid ? (
          <View style={styles.validPill}>
            <View style={styles.validDot} />
            <Text style={styles.validText}>Valid</Text>
          </View>
        ) : null}
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
          <Text style={styles.price}>{product.price || '—'}</Text>
          <Text style={styles.page}>p.{product.page}</Text>
        </View>

        {endShort ? (
          <View style={styles.dateRow}>
            <CalendarMark color={valid ? colors.textMuted : colors.danger} />
            <Text style={[styles.dateText, !valid && styles.dateEnded]}>
              {valid ? `Ends ${endShort}` : `Ended ${endShort}`}
            </Text>
          </View>
        ) : null}

        {product.store ? (
          <Text style={styles.store}>{product.store}</Text>
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
  validPill: {
    position: 'absolute',
    top: 6,
    left: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingLeft: 6,
    paddingRight: 8,
    borderRadius: 999,
    backgroundColor: colors.success,
  },
  validDot: {width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff'},
  validText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
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
    gap: 6,
  },
  price: {color: colors.primary, fontSize: 15, fontWeight: '700'},
  page: {color: colors.textMuted, fontSize: 11},
  dateRow: {flexDirection: 'row', alignItems: 'center', gap: 5},
  dateText: {color: colors.textMuted, fontSize: 11, lineHeight: 15},
  dateEnded: {color: colors.danger},
  cal: {
    width: 11,
    height: 11,
    borderWidth: 1.2,
    borderRadius: 2,
    marginTop: 1,
  },
  calHead: {
    position: 'absolute',
    top: -0.5,
    left: -0.5,
    right: -0.5,
    height: 3,
  },
  store: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});

export default ProductCard;
