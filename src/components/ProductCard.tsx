import React from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';

import {Product, flyerStatus, formatShortDate} from '../api/extract';
import {Palette, fonts, radius, spacing, useThemedStyles} from '../theme';
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
  const {styles} = useThemedStyles(makeStyles);
  return (
    <View style={[styles.cal, {borderColor: color}]}>
      <View style={[styles.calHead, {backgroundColor: color}]} />
    </View>
  );
}

function ProductCard({product, width, onPress}: Props): React.JSX.Element {
  const {styles, colors} = useThemedStyles(makeStyles);

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
        {product.onSale ? (
          <View style={styles.salePill} accessibilityLabel="On sale">
            <Text style={styles.saleText}>SALE</Text>
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
          <View style={styles.priceWrap}>
            <Text style={[styles.price, product.onSale && styles.priceDeal]}>
              {product.price || '—'}
            </Text>
            {product.wasPrice ? (
              <Text style={styles.wasPrice}>{product.wasPrice}</Text>
            ) : null}
          </View>
          <Text style={styles.page}>p.{product.page}</Text>
        </View>

        {product.promoText ? (
          <Text style={styles.promo} numberOfLines={1}>
            {product.promoText}
          </Text>
        ) : null}

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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 3},
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 2,
    },
    pressed: {opacity: 0.75},
    thumb: {
      height: THUMB_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.imageBackdrop,
    },
    thumbImage: {width: '100%', height: '100%'},
    noImage: {color: c.textMuted, fontSize: 12},
    statusPill: {position: 'absolute', top: 6, left: 6},
    salePill: {
      position: 'absolute',
      bottom: 6,
      left: 6,
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: 999,
      backgroundColor: c.deal,
    },
    saleText: {
      color: '#fff',
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    badge: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: c.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: {color: '#fff', fontSize: 12, fontWeight: '800', lineHeight: 14},
    body: {padding: spacing.sm, gap: 4},
    name: {
      color: c.text,
      fontFamily: fonts.semibold,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 17,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 6,
    },
    priceWrap: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 5,
      flexShrink: 1,
    },
    price: {
      color: c.text,
      fontFamily: fonts.display,
      fontSize: 16,
      fontWeight: '800',
    },
    priceDeal: {color: c.deal},
    wasPrice: {
      color: c.textMuted,
      fontSize: 11,
      textDecorationLine: 'line-through',
    },
    promo: {
      color: c.deal,
      fontFamily: fonts.bold,
      fontSize: 11,
      fontWeight: '700',
    },
    page: {color: c.textMuted, fontSize: 11},
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
      alignSelf: 'flex-end',
      marginTop: 2,
      color: c.textMuted,
      fontSize: 10,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      textAlign: 'right',
    },
  });

export default ProductCard;
