import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { FlyerPage, Product } from '@/api/extract';
import { CroppedFlyerImage } from '@/components/CroppedFlyerImage';
import { colors, radius, spacing } from '@/theme';

const THUMB_HEIGHT = 116;

type Props = {
  product: Product;
  page: FlyerPage | undefined;
  width: number;
  onPress: (product: Product) => void;
};

export function ProductCard({ product, page, width, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(product)}
      style={({ pressed }) => [styles.card, { width }, pressed && styles.pressed]}
    >
      <View style={styles.thumb}>
        {page ? (
          <CroppedFlyerImage
            page={page}
            box={product.box}
            width={width - 2}
            height={THUMB_HEIGHT}
          />
        ) : (
          <Text style={styles.noImage}>no image</Text>
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name || 'Unnamed item'}
        </Text>
        <View style={styles.metaRow}>
          {product.price ? <Text style={styles.price}>{product.price}</Text> : null}
          <Text style={styles.page}>p.{product.page}</Text>
        </View>
        {product.info ? (
          <Text style={styles.info} numberOfLines={2}>
            {product.info}
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
  pressed: { opacity: 0.7 },
  thumb: {
    height: THUMB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  noImage: { color: colors.textMuted, fontSize: 12 },
  body: { padding: spacing.sm, gap: 4 },
  name: { color: colors.text, fontSize: 13, fontWeight: '600', lineHeight: 17 },
  metaRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  price: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  page: { color: colors.textMuted, fontSize: 11 },
  info: { color: colors.textMuted, fontSize: 11, lineHeight: 15 },
});
