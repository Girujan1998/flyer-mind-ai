import React from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';

import {Product, flyerStatus, formatShortDate} from '../api/extract';
import {colors, radius, spacing} from '../theme';
import FlyerStatusPill from './FlyerStatusPill';

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

  const status = flyerStatus(product.validFrom, product.validTo);
  const startShort = formatShortDate(product.validFrom);
  const endShort = formatShortDate(product.validTo);

  let dateLabel = '';
  if (status === 'upcoming' && startShort) {
    dateLabel = `Starts ${startShort}`;
  } else if (status === 'expired' && endShort) {
    dateLabel = `Ended ${endShort}`;
  } else if (status === 'valid' && endShort) {
    dateLabel = `Ends ${endShort}`;
  }
  const dateColor = status === 'expired' ? colors.danger : colors.textMuted;

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
        <View style={styles.statusPill}>
          <FlyerStatusPill status={status} compact />
        </View>
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

        {dateLabel ? (
          <View style={styles.dateRow}>
            <CalendarMark color={dateColor} />
            <Text style={[styles.dateText, {color: dateColor}]}>
              {dateLabel}
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
  statusPill: {position: 'absolute', top: 6, left: 6},
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
  dateText: {fontSize: 11, lineHeight: 15},
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
