import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  AbortedError,
  ChatProductGroup,
  ChatTurn,
  FlyerPage,
  NoServerError,
  Product,
  flyerStatus,
  pageKey,
  sendChat,
} from '../api/extract';
import ProductCard from '../components/ProductCard';
import ProductCarousel from '../components/ProductCarousel';
import ProductInfoModal from '../components/ProductInfoModal';
import ScreenHeader from '../components/ScreenHeader';
import SourcePageModal from '../components/SourcePageModal';
import {Palette, fonts, radius, spacing, useThemedStyles} from '../theme';

/** Clearance so the transcript / composer clear the floating pill nav bar. */
const NAV_CLEARANCE = 96;
/**
 * A reply shows the top FEATURED matches as full cards; anything past that
 * collapses to a compact "+ N more" list. Below FEATURED + 2 it's all cards.
 */
const FEATURED = 4;
const CARD_GAP = spacing.sm;
const CARD_WIDTH =
  (Dimensions.get('window').width - spacing.md * 2 - CARD_GAP) / 2;
const SORT_MENU_WIDTH = 200;

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  groups?: ChatProductGroup[];
  pending?: boolean;
  error?: boolean;
};

const GREETING: ChatMessage = {
  id: 'greeting',
  role: 'assistant',
  text: "Hi! Tell me what you're shopping for — like “find me some grapes” or “I need paper towels” — and I'll pull matching flyer deals.",
};

let seq = 0;
const uid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());

type SortMode = 'relevance' | 'price' | 'store' | 'sale';
const SORT_OPTIONS: {mode: SortMode; label: string}[] = [
  {mode: 'relevance', label: 'Relevance'},
  {mode: 'price', label: 'Price'},
  {mode: 'store', label: 'Store'},
  {mode: 'sale', label: 'On Sale'},
];

/** Relevance keeps the server's own order; the rest sort client-side and
 * only ever affect the one reply's own result set. */
function sortProducts(products: Product[], mode: SortMode): Product[] {
  if (mode === 'relevance') {
    return products;
  }
  const copy = [...products];
  if (mode === 'price') {
    copy.sort((a, b) => {
      if (a.priceValue == null) {
        return b.priceValue == null ? 0 : 1;
      }
      if (b.priceValue == null) {
        return -1;
      }
      return a.priceValue - b.priceValue;
    });
  } else if (mode === 'store') {
    copy.sort((a, b) => (a.store || '').localeCompare(b.store || ''));
  } else {
    // Stable sort — on-sale items float up, everyone else keeps the
    // server's relative (relevance) order within their own group.
    copy.sort((a, b) => Number(b.onSale) - Number(a.onSale));
  }
  return copy;
}

/**
 * Last 6 turns. Product replies collapse to a marker so the model never re-reads
 * card JSON, but the marker keeps the searched terms + any restriction so a
 * follow-up ("for kids", "the cheap ones") still has the subject in context.
 */
function buildHistory(all: ChatMessage[]): ChatTurn[] {
  return all
    .filter(m => !m.pending && !m.error && m.id !== 'greeting')
    .slice(-6)
    .map(m => ({
      role: m.role,
      content:
        m.role === 'assistant' && m.groups?.length
          ? m.groups
              .map(g => {
                const must = g.must.length
                  ? `; restricted to: ${g.must.join(', ')}`
                  : '';
                return `(showed ${g.products.length} products for: ${g.terms
                  .slice(0, 8)
                  .join(', ')}${must})`;
              })
              .join(' ')
          : m.text,
    }));
}

/** One line in the collapsed "+ N more" list — thumb, name, store, price. */
function ProductRow({
  product,
  first,
  onPress,
}: {
  product: Product;
  first: boolean;
  onPress: (p: Product) => void;
}): React.JSX.Element {
  const {styles} = useThemedStyles(makeStyles);
  const expired = flyerStatus(product.validFrom, product.validTo) === 'expired';
  const sub = [product.store, expired ? 'ended' : product.department]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={() => onPress(product)}
      accessibilityRole="button"
      accessibilityLabel={`${product.name || 'Unnamed item'}, ${
        product.price || 'no price'
      }`}
      style={({pressed}) => [
        styles.row,
        first && styles.rowFirst,
        expired && styles.rowExpired,
        pressed && styles.pressed,
      ]}>
      <View style={styles.rowThumb}>
        {product.thumb ? (
          <Image
            source={{uri: product.thumb}}
            style={styles.rowThumbImg}
            resizeMode="contain"
          />
        ) : null}
      </View>
      <View style={styles.rowMain}>
        <Text style={styles.rowName} numberOfLines={1}>
          {product.name || 'Unnamed item'}
        </Text>
        {sub ? (
          <Text style={styles.rowSub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {product.onSale ? (
        <View style={[styles.rowTag, expired && styles.rowTagOff]}>
          <Text style={[styles.rowTagText, expired && styles.rowTagTextOff]}>
            SALE
          </Text>
        </View>
      ) : null}
      <Text
        style={[
          styles.rowPrice,
          product.onSale && styles.rowPriceDeal,
          expired && styles.rowPriceMuted,
        ]}>
        {product.price || '—'}
      </Text>
    </Pressable>
  );
}

function ChatScreen(): React.JSX.Element {
  const {styles, colors} = useThemedStyles(makeStyles);

  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [pages, setPages] = useState<Map<string, FlyerPage>>(new Map());
  const [infoProduct, setInfoProduct] = useState<Product | null>(null);
  const [flyerProduct, setFlyerProduct] = useState<Product | null>(null);
  const [keyboardUp, setKeyboardUp] = useState(false);
  /** Measured height of ScreenHeader — KeyboardAvoidingView sits below it, and
   * on iOS needs that height as keyboardVerticalOffset or its "padding"
   * behavior under-compensates by roughly the header's height, leaving the
   * composer covered by the keyboard (only visible with the real on-screen
   * keyboard — a simulator driven by the host keyboard never shows it). */
  const [headerHeight, setHeaderHeight] = useState(0);
  /** Message ids whose "+ N more" list has been expanded. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Group keys currently showing the swipeable carousel instead of the grid. */
  const [carouselGroups, setCarouselGroups] = useState<Set<string>>(new Set());
  /** Per-group sort choice — absent means the default, "relevance". */
  const [groupSort, setGroupSort] = useState<Map<string, SortMode>>(new Map());
  /** Which group's sort menu is open, and where to anchor it (from the
   * trigger button's on-screen position) — at most one open at a time. */
  const [sortMenuFor, setSortMenuFor] = useState<{
    groupKey: string;
    top: number;
    left: number;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const reqId = useRef(0);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const sortBtnRefs = useRef<Map<string, View>>(new Map());

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () =>
      setKeyboardUp(true),
    );
    const hide = Keyboard.addListener('keyboardWillHide', () =>
      setKeyboardUp(false),
    );
    // Android has no "will" events
    const showA = Keyboard.addListener('keyboardDidShow', () =>
      setKeyboardUp(true),
    );
    const hideA = Keyboard.addListener('keyboardDidHide', () =>
      setKeyboardUp(false),
    );
    return () => {
      show.remove();
      hide.remove();
      showA.remove();
      hideA.remove();
    };
  }, []);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({animated: true}));
  }, []);

  // Kept in sync so scrollMessageToTop always sees the latest list, even
  // though it's called right after a setMessages() whose effect hasn't
  // committed yet.
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  /** Scroll so this message's own bubble sits at the top of the viewport —
   * used once a reply's cards land, and again whenever its sort changes,
   * so results are never left showing mid-grid with the bubble scrolled
   * out of view above. */
  const scrollMessageToTop = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const idx = messagesRef.current.findIndex(m => m.id === id);
      if (idx === -1) {
        return;
      }
      listRef.current?.scrollToIndex({
        index: idx,
        animated: true,
        viewPosition: 0,
      });
    });
  }, []);

  const mergePages = (list: FlyerPage[]) =>
    setPages(prev => {
      if (!list.length) {
        return prev;
      }
      const next = new Map(prev);
      for (const p of list) {
        next.set(pageKey(p.flyerId, p.page), p);
      }
      return next;
    });

  const send = async () => {
    const text = input.trim();
    if (!text || sending) {
      return;
    }
    Keyboard.dismiss();

    const userMsg: ChatMessage = {id: uid(), role: 'user', text};
    const placeholderId = uid();
    setMessages(prev => [
      ...prev,
      userMsg,
      {id: placeholderId, role: 'assistant', text: '', pending: true},
    ]);
    setInput('');
    setSending(true);

    const id = ++reqId.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const history = buildHistory([...messages, userMsg]);

    try {
      const res = await sendChat(history, controller.signal);
      if (id !== reqId.current) {
        return;
      }
      mergePages(res.pages);
      setMessages(prev =>
        prev.map(m =>
          m.id === placeholderId
            ? {
                ...m,
                pending: false,
                text: res.reply,
                groups: res.groups,
              }
            : m,
        ),
      );
      scrollMessageToTop(placeholderId);
    } catch (err) {
      if (id !== reqId.current) {
        return;
      }
      if (err instanceof AbortedError) {
        setMessages(prev => prev.filter(m => m.id !== placeholderId));
        return;
      }
      const message =
        err instanceof NoServerError || err instanceof Error
          ? err.message
          : 'Something went wrong.';
      setMessages(prev =>
        prev.map(m =>
          m.id === placeholderId
            ? {...m, pending: false, error: true, text: message}
            : m,
        ),
      );
      scrollMessageToTop(placeholderId);
    } finally {
      if (id === reqId.current) {
        setSending(false);
        abortRef.current = null;
      }
    }
  };

  const stop = () => abortRef.current?.abort();

  const resetChat = () => {
    abortRef.current?.abort();
    reqId.current++;
    setMessages([GREETING]);
    setInput('');
    setSending(false);
    setExpanded(new Set());
    setCarouselGroups(new Set());
    setGroupSort(new Map());
    setSortMenuFor(null);
    setInfoProduct(null);
    setFlyerProduct(null);
    Keyboard.dismiss();
    requestAnimationFrame(() =>
      listRef.current?.scrollToOffset({offset: 0, animated: false}),
    );
  };

  const newChat = () => {
    Alert.alert(
      'Start a new chat?',
      'This clears the current conversation and its results.',
      [
        {text: 'Cancel', style: 'cancel'},
        {text: 'New chat', style: 'destructive', onPress: resetChat},
      ],
    );
  };

  const toggleCarousel = (groupKey: string) =>
    setCarouselGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });

  const setSortMode = (groupKey: string, mode: SortMode) => {
    setGroupSort(prev => {
      const next = new Map(prev);
      if (mode === 'relevance') {
        next.delete(groupKey);
      } else {
        next.set(groupKey, mode);
      }
      return next;
    });
    // groupKey is "<message id>:<group index>" — the message id has no
    // colon of its own (see uid()), so splitting on the last one is safe.
    scrollMessageToTop(groupKey.slice(0, groupKey.lastIndexOf(':')));
  };

  const openSortMenu = (groupKey: string) => {
    const node = sortBtnRefs.current.get(groupKey);
    node?.measureInWindow((x, y, width, height) => {
      const screenWidth = Dimensions.get('window').width;
      setSortMenuFor({
        groupKey,
        top: y + height + 6,
        left: Math.max(
          spacing.md,
          Math.min(x, screenWidth - SORT_MENU_WIDTH - spacing.md),
        ),
      });
    });
  };

  const openInFlyer = (product: Product) => {
    setInfoProduct(null);
    // Let the info sheet dismiss before the next Modal — stacked Modal
    // transitions glitch on iOS otherwise (same as SearchScreen).
    setTimeout(() => setFlyerProduct(product), 260);
  };

  const renderItem = ({item}: {item: ChatMessage}) => {
    if (item.role === 'user') {
      return (
        <View style={styles.rowRight}>
          <View style={[styles.bubble, styles.bubbleUser]}>
            <Text style={styles.bubbleUserText}>{item.text}</Text>
          </View>
        </View>
      );
    }

    const groups = item.groups ?? [];
    // Multiple distinct products ("tomatoes and chips") each get their own
    // labeled section so results don't blur together; a single product
    // keeps the plain, header-less layout this already had.
    const showHeaders = groups.length > 1;

    return (
      <View style={styles.rowLeft}>
        {item.pending ? (
          <View style={[styles.bubble, styles.bubbleBot]}>
            <ActivityIndicator color={colors.textMuted} />
          </View>
        ) : (
          <View
            style={[
              styles.bubble,
              styles.bubbleBot,
              item.error && styles.bubbleError,
            ]}>
            <Text
              style={[
                styles.bubbleBotText,
                item.error && styles.bubbleErrorText,
              ]}>
              {item.text}
            </Text>
          </View>
        )}

        {groups.map((group, gi) => {
          const groupKey = `${item.id}:${gi}`;
          const sortMode = groupSort.get(groupKey) ?? 'relevance';
          const sortLabel =
            SORT_OPTIONS.find(o => o.mode === sortMode)?.label ?? 'Relevance';
          const products = sortProducts(group.products, sortMode);
          if (!products.length) {
            return null;
          }
          // 7+ matches: top FEATURED as cards, the tail behind a "+ N more" tap.
          const split = products.length > FEATURED + 2;
          const featured = split ? products.slice(0, FEATURED) : products;
          const rest = split ? products.slice(FEATURED) : [];
          const isOpen = expanded.has(groupKey);
          const showCarousel = carouselGroups.has(groupKey);

          return (
            <View key={groupKey} style={styles.group}>
              {showHeaders ? (
                <Text style={styles.groupHeader}>
                  {titleCase(group.label)} ({group.total})
                </Text>
              ) : null}

              {products.length > 1 ? (
                <View style={styles.controlsRow}>
                  <Pressable
                    ref={el => {
                      if (el) {
                        sortBtnRefs.current.set(groupKey, el);
                      }
                    }}
                    onPress={() => openSortMenu(groupKey)}
                    accessibilityRole="button"
                    accessibilityLabel={`Sort by ${sortLabel}. Opens a menu with more options.`}
                    style={({pressed}) => [
                      styles.viewToggle,
                      sortMenuFor?.groupKey === groupKey && styles.sortBtnOpen,
                      pressed && styles.pressed,
                    ]}>
                    <View style={styles.sortIcon}>
                      <View style={[styles.sortIconBar, styles.sortIconBar1]} />
                      <View style={[styles.sortIconBar, styles.sortIconBar2]} />
                      <View style={[styles.sortIconBar, styles.sortIconBar3]} />
                    </View>
                    <Text style={styles.viewToggleText}>Sort: {sortLabel}</Text>
                    <View
                      style={[
                        styles.caret,
                        sortMenuFor?.groupKey === groupKey && styles.caretOpen,
                      ]}
                    />
                  </Pressable>

                  <Pressable
                    onPress={() => toggleCarousel(groupKey)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      showCarousel ? 'View as grid' : 'View as carousel'
                    }
                    style={({pressed}) => [
                      styles.viewToggle,
                      pressed && styles.pressed,
                    ]}>
                    {showCarousel ? (
                      <View style={styles.gridIcon}>
                        <View style={styles.gridIconSq} />
                        <View style={styles.gridIconSq} />
                        <View style={styles.gridIconSq} />
                        <View style={styles.gridIconSq} />
                      </View>
                    ) : (
                      <View style={styles.stackIcon}>
                        <View
                          style={[styles.stackIconLayer, styles.stackIconBack]}
                        />
                        <View
                          style={[styles.stackIconLayer, styles.stackIconMid]}
                        />
                        <View
                          style={[styles.stackIconLayer, styles.stackIconFront]}
                        />
                      </View>
                    )}
                    <Text style={styles.viewToggleText}>
                      {showCarousel ? 'View as grid' : 'View as carousel'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {showCarousel ? (
                <ProductCarousel products={products} onPress={setInfoProduct} />
              ) : (
                <>
                  <View style={styles.grid}>
                    {featured.map(p => (
                      <ProductCard
                        key={p.id}
                        product={p}
                        width={CARD_WIDTH}
                        onPress={setInfoProduct}
                      />
                    ))}
                  </View>

                  {rest.length ? (
                    isOpen ? (
                      <View style={styles.rows}>
                        {rest.map((p, i) => (
                          <ProductRow
                            key={p.id}
                            product={p}
                            first={i === 0}
                            onPress={setInfoProduct}
                          />
                        ))}
                      </View>
                    ) : (
                      <Pressable
                        onPress={() =>
                          setExpanded(prev => new Set(prev).add(groupKey))
                        }
                        accessibilityRole="button"
                        style={({pressed}) => [
                          styles.moreBtn,
                          pressed && styles.pressed,
                        ]}>
                        <Text style={styles.moreBtnText}>
                          + {rest.length} more{' '}
                          {rest.length === 1 ? 'match' : 'matches'}
                        </Text>
                      </Pressable>
                    )
                  ) : null}
                </>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View onLayout={e => setHeaderHeight(e.nativeEvent.layout.height)}>
        <ScreenHeader
          title="Chat"
          action={
            messages.length > 1 ? (
              <Pressable
                onPress={newChat}
                accessibilityRole="button"
                accessibilityLabel="Start a new chat"
                hitSlop={8}
                style={({pressed}) => [
                  styles.newChatBtn,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.newChatText}>New chat</Text>
              </Pressable>
            ) : undefined
          }
        />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          // Follow the tail while a reply is still pending (so the "…"
          // indicator stays in view); once it lands, scrollMessageToTop
          // takes over so the reply's own bubble — not the end of a long
          // card grid — is what the user sees.
          onContentSizeChange={() => {
            if (sending) {
              scrollToEnd();
            }
          }}
          onScrollToIndexFailed={info => {
            setTimeout(
              () =>
                listRef.current?.scrollToIndex({
                  index: info.index,
                  animated: true,
                  viewPosition: 0,
                }),
              50,
            );
          }}
        />

        <View
          style={[
            styles.composer,
            {paddingBottom: keyboardUp ? spacing.sm : NAV_CLEARANCE},
          ]}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="What are you looking for?"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={500}
            editable={!sending}
            onSubmitEditing={send}
            returnKeyType="send"
            blurOnSubmit
          />
          {sending ? (
            <Pressable
              onPress={stop}
              accessibilityRole="button"
              accessibilityLabel="Stop"
              style={({pressed}) => [
                styles.sendBtn,
                styles.stopBtn,
                pressed && styles.pressed,
              ]}>
              <View style={styles.stopSquare} />
            </Pressable>
          ) : (
            <Pressable
              onPress={send}
              disabled={!input.trim()}
              accessibilityRole="button"
              accessibilityLabel="Send"
              style={({pressed}) => [
                styles.sendBtn,
                !input.trim() && styles.sendBtnOff,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.sendArrow}>↑</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      <ProductInfoModal
        product={infoProduct}
        page={
          infoProduct
            ? pages.get(pageKey(infoProduct.flyerId, infoProduct.page))
            : undefined
        }
        onClose={() => setInfoProduct(null)}
        onViewInFlyer={openInFlyer}
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

      <Modal
        transparent
        visible={!!sortMenuFor}
        animationType="fade"
        onRequestClose={() => setSortMenuFor(null)}>
        <Pressable
          style={styles.sortMenuBackdrop}
          onPress={() => setSortMenuFor(null)}
          accessibilityLabel="Close sort menu">
          {sortMenuFor ? (
            <Pressable
              onPress={() => {}}
              style={[
                styles.sortMenu,
                {top: sortMenuFor.top, left: sortMenuFor.left},
              ]}>
              {SORT_OPTIONS.map(opt => {
                const active =
                  (groupSort.get(sortMenuFor.groupKey) ?? 'relevance') ===
                  opt.mode;
                return (
                  <Pressable
                    key={opt.mode}
                    onPress={() => {
                      setSortMode(sortMenuFor.groupKey, opt.mode);
                      setSortMenuFor(null);
                    }}
                    accessibilityRole="menuitem"
                    accessibilityState={{selected: active}}
                    style={({pressed}) => [
                      styles.sortMenuItem,
                      pressed && styles.sortMenuItemPressed,
                    ]}>
                    <Text
                      style={[
                        styles.sortMenuItemText,
                        active && styles.sortMenuItemTextOn,
                      ]}>
                      {opt.label}
                    </Text>
                    <View style={[styles.sortDot, active && styles.sortDotOn]}>
                      {active ? <View style={styles.sortDotInner} /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: {flex: 1, backgroundColor: c.background},
    flex: {flex: 1},

    newChatBtn: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm + 2,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    newChatText: {
      color: c.primary,
      fontFamily: fonts.semibold,
      fontSize: 12,
      fontWeight: '600',
    },
    list: {padding: spacing.md, gap: spacing.md, flexGrow: 1},

    rowLeft: {alignItems: 'flex-start', gap: spacing.sm},
    rowRight: {alignItems: 'flex-end'},

    bubble: {
      maxWidth: '86%',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.lg,
    },
    bubbleUser: {
      backgroundColor: c.primary,
      borderBottomRightRadius: radius.sm,
    },
    bubbleUserText: {
      color: c.onPrimary,
      fontFamily: fonts.medium,
      fontSize: 15,
      fontWeight: '500',
      lineHeight: 20,
    },
    bubbleBot: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderBottomLeftRadius: radius.sm,
    },
    bubbleBotText: {
      color: c.text,
      fontFamily: fonts.body,
      fontSize: 15,
      lineHeight: 20,
    },
    bubbleError: {
      backgroundColor: c.dealTint,
      borderColor: c.danger,
    },
    bubbleErrorText: {color: c.danger},

    group: {alignSelf: 'stretch', gap: spacing.sm},
    groupHeader: {
      color: c.text,
      fontFamily: fonts.semibold,
      fontSize: 13,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },

    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: CARD_GAP,
      alignItems: 'stretch',
    },

    controlsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: spacing.xs,
    },
    sortBtnOpen: {
      backgroundColor: c.primaryTint,
      borderColor: c.primary,
    },
    sortIcon: {width: 14, height: 14, justifyContent: 'center', gap: 2.5},
    sortIconBar: {height: 2, borderRadius: 1, backgroundColor: c.primary},
    sortIconBar1: {width: 12},
    sortIconBar2: {width: 8},
    sortIconBar3: {width: 4},
    caret: {
      width: 0,
      height: 0,
      marginLeft: 1,
      borderLeftWidth: 4,
      borderRightWidth: 4,
      borderTopWidth: 5,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
      borderTopColor: c.primary,
    },
    caretOpen: {transform: [{rotate: '180deg'}]},

    sortMenuBackdrop: {flex: 1},
    sortMenu: {
      position: 'absolute',
      width: SORT_MENU_WIDTH,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: 6,
      gap: 1,
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 8},
      shadowOpacity: 0.18,
      shadowRadius: 20,
      elevation: 8,
    },
    sortMenuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm + 2,
      borderRadius: radius.sm,
    },
    sortMenuItemPressed: {backgroundColor: c.surfaceAlt},
    sortMenuItemText: {
      color: c.text,
      fontFamily: fonts.semibold,
      fontSize: 13.5,
      fontWeight: '600',
    },
    sortMenuItemTextOn: {color: c.primary},
    sortDot: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 1.5,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sortDotOn: {borderColor: c.primary},
    sortDotInner: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: c.primary,
    },

    viewToggle: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.sm + 3,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    viewToggleText: {
      color: c.primary,
      fontFamily: fonts.semibold,
      fontSize: 12,
      fontWeight: '600',
    },
    gridIcon: {
      width: 14,
      height: 14,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 2,
    },
    gridIconSq: {
      width: 6,
      height: 6,
      borderRadius: 1.5,
      backgroundColor: c.primary,
    },
    stackIcon: {width: 15, height: 15},
    stackIconLayer: {
      position: 'absolute',
      width: 11,
      height: 9,
      borderRadius: 2.5,
      borderWidth: 1.4,
      borderColor: c.primary,
    },
    stackIconBack: {left: 0, top: 5, backgroundColor: c.surface},
    stackIconMid: {left: 2, top: 2.5, backgroundColor: c.surface},
    stackIconFront: {left: 4, top: 0, backgroundColor: c.primaryTint},

    moreBtn: {
      alignSelf: 'stretch',
      alignItems: 'center',
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    moreBtnText: {
      color: c.primary,
      fontFamily: fonts.semibold,
      fontSize: 13,
      fontWeight: '600',
    },

    rows: {
      alignSelf: 'stretch',
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      backgroundColor: c.surface,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm + 2,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    rowFirst: {borderTopWidth: 0},
    rowExpired: {opacity: 0.62},
    rowThumb: {
      width: 40,
      height: 40,
      borderRadius: 8,
      backgroundColor: c.imageBackdrop,
      overflow: 'hidden',
    },
    rowThumbImg: {width: '100%', height: '100%'},
    rowMain: {flex: 1, minWidth: 0},
    rowName: {
      color: c.text,
      fontFamily: fonts.semibold,
      fontSize: 13,
      fontWeight: '600',
    },
    rowSub: {
      color: c.textMuted,
      fontSize: 11,
      textTransform: 'capitalize',
      marginTop: 1,
    },
    rowTag: {
      paddingVertical: 2,
      paddingHorizontal: 5,
      borderRadius: 4,
      backgroundColor: c.deal,
    },
    rowTagOff: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: c.textMuted,
    },
    rowTagText: {
      color: '#fff',
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.4,
    },
    rowTagTextOff: {color: c.textMuted},
    rowPrice: {
      color: c.text,
      fontFamily: fonts.display,
      fontSize: 14,
      fontWeight: '800',
    },
    rowPriceDeal: {color: c.deal},
    rowPriceMuted: {color: c.textMuted},

    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
      backgroundColor: c.background,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    input: {
      flex: 1,
      maxHeight: 120,
      minHeight: 44,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      paddingHorizontal: spacing.md,
      paddingTop: Platform.OS === 'ios' ? 12 : 8,
      paddingBottom: Platform.OS === 'ios' ? 12 : 8,
      fontSize: 15,
      color: c.text,
    },
    sendBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnOff: {backgroundColor: c.border},
    sendArrow: {
      color: c.onPrimary,
      fontSize: 20,
      fontWeight: '800',
      lineHeight: 22,
    },
    stopBtn: {backgroundColor: c.surfaceAlt},
    stopSquare: {
      width: 14,
      height: 14,
      borderRadius: 3,
      backgroundColor: c.text,
    },
    pressed: {opacity: 0.7},
  });

export default ChatScreen;
