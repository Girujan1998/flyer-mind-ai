import React from 'react';
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

import {boxToRect, FlyerPage, Product} from '../api/extract';
import {colors, radius, spacing} from '../theme';

type Props = {
  product: Product | null;
  page: FlyerPage | undefined;
  onClose: () => void;
};

/** Full flyer page with the product's detected region outlined. */
function SourcePageModal({product, page, onClose}: Props): React.JSX.Element {
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

function PageWithBox({
  product,
  page,
}: {
  product: Product;
  page: FlyerPage;
}): React.JSX.Element {
  const displayWidth = Dimensions.get('window').width - spacing.md * 2;
  const displayHeight = displayWidth * (page.height / page.width);
  const rect = boxToRect(product.box, page.width, page.height);

  return (
    <ScrollView
      style={styles.stage}
      contentContainerStyle={styles.stageContent}
      maximumZoomScale={3}
      minimumZoomScale={1}>
      <View style={{width: displayWidth, height: displayHeight}}>
        <Image
          source={{uri: page.image}}
          style={{width: displayWidth, height: displayHeight}}
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
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
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
  headerText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  name: {color: colors.text, fontSize: 16, fontWeight: '700', flexShrink: 1},
  price: {color: colors.primary, fontSize: 15, fontWeight: '700'},
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
    backgroundColor: colors.textMuted,
  },
  closeBarA: {transform: [{rotate: '45deg'}]},
  closeBarB: {transform: [{rotate: '-45deg'}]},
  stage: {alignSelf: 'stretch'},
  stageContent: {paddingBottom: spacing.xl},
  outline: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 4,
    backgroundColor: colors.primaryTint,
  },
});

export default SourcePageModal;
