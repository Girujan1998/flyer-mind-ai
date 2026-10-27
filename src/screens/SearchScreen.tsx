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
  ProductGroup,
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
import {Palette, fonts, radius, spacing, useThemedStyles} from '../theme';

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
  expiredCount: 0,
  expiredIncludedCount: 0,
  total: 0,
};

function SearchScreen(): React.JSX.Element {
  const {styles, colors} = useThemedStyles(makeStyles);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  const [filters, setFilters] = useState<ProductFilters>(EMPTY_FILTERS);
  const [facets, setFacets] = useState<FilterFacets>(NO_FACETS);
  const [filterOpen, setFilterOpen] = useState(false);

  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [pages, setPages] = useState<Map<string, FlyerPage>>(new Map());
  const [totalProducts, setTotalProducts] = useState(0);
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
      setGroups(res.groups);
      setPages(new Map(res.pages.map(p => [pageKey(p.flyerId, p.page), p])));
      setTotalProducts(res.totalProducts);
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
      setGroups([]);
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
        offset: groups.length,
      });
      setGroups(prev => [...prev, ...res.groups]);
      mergePages(res.pages);
      setTotalProducts(res.totalProducts);
      setHasMore(res.hasMore);
    } catch {
      // keep what we have; the button stays for a retry
    } finally {
      setLoadingMore(false);
    }
  };

  const loadedProducts = groups.reduce((n, g) => n + g.products.length, 0);

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
            Load more ({loadedProducts} of {totalProducts})
          </Text>
        </Pressable>
      );
    }
    if (groups.length > 0) {
      return <Text style={styles.footerEnd}>{totalProducts} products</Text>;
    }
    return null;
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Search"
        trailing={
          // count for the current query + filters, not the grand total
          !error && totalProducts > 0 ? `${totalProducts} items` : undefined
        }
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
      ) : groups.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>
            {debounced
              ? `No products match "${debounced}".`
              : activeFilters > 0
              ? 'No products match these filters.'
              : facets.expiredCount > 0
              ? 'No active or upcoming flyers right now.'
              : 'No products yet — upload a flyer.'}
          </Text>
          {activeFilters > 0 ? (
            <Pressable
              onPress={() => setFilters(EMPTY_FILTERS)}
              style={styles.retry}>
              <Text style={styles.retryText}>Clear filters</Text>
            </Pressable>
          ) : facets.expiredCount > 0 ? (
            <Pressable
              onPress={() =>
                setFilters({...EMPTY_FILTERS, includeExpired: true})
              }
              style={styles.retry}>
              <Text style={styles.retryText}>Show expired flyers</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={g => g.groupKey}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={7}
          renderItem={({item}) => (
            <View style={styles.group}>
              <Text style={styles.groupHeader}>
                {item.label}
                {item.storeCount > 1 ? (
                  <Text style={styles.groupHeaderCount}>
                    {'  ·  '}
                    {item.storeCount} stores
                  </Text>
                ) : null}
              </Text>
              <View style={styles.grid}>
                {item.products.map(p => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    width={COLUMN_WIDTH}
                    onPress={setInfoProduct}
                  />
                ))}
              </View>
            </View>
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
        page={
          infoProduct
            ? pages.get(pageKey(infoProduct.flyerId, infoProduct.page))
            : undefined
        }
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
    list: {padding: spacing.md, paddingBottom: 96, gap: spacing.lg},
    group: {gap: spacing.sm},
    groupHeader: {
      color: c.text,
      fontFamily: fonts.semibold,
      fontSize: 13,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    groupHeaderCount: {color: c.textMuted, fontWeight: '500'},
    // wraps a group's cards 2-up; stretched so a row's footers (store label)
    // line up the way the old 2-column FlatList grid did.
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: GAP,
      alignItems: 'stretch',
    },
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
