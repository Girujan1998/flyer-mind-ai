import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  DepartmentCount,
  FlyerPage,
  NoServerError,
  Product,
  fetchDepartments,
  pageKey,
  searchProducts,
} from '../api/extract';
import ProductCard from '../components/ProductCard';
import ProductInfoModal from '../components/ProductInfoModal';
import SourcePageModal from '../components/SourcePageModal';
import {colors, radius, spacing} from '../theme';

const PAGE_SIZE = 20;
const GAP = spacing.sm;
const COLUMN_WIDTH =
  (Dimensions.get('window').width - spacing.md * 2 - GAP) / 2;

function titleCase(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function SearchScreen(): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [department, setDepartment] = useState('');
  const [departments, setDepartments] = useState<DepartmentCount[]>([]);

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

  // debounce the search box
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(id);
  }, [query]);

  // the aisle filter chips — load once, refresh when the catalog might have grown
  useEffect(() => {
    fetchDepartments()
      .then(res => setDepartments(res.departments))
      .catch(() => setDepartments([]));
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
        department,
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
  }, [debounced, department]);

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
        department,
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
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search products"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {departments.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled">
          <Chip
            label="All"
            active={department === ''}
            onPress={() => setDepartment('')}
          />
          {departments.map(d => (
            <Chip
              key={d.department}
              label={titleCase(d.department)}
              count={d.count}
              active={department === d.department}
              onPress={() =>
                setDepartment(prev =>
                  prev === d.department ? '' : d.department,
                )
              }
            />
          ))}
        </ScrollView>
      ) : null}

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
              ? `No products match "${debounced}"${
                  department ? ` in ${titleCase(department)}` : ''
                }.`
              : department
              ? `Nothing in ${titleCase(department)} yet.`
              : 'No products yet — upload a flyer.'}
          </Text>
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

function Chip({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count?: number;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{selected: active}}
      style={({pressed}) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
        {count != null ? ` ${count}` : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  searchWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  input: {
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  empty: {color: colors.textMuted, fontSize: 14, textAlign: 'center'},
  error: {color: colors.danger, fontSize: 14, textAlign: 'center'},
  retry: {marginTop: spacing.md, padding: spacing.sm},
  retryText: {color: colors.primary, fontSize: 14, fontWeight: '600'},
  chips: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs + 2,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primary,
  },
  chipText: {fontSize: 12, fontWeight: '600', color: colors.textMuted},
  chipTextActive: {color: colors.primary},
  grid: {padding: spacing.md, paddingBottom: 96, gap: GAP},
  column: {gap: GAP},
  footer: {paddingVertical: spacing.lg, alignItems: 'center'},
  footerEnd: {
    textAlign: 'center',
    color: colors.textMuted,
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
    borderColor: colors.border,
  },
  moreText: {color: colors.primary, fontSize: 14, fontWeight: '600'},
  pressed: {opacity: 0.6},
});

export default SearchScreen;
