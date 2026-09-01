import React from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {Product, formatValidity, isFlyerValid} from '../api/extract';
import {colors, radius, spacing} from '../theme';

type Props = {
  product: Product | null;
  onClose: () => void;
  /** Open the full flyer page with this product outlined. */
  onViewInFlyer: (product: Product) => void;
};

/** Everything known about one product, opened by tapping its search card. */
function ProductInfoModal({
  product,
  onClose,
  onViewInFlyer,
}: Props): React.JSX.Element {
  const valid =
    product != null && isFlyerValid(product.validFrom, product.validTo);
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
                {product.thumb ? (
                  <Image
                    source={{uri: product.thumb}}
                    style={styles.heroImage}
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
                {product.price ? (
                  <Text style={styles.price}>{product.price}</Text>
                ) : null}
                {product.info ? (
                  <Text style={styles.details}>{product.info}</Text>
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

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  backdropFill: {flex: 1},
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
    maxHeight: '92%',
  },
  hero: {
    height: 200,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroImage: {width: '100%', height: '100%'},
  noImage: {color: colors.textMuted, fontSize: 13},
  validPill: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingLeft: 7,
    paddingRight: 10,
    borderRadius: 999,
    backgroundColor: colors.success,
  },
  validDot: {width: 5, height: 5, borderRadius: 3, backgroundColor: '#fff'},
  validText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
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
    backgroundColor: colors.text,
  },
  closeBarA: {transform: [{rotate: '45deg'}]},
  closeBarB: {transform: [{rotate: '-45deg'}]},
  body: {alignSelf: 'stretch'},
  bodyContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
  },
  name: {color: colors.text, fontSize: 18, fontWeight: '700', lineHeight: 24},
  price: {color: colors.primary, fontSize: 22, fontWeight: '800'},
  details: {
    color: colors.textMuted,
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
    borderTopColor: colors.border,
    rowGap: spacing.md,
  },
  metaCell: {width: '50%', gap: 3},
  metaCellFull: {width: '100%', gap: 3},
  metaKey: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  metaValue: {color: colors.text, fontSize: 14, fontWeight: '600'},
  cta: {
    marginTop: spacing.lg,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: {opacity: 0.8},
  ctaText: {color: '#fff', fontSize: 15, fontWeight: '700'},
});

export default ProductInfoModal;
