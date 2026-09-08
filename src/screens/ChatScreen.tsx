import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  AbortedError,
  ChatTurn,
  FlyerPage,
  NoServerError,
  Product,
  flyerStatus,
  pageKey,
  sendChat,
} from '../api/extract';
import ProductCard from '../components/ProductCard';
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

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  products?: Product[];
  terms?: string[];
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

/** Last 6 turns; product replies collapse to a marker so the model never re-reads card JSON. */
function buildHistory(all: ChatMessage[]): ChatTurn[] {
  return all
    .filter(m => !m.pending && !m.error && m.id !== 'greeting')
    .slice(-6)
    .map(m => ({
      role: m.role,
      content:
        m.role === 'assistant' && m.products?.length
          ? `(showed ${m.products.length} products for: ${(m.terms ?? [])
              .slice(0, 4)
              .join(', ')})`
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
  /** Message ids whose "+ N more" list has been expanded. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const abortRef = useRef<AbortController | null>(null);
  const reqId = useRef(0);
  const listRef = useRef<FlatList<ChatMessage>>(null);

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
                products: res.products,
                terms: res.terms,
              }
            : m,
        ),
      );
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
    } finally {
      if (id === reqId.current) {
        setSending(false);
        abortRef.current = null;
      }
    }
  };

  const stop = () => abortRef.current?.abort();

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

    const products = item.products ?? [];
    // 7+ matches: top FEATURED as cards, the tail behind a "+ N more" tap.
    const split = products.length > FEATURED + 2;
    const featured = split ? products.slice(0, FEATURED) : products;
    const rest = split ? products.slice(FEATURED) : [];
    const isOpen = expanded.has(item.id);

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

        {featured.length ? (
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
        ) : null}

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
              onPress={() => setExpanded(prev => new Set(prev).add(item.id))}
              accessibilityRole="button"
              style={({pressed}) => [
                styles.moreBtn,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.moreBtnText}>
                + {rest.length} more {rest.length === 1 ? 'match' : 'matches'}
              </Text>
            </Pressable>
          )
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Chat" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={scrollToEnd}
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
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: {flex: 1, backgroundColor: c.background},
    flex: {flex: 1},
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

    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: CARD_GAP,
      alignItems: 'stretch',
    },

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
