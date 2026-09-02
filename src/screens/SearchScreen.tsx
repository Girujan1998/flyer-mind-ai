import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  EMPTY_FILTERS,
  FilterFacets,
  FlyerPage,
  NoServerError,
  Product,
  ProductFilters,
  countActiveFilters,
  fetchFilterFacets,
  pageKey,
  searchProducts,
} from '../api/extract';
import FilterModal from '../components/FilterModal';
import ProductCard from '../components/ProductCard';
import ProductInfoModal from '../components/ProductInfoModal';
import SourcePageModal from '../components/SourcePageModal';
import ScreenHeader from '../components/ScreenHeader';
import {Palette, radius, spacing, useThemedStyles} from '../theme';

const PAGE_SIZE = 20;
const GAP = spacing.sm;
const COLUMN_WIDTH =
  (Dimensions.get('window').width - spacing.md * 2 - GAP) / 2;
const FILTER_BTN = 40;

const NO_FACETS: FilterFacets = {
  departments: [],
  stores: [],
  statuses: [],
  saleCount: 0,
  total: 0,
};

function SearchScreen(): React.JSX.Element {
  const {styles, colors} = useThemedStyles(makeStyles);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  const [filters, setFilters] = useState<ProductFilters>(EMPTY_FILTERS);
  const [facets, setFacets] = useState<FilterFacets>(NO_FACETS);
  const [filterOpen, setFilterOpen] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [pages, setPages] = useState<Map<string, FlyerPage>>(new Map());
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tapping a card opens the info modal; "View in Flyer" from there opens the
  // source-page modal.
  const [infoProduct, setInfoProduct] = useState<Product | null>(null);
  const [flyerProduct, setFlyerProduct] = useState<Product | null>(null);

  const activeFilters = countActiveFilters(filters);

  // debounce the search box
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(id);
  }, [query]);

  // filter options — load once
  useEffect(() => {
    fetchFilterFacets()
      .then(setFacets)
      .catch(() => setFacets(NO_FACETS));
  }, []);

  const mergePages = (list: FlyerPage[]) =>
    setPages(prev => {
      const next = new Map(prev);
      for (const p of list) {
        next.set(pageKey(p.flyerId, p.page), p);
      }
      return next;
    });

  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await searchProducts({
        q: debounced,
        filters,
        limit: PAGE_SIZE,
        offset: 0,
      });
      if (id !== reqId.current) {
        return;
      }
      setProducts(res.products);
      setPages(new Map(res.pages.map(p => [pageKey(p.flyerId, p.page), p])));
      setTotal(res.total);
      setHasMore(res.hasMore);
    } catch (err) {
      if (id !== reqId.current) {
        return;
      }
      setError(
        err instanceof NoServerError || err instanceof Error
          ? err.message
          : 'Search failed',
      );
      setProducts([]);
      setHasMore(false);
    } finally {
      if (id === reqId.current) {
        setLoading(false);
      }
    }
  }, [debounced, filters]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = async () => {
    if (loadingMore || loading || !hasMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const res = await searchProducts({
        q: debounced,
        filters,
        limit: PAGE_SIZE,
        offset: products.length,
      });
      setProducts(prev => [...prev, ...res.products]);
      mergePages(res.pages);
      setTotal(res.total);
      setHasMore(res.hasMore);
    } catch {
      // keep what we have; the button stays for a retry
    } finally {
      setLoadingMore(false);
    }
  };

  const renderFooter = () => {
    if (loadingMore) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      );
    }
    if (hasMore) {
      return (
        <Pressable
          onPress={loadMore}
          style={({pressed}) => [styles.moreBtn, pressed && styles.pressed]}>
          <Text style={styles.moreText}>
            Load more ({products.length} of {total})
          </Text>
        </Pressable>
      );
    }
    if (products.length > 0) {
      return <Text style={styles.footerEnd}>{total} products</Text>;
    }
    return null;
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Search"
        trailing={facets.total > 0 ? `${facets.total} items` : undefined}
      />

      <View style={styles.searchWrap}>
        <View style={styles.searchRow}>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Search products"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {query.length > 0 ? (
              <Pressable
                onPress={() => setQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={10}
                style={({pressed}) => [
                  styles.clearBtn,
                  pressed && styles.pressed,
                ]}>
                <View style={[styles.clearBar, styles.clearBarA]} />
                <View style={[styles.clearBar, styles.clearBarB]} />
              </Pressable>
            ) : null}
          </View>
          <Pressable
            onPress={() => setFilterOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={
              activeFilters > 0 ? `Filters, ${activeFilters} active` : 'Filters'
            }
            style={({pressed}) => [
              styles.filterBtn,
              activeFilters > 0 && styles.filterBtnActive,
              pressed && styles.pressed,
            ]}>
            <View style={styles.funnel}>
              <View
                style={[
                  styles.funnelCone,
                  {
                    borderTopColor:
                      activeFilters > 0 ? colors.primary : colors.textMuted,
                  },
                ]}
              />
              <View
                style={[
                  styles.funnelStem,
                  {
                    backgroundColor:
                      activeFilters > 0 ? colors.primary : colors.textMuted,
                  },
                ]}
              />
            </View>
            {activeFilters > 0 ? (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilters}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={load} style={styles.retry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : products.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>
            {debounced
              ? `No products match "${debounced}".`
              : activeFilters > 0
              ? 'No products match these filters.'
              : 'No products yet — upload a flyer.'}
          </Text>
          {activeFilters > 0 ? (
            <Pressable
              onPress={() => setFilters(EMPTY_FILTERS)}
              style={styles.retry}>
              <Text style={styles.retryText}>Clear filters</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={p => p.id}
          numColumns={2}
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.grid}
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          renderItem={({item}) => (
            <ProductCard
              product={item}
              width={COLUMN_WIDTH}
              onPress={setInfoProduct}
            />
          )}
          ListFooterComponent={renderFooter()}
        />
      )}

      <FilterModal
        visible={filterOpen}
        facets={facets}
        query={debounced}
        value={filters}
        onApply={next => {
          setFilters(next);
          setFilterOpen(false);
        }}
        onClose={() => setFilterOpen(false)}
      />

      <ProductInfoModal
        product={infoProduct}
        onClose={() => setInfoProduct(null)}
        onViewInFlyer={product => {
          // Let the info sheet finish dismissing before the next modal presents
          // — stacked Modal transitions glitch on iOS otherwise.
          setInfoProduct(null);
          setTimeout(() => setFlyerProduct(product), 260);
        }}
      />

      <SourcePageModal
        product={flyerProduct}
        page={
          flyerProduct
            ? pages.get(pageKey(flyerProduct.flyerId, flyerProduct.page))
            : undefined
        }
        onClose={() => setFlyerProduct(null)}
      />
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: {flex: 1, backgroundColor: c.background},
    searchWrap: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },
    searchRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
    inputWrap: {flex: 1, justifyContent: 'center'},
    input: {
      height: FILTER_BTN,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      paddingLeft: spacing.md,
      paddingRight: 36,
      fontSize: 15,
      color: c.text,
    },
    clearBtn: {
      position: 'absolute',
      right: 8,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: c.textMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clearBar: {
      position: 'absolute',
      width: 10,
      height: 1.5,
      borderRadius: 1,
      backgroundColor: c.surface,
    },
    clearBarA: {transform: [{rotate: '45deg'}]},
    clearBarB: {transform: [{rotate: '-45deg'}]},
    filterBtn: {
      width: FILTER_BTN,
      height: FILTER_BTN,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterBtnActive: {
      borderColor: c.primary,
      backgroundColor: c.primaryTint,
    },
    funnel: {alignItems: 'center'},
    funnelCone: {
      width: 0,
      height: 0,
      borderLeftWidth: 7,
      borderRightWidth: 7,
      borderTopWidth: 8,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
    },
    funnelStem: {width: 2, height: 5},
    filterBadge: {
      position: 'absolute',
      top: -5,
      right: -5,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      paddingHorizontal: 3,
      backgroundColor: c.deal,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterBadgeText: {color: '#fff', fontSize: 10, fontWeight: '800'},
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    empty: {color: c.textMuted, fontSize: 14, textAlign: 'center'},
    error: {color: c.danger, fontSize: 14, textAlign: 'center'},
    retry: {marginTop: spacing.md, padding: spacing.sm},
    retryText: {color: c.primary, fontSize: 14, fontWeight: '600'},
    grid: {padding: spacing.md, paddingBottom: 96, gap: GAP},
    // stretch both cards in a row to the taller one's height so their footers
    // (store label) line up
    column: {gap: GAP, alignItems: 'stretch'},
    footer: {paddingVertical: spacing.lg, alignItems: 'center'},
    footerEnd: {
      textAlign: 'center',
      color: c.textMuted,
      fontSize: 12,
      paddingVertical: spacing.lg,
    },
    moreBtn: {
      marginTop: spacing.md,
      alignSelf: 'center',
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
    },
    moreText: {color: c.primary, fontSize: 14, fontWeight: '600'},
    pressed: {opacity: 0.6},
  });

export default SearchScreen;
