import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  DealQuality,
  FlyerPage,
  PriceHistoryEntry,
  Product,
  boxToRect,
  fetchPriceHistory,
  fetchPriceInsight,
  flyerStatus,
  formatValidity,
} from '../api/extract';
import {Palette, fonts, radius, spacing, useThemedStyles} from '../theme';
import FlyerStatusPill from './FlyerStatusPill';

const DEAL_LABEL: Record<DealQuality, string> = {
  great: 'Great price',
  good: 'Good price',
  average: 'Typical price',
  poor: 'Above typical',
};

/**
 * Up to the 4 most recent flyer prices for this product (excluding today's,
 * which the caller already shows), newest first, deduped so a re-listed price
 * doesn't repeat back-to-back.
 */
function priorPrices(history: PriceHistoryEntry[]): PriceHistoryEntry[] {
  const withPrice = history.filter(h => h.priceValue != null);
  const rest = withPrice.slice(0, -1).reverse();
  const out: PriceHistoryEntry[] = [];
  for (const h of rest) {
    if (out[out.length - 1]?.priceValue !== h.priceValue) {
      out.push(h);
    }
    if (out.length >= 4) {
      break;
    }
  }
  return out;
}

/** "Today: $4.99 · Previous: $5.49, $4.49, $5.99" — from real flyer history. */
function PriceHistoryStrip({
  canonicalProductId,
  currentPrice,
  styles,
}: {
  canonicalProductId: string;
  currentPrice: string;
  styles: ReturnType<typeof makeStyles>;
}): React.JSX.Element | null {
  const [history, setHistory] = useState<PriceHistoryEntry[] | null>(null);

  useEffect(() => {
    let live = true;
    setHistory(null);
    fetchPriceHistory(canonicalProductId, {months: 6})
      .then(res => {
        if (live) {
          setHistory(res.history);
        }
      })
      .catch(() => {
        if (live) {
          setHistory([]);
        }
      });
    return () => {
      live = false;
    };
  }, [canonicalProductId]);

  if (history === null) {
    return (
      <View style={styles.priceHistoryRow}>
        <ActivityIndicator size="small" />
      </View>
    );
  }

  const prior = priorPrices(history);
  if (!prior.length) {
    return null;
  }

  return (
    <View style={styles.priceHistoryRow}>
      <Text style={styles.priceHistoryText}>
        <Text style={styles.priceHistoryLabel}>Today: </Text>
        {currentPrice || '—'}
        <Text style={styles.priceHistoryLabel}>{'  ·  Previous: '}</Text>
        {prior.map(h => h.price || `$${h.priceValue?.toFixed(2)}`).join(', ')}
      </Text>
    </View>
  );
}

/** A small "Great price" / "Good price" / … pill, from real trailing-window data. */
function DealQualityBadge({
  canonicalProductId,
  styles,
}: {
  canonicalProductId: string;
  styles: ReturnType<typeof makeStyles>;
}): React.JSX.Element | null {
  const [quality, setQuality] = useState<DealQuality | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let live = true;
    setQuality(undefined);
    fetchPriceInsight(canonicalProductId)
      .then(insight => {
        if (live) {
          setQuality(insight.dealQuality);
        }
      })
      .catch(() => {
        if (live) {
          setQuality(null);
        }
      });
    return () => {
      live = false;
    };
  }, [canonicalProductId]);

  if (!quality) {
    return null;
  }
  const toneStyle = {
    great: styles.dealBadgeGreat,
    good: styles.dealBadgeGood,
    average: styles.dealBadgeAverage,
    poor: styles.dealBadgePoor,
  }[quality];
  return (
    <View style={[styles.dealBadge, toneStyle]}>
      <Text style={styles.dealBadgeText}>{DEAL_LABEL[quality]}</Text>
    </View>
  );
}

const HERO_HEIGHT = 200;

type Props = {
  product: Product | null;
  /** The product's flyer page — lets the hero crop from the full-res render. */
  page?: FlyerPage;
  onClose: () => void;
  /** Open the full flyer page with this product outlined. */
  onViewInFlyer: (product: Product) => void;
};

/**
 * A sharp hero: pan + scale the full-res page image so the product's box fills
 * the frame. Falls back to the small thumbnail when there's no page/box.
 */
function Hero({
  product,
  page,
  styles,
}: {
  product: Product;
  page?: FlyerPage;
  styles: ReturnType<typeof makeStyles>;
}): React.JSX.Element {
  const heroW = Dimensions.get('window').width;
  const rect =
    page && page.width > 0
      ? boxToRect(product.box, page.width, page.height, 6)
      : null;

  if (page && rect) {
    // scale so the box takes ~88% of the frame, then centre it
    const k = Math.min(
      (heroW * 0.88) / rect.width,
      (HERO_HEIGHT * 0.88) / rect.height,
    );
    const imgW = page.width * k;
    const imgH = page.height * k;
    const left = heroW / 2 - (rect.x + rect.width / 2) * k;
    const top = HERO_HEIGHT / 2 - (rect.y + rect.height / 2) * k;
    return (
      <Image
        source={{uri: page.image}}
        style={[styles.heroCrop, {width: imgW, height: imgH, left, top}]}
        resizeMode="stretch"
      />
    );
  }

  if (product.thumb) {
    return (
      <Image
        source={{uri: product.thumb}}
        style={styles.heroImage}
        resizeMode="contain"
      />
    );
  }
  return <Text style={styles.noImage}>no image</Text>;
}

/** Everything known about one product, opened by tapping its search card. */
function ProductInfoModal({
  product,
  page,
  onClose,
  onViewInFlyer,
}: Props): React.JSX.Element {
  const {styles} = useThemedStyles(makeStyles);

  const status = product
    ? flyerStatus(product.validFrom, product.validTo)
    : 'unknown';
  const validity = product
    ? formatValidity(product.validFrom, product.validTo)
    : '';

  return (
    <Modal
      visible={product != null}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <View style={styles.sheet}>
          {product ? (
            <>
              <View style={styles.hero}>
                <Hero product={product} page={page} styles={styles} />
                <View style={styles.statusPill}>
                  <FlyerStatusPill status={status} />
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

              <ScrollView
                style={styles.body}
                contentContainerStyle={styles.bodyContent}>
                <Text style={styles.name}>
                  {product.name || 'Unnamed item'}
                </Text>
                {product.category ? (
                  <Text style={styles.category}>{product.category}</Text>
                ) : null}
                <View style={styles.priceRow}>
                  {product.price ? (
                    <Text
                      style={[
                        styles.price,
                        product.onSale && styles.priceDeal,
                      ]}>
                      {product.price}
                    </Text>
                  ) : null}
                  {product.wasPrice ? (
                    <Text style={styles.wasPrice}>{product.wasPrice}</Text>
                  ) : null}
                  {product.onSale ? (
                    <View style={styles.salePill}>
                      <Text style={styles.saleText}>SALE</Text>
                    </View>
                  ) : null}
                  {product.canonicalProductId ? (
                    <DealQualityBadge
                      canonicalProductId={product.canonicalProductId}
                      styles={styles}
                    />
                  ) : null}
                </View>
                {product.promoText ? (
                  <Text style={styles.promo}>{product.promoText}</Text>
                ) : null}
                {product.info ? (
                  <Text style={styles.details}>{product.info}</Text>
                ) : null}
                {product.canonicalProductId ? (
                  <PriceHistoryStrip
                    canonicalProductId={product.canonicalProductId}
                    currentPrice={product.price}
                    styles={styles}
                  />
                ) : null}

                <View style={styles.meta}>
                  <View style={styles.metaCell}>
                    <Text style={styles.metaKey}>Page</Text>
                    <Text style={styles.metaValue}>Page {product.page}</Text>
                  </View>
                  {product.store ? (
                    <View style={styles.metaCell}>
                      <Text style={styles.metaKey}>Store</Text>
                      <Text style={styles.metaValue}>{product.store}</Text>
                    </View>
                  ) : null}
                  {product.department ? (
                    <View style={styles.metaCell}>
                      <Text style={styles.metaKey}>Aisle</Text>
                      <Text style={[styles.metaValue, styles.metaCapitalize]}>
                        {product.department}
                      </Text>
                    </View>
                  ) : null}
                  {validity ? (
                    <View style={styles.metaCellFull}>
                      <Text style={styles.metaKey}>Flyer valid</Text>
                      <Text style={styles.metaValue}>{validity}</Text>
                    </View>
                  ) : null}
                </View>

                <Pressable
                  onPress={() => onViewInFlyer(product)}
                  accessibilityRole="button"
                  style={({pressed}) => [
                    styles.cta,
                    pressed && styles.ctaPressed,
                  ]}>
                  <Text style={styles.ctaText}>View in Flyer</Text>
                </Pressable>
              </ScrollView>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    dealBadge: {
      paddingVertical: 3,
      paddingHorizontal: 9,
      borderRadius: 999,
    },
    dealBadgeGreat: {backgroundColor: c.statusLive},
    dealBadgeGood: {backgroundColor: c.primaryTint},
    dealBadgeAverage: {backgroundColor: c.surfaceAlt},
    dealBadgePoor: {backgroundColor: c.dealTint},
    dealBadgeText: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.3,
      color: c.text,
    },
    priceHistoryRow: {marginTop: spacing.xs, minHeight: 16},
    priceHistoryText: {color: c.textMuted, fontSize: 12, lineHeight: 17},
    priceHistoryLabel: {fontWeight: '700', color: c.text},
    backdrop: {
      flex: 1,
      backgroundColor: c.scrim,
      justifyContent: 'flex-end',
    },
    backdropFill: {flex: 1},
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      overflow: 'hidden',
      maxHeight: '92%',
    },
    hero: {
      height: HERO_HEIGHT,
      overflow: 'hidden',
      backgroundColor: c.imageBackdrop,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroImage: {width: '100%', height: '100%'},
    heroCrop: {position: 'absolute'},
    noImage: {color: c.textMuted, fontSize: 13},
    statusPill: {position: 'absolute', top: spacing.sm, left: spacing.sm},
    close: {
      position: 'absolute',
      top: spacing.sm,
      right: spacing.sm,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: 'rgba(255,255,255,0.9)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeBar: {
      position: 'absolute',
      width: 14,
      height: 2,
      borderRadius: 1,
      backgroundColor: '#262420',
    },
    closeBarA: {transform: [{rotate: '45deg'}]},
    closeBarB: {transform: [{rotate: '-45deg'}]},
    body: {alignSelf: 'stretch'},
    bodyContent: {
      padding: spacing.md,
      paddingBottom: spacing.xl,
      gap: spacing.xs,
    },
    name: {
      color: c.text,
      fontFamily: fonts.display,
      fontSize: 18,
      fontWeight: '700',
      lineHeight: 24,
    },
    category: {
      color: c.textMuted,
      fontSize: 12,
      fontWeight: '600',
      textTransform: 'capitalize',
      letterSpacing: 0.3,
    },
    priceRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
    price: {
      color: c.primary,
      fontFamily: fonts.display,
      fontSize: 22,
      fontWeight: '800',
    },
    priceDeal: {color: c.deal},
    wasPrice: {
      color: c.textMuted,
      fontSize: 15,
      textDecorationLine: 'line-through',
    },
    salePill: {
      paddingVertical: 3,
      paddingHorizontal: 9,
      borderRadius: 999,
      backgroundColor: c.deal,
    },
    saleText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    promo: {
      color: c.deal,
      fontFamily: fonts.bold,
      fontSize: 13,
      fontWeight: '700',
    },
    details: {
      color: c.textMuted,
      fontSize: 13,
      lineHeight: 19,
      marginTop: spacing.xs,
    },
    meta: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: spacing.md,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: c.border,
      rowGap: spacing.md,
    },
    metaCell: {width: '50%', gap: 3},
    metaCellFull: {width: '100%', gap: 3},
    metaKey: {
      color: c.textMuted,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    metaValue: {
      color: c.text,
      fontFamily: fonts.semibold,
      fontSize: 14,
      fontWeight: '600',
    },
    metaCapitalize: {textTransform: 'capitalize'},
    cta: {
      marginTop: spacing.lg,
      minHeight: 48,
      borderRadius: radius.md,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaPressed: {opacity: 0.85},
    ctaText: {
      color: c.onPrimary,
      fontFamily: fonts.bold,
      fontSize: 15,
      fontWeight: '700',
    },
  });

export default ProductInfoModal;
