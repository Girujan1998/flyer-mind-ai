import React, {useCallback, useState} from 'react';
import {
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  View,
  StyleSheet,
} from 'react-native';

import {Product} from '../api/extract';
import {Palette, spacing, useThemedStyles} from '../theme';
import ProductCard from './ProductCard';

// Matches the chat transcript's own side padding (`list: {padding: spacing.md}`
// in ChatScreen) so one card fills exactly the width a grid row would.
const ITEM_WIDTH = Dimensions.get('window').width - spacing.md * 2;

type Props = {
  products: Product[];
  onPress: (product: Product) => void;
};

/** Full-size cards, one product per page, swiped left/right to navigate. */
function ProductCarousel({products, onPress}: Props): React.JSX.Element {
  const {styles} = useThemedStyles(makeStyles);
  const [index, setIndex] = useState(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / ITEM_WIDTH);
    setIndex(prev => (next === prev ? prev : next));
  }, []);

  return (
    <View style={styles.wrap}>
      <FlatList
        data={products}
        keyExtractor={p => p.id}
        renderItem={({item}) => (
          <View style={styles.page}>
            <ProductCard product={item} width={ITEM_WIDTH} onPress={onPress} />
          </View>
        )}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        onScroll={onScroll}
        scrollEventThrottle={32}
        getItemLayout={(_, i) => ({
          length: ITEM_WIDTH,
          offset: ITEM_WIDTH * i,
          index: i,
        })}
      />
      {products.length > 1 ? (
        <View style={styles.dots}>
          {products.map((p, i) => (
            <View
              key={p.id}
              style={[styles.dot, i === index && styles.dotOn]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {alignSelf: 'stretch', gap: spacing.sm},
    page: {width: ITEM_WIDTH},
    dots: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 6,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: c.border,
    },
    dotOn: {
      width: 16,
      borderRadius: 3,
      backgroundColor: c.primary,
    },
  });

export default ProductCarousel;
