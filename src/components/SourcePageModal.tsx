import { Feather } from '@expo/vector-icons';
import {
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { boxToRect, type FlyerPage, type Product } from '@/api/extract';
import { toImageSource } from '@/components/CroppedFlyerImage';
import { colors, radius, spacing } from '@/theme';

type Props = {
  product: Product | null;
  page: FlyerPage | undefined;
  onClose: () => void;
};

/** Full flyer page with the product's detected region outlined. */
export function SourcePageModal({ product, page, onClose }: Props) {
  const visible = product != null && page != null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.name} numberOfLines={1}>
                {product?.name || 'Unnamed item'}
              </Text>
              {product?.price ? <Text style={styles.price}>{product.price}</Text> : null}
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
              <Feather name="x" size={22} color={colors.text} />
            </Pressable>
          </View>

          {visible ? <PageWithBox product={product} page={page} /> : null}
        </View>
      </View>
    </Modal>
  );
}

function PageWithBox({ product, page }: { product: Product; page: FlyerPage }) {
  const displayWidth = Dimensions.get('window').width - spacing.md * 2;
  const displayHeight = displayWidth * (page.height / page.width);
  const rect = boxToRect(product.box, page.width, page.height);

  return (
    <ScrollView
      style={styles.stage}
      contentContainerStyle={{ paddingBottom: spacing.xl }}
      maximumZoomScale={3}
    >
      <View style={{ width: displayWidth, height: displayHeight }}>
        <Image
          source={toImageSource(page.image)}
          style={{ width: displayWidth, height: displayHeight }}
          resizeMode="contain"
        />
        {rect ? (
          <View
            style={[
              styles.outline,
              {
                left: (rect.x / page.width) * displayWidth,
                top: (rect.y / page.height) * displayHeight,
                width: (rect.width / page.width) * displayWidth,
                height: (rect.height / page.height) * displayHeight,
              },
            ]}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  headerText: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  name: { color: colors.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  price: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  stage: { alignSelf: 'stretch' },
  outline: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 4,
    backgroundColor: 'rgba(91, 140, 255, 0.16)',
  },
});
