// screens/StorePage.js — one store's page
//
// Shop shows this in place of the catalogue when it's opened with a
// storeId (from "Shop by store" or a product's "Sold by"). In the approved
// address/help/stores preview's design: a banner in the store's category
// color, an ID card with its logo, category, date joined and three
// figures, the store's description, its seller rating, a search (and the
// category tabs, when it sells both kinds) that stays under the header,
// and its items. Scrolling past the banner brings in a compact bar with
// the logo and name. Everything shown is the store's live data.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, RefreshControl, Platform, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  interpolate,
  Extrapolation,
  useReducedMotion,
  FadeInDown,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { showAppAlert } from '../utils/appAlert';
import { auth } from '../firebaseConfig';
import { useProducts } from '../context/ProductContext';
import { useStores, useStoreRatings, storeReviewCountLabel } from '../context/StoreContext';
import { formatAverage, matchedDescriptionSentence } from '../utils/reviews';
import { useCart } from '../context/CartContext';
import { useFavorites } from '../context/FavoritesContext';
import { Colors } from '../constants/theme';
import StarRating from '../components/ui/StarRating';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import SkeletonBlock from '../components/ui/Skeleton';
import ProductCard from '../components/shop/ProductCard';
import Reveal from '../components/shop/Reveal';
import StoreLogo from '../components/shop/StoreLogo';
import { EASE_OUT_QUINT } from '../constants/motion';

const TYPE_WORDS = {
  'ukay-ukay': 'ukay-ukay ukay secondhand second-hand pre-loved preloved thrift',
  'ready-to-wear': 'ready-to-wear rtw brand new',
};
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'ready-to-wear', label: 'Ready-to-Wear' },
  { key: 'ukay-ukay', label: 'Ukay-Ukay' },
];
// Banner colors by what the store sells: Moss for ukay-ukay, Clay for
// ready-to-wear, ink for a store that sells both.
const THEMES = {
  ukay: { from: '#5B6B4F', to: '#4A5940', tag: Colors.light.secondary, label: 'Ukay-Ukay' },
  rtw: { from: '#C4623E', to: '#A94F2F', tag: Colors.light.tint, label: 'Ready-to-Wear' },
  both: { from: '#3A3531', to: '#1C1B1A', tag: Colors.light.text, label: 'Ukay-Ukay & RTW' },
};
const COMPACT_AT = 150;
const BAR = 56;

function IconButton({ icon, label, onPress, badge, dark }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        dark ? styles.iconButtonDark : styles.iconButtonLight,
        pressed && { opacity: 0.75 },
      ]}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} items` : label}
    >
      <Ionicons name={icon} size={22} color={dark ? '#fff' : Colors.light.text} />
      {badge ? (
        <View style={[styles.badge, dark && { borderColor: 'transparent' }]}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function StorePage({ navigation, route }) {
  const storeId = route.params.storeId;
  const { products, loading, error, retryFetchProducts } = useProducts();
  const { cartCount } = useCart();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { getStore } = useStores();
  const store = getStore(storeId);
  const ratings = useStoreRatings([storeId]);
  const rating = ratings[storeId];
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [filter, setFilter] = useState('all');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutClamped, setAboutClamped] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stickyY, setStickyY] = useState(0);

  useEffect(() => {
    if (!loading) setRefreshing(false);
  }, [loading, products, error]);

  const items = useMemo(() => products.filter((p) => p.storeId === storeId), [products, storeId]);
  const sellsUkay = items.some((p) => p.type === 'ukay-ukay');
  const sellsRtw = items.some((p) => p.type === 'ready-to-wear');
  const theme = THEMES[sellsUkay && sellsRtw ? 'both' : sellsUkay ? 'ukay' : 'rtw'];

  const q = search.trim().toLowerCase();
  const shown = items
    .filter((p) => filter === 'all' || p.type === filter)
    .filter((p) => !q || p.name?.toLowerCase().includes(q) || (TYPE_WORDS[p.type] || '').includes(q));

  const handleToggleFavorite = (product) => {
    if (!auth.currentUser) {
      showAppAlert('Login Required', 'Please sign in to save favorites.', [
        { text: 'Login', onPress: () => navigation.navigate('Login') },
        { text: 'Cancel' },
      ]);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleFavorite(product);
  };

  // Scroll drives the compact bar and keeps the search under it.
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const barHeight = insets.top + BAR;
  const compactStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [COMPACT_AT - 30, COMPACT_AT], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(scrollY.value, [COMPACT_AT - 30, COMPACT_AT], [-8, 0], Extrapolation.CLAMP) }],
  }));
  // Keeps the search (and tabs) pinned just under the compact bar once it
  // reaches it: moved down by exactly as far as the page has scrolled past
  // that point. A transform, not a sticky header, so it behaves the same on
  // phones and on the web, and never changes the layout.
  const stickyStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: stickyY ? Math.max(0, scrollY.value - (stickyY - barHeight)) : 0 }],
  }));
  // The banner drifts down a little as the page scrolls up.
  const bannerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(scrollY.value, [0, 200], [0, 70], Extrapolation.CLAMP) }],
  }));

  const since = store?.createdAt
    ? `On PlainCo since ${store.createdAt.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })}`
    : null;
  const rated = rating?.count > 0;
  const name = store?.name || 'Store';
  const cellWidth = (width - 40 - 12) / 2;

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // The app is edge-to-edge, so the last row of products would sit
        // behind Android's navigation bar without the bottom inset.
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              retryFetchProducts?.();
            }}
            tintColor={Colors.light.tint}
            colors={[Colors.light.tint]}
          />
        }
      >
        {/* Banner, ID card, about, rating */}
        <View>
          <View style={[styles.hero, { height: insets.top + 196 }]}>
            <Animated.View style={[StyleSheet.absoluteFill, bannerStyle]}>
              <LinearGradient colors={[theme.from, theme.to]} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={StyleSheet.absoluteFill} />
              <View style={[styles.heroRing, { width: 220, height: 220, right: -70, top: -60 }]} />
              <View style={[styles.heroRing, { width: 140, height: 140, left: -50, top: 120 }]} />
            </Animated.View>
          </View>

          <Reveal delay={60} style={styles.idCard}>
            <StoreLogo uri={store?.logoUrl} size={72} radius={20} style={styles.idLogo} />
            <Text style={styles.idName} accessibilityRole="header">
              {name}
            </Text>
            <View style={styles.meta}>
              {items.length ? (
                <View style={[styles.catTag, { backgroundColor: theme.tag }]}>
                  <Text style={styles.catTagText}>{theme.label}</Text>
                </View>
              ) : null}
              {items.length && since ? <Text style={styles.metaText}>·</Text> : null}
              {since ? <Text style={styles.metaText}>{since}</Text> : null}
            </View>
            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{loading ? '—' : items.length}</Text>
                <Text style={styles.statLabel}>Items</Text>
              </View>
              <View style={[styles.stat, styles.statMiddle]}>
                <View style={styles.statRow}>
                  <Text style={styles.statValue}>{rated ? formatAverage(rating.average) : '—'}</Text>
                  {rated ? <Ionicons name="star" size={14} color={Colors.light.tint} /> : null}
                </View>
                <Text style={styles.statLabel}>Rating</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{rated ? `${rating.matchedCount}/${rating.count}` : '—'}</Text>
                <Text style={styles.statLabel}>As described</Text>
              </View>
            </View>
          </Reveal>

          {store?.description ? (
            <Reveal delay={140} style={styles.about}>
              <Text
                style={styles.aboutText}
                numberOfLines={aboutOpen ? undefined : 3}
                onTextLayout={(e) => {
                  if (!aboutOpen && e.nativeEvent.lines.length >= 3) setAboutClamped(true);
                }}
              >
                {store.description}
              </Text>
              {aboutClamped ? (
                <Pressable onPress={() => setAboutOpen((v) => !v)} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.aboutMore}>{aboutOpen ? 'Show less' : 'Read more'}</Text>
                </Pressable>
              ) : null}
            </Reveal>
          ) : null}

          {/* Nothing until the rating has loaded, so a slow read never
              flashes "No reviews yet" at a store that has some. */}
          {rating ? (
            <Reveal delay={200}>
              {rated ? (
                <View style={styles.review}>
                  <Text style={styles.reviewScore}>{formatAverage(rating.average)}</Text>
                  <View style={styles.flex}>
                    <StarRating rating={rating.average} size={14} label={name} />
                    <Text style={styles.reviewText}>
                      Based on {storeReviewCountLabel(rating)} · {matchedDescriptionSentence(rating)}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.review}>
                  <View style={styles.flex}>
                    <Text style={styles.reviewNoneTitle}>No reviews yet</Text>
                    <Text style={styles.reviewText}>Buyers can review an item once their order is delivered.</Text>
                  </View>
                </View>
              )}
            </Reveal>
          ) : null}
        </View>

        {/* Search (and tabs), pinned under the bar once it gets there */}
        <Animated.View style={[styles.sticky, stickyStyle]} onLayout={(e) => setStickyY(e.nativeEvent.layout.y)}>
          <View>
            {searchFocused ? <View style={styles.searchHalo} /> : null}
            <View style={[styles.search, searchFocused && { borderColor: Colors.light.tint }]}>
              <Ionicons name="search" size={19} color={Colors.light.icon} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={setSearch}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="Search this store"
                placeholderTextColor="#8E857B"
                returnKeyType="search"
                autoCorrect={false}
                accessibilityLabel="Search this store"
              />
              {search ? (
                <Pressable onPress={() => setSearch('')} style={styles.clear} hitSlop={8} accessibilityLabel="Clear search">
                  <Ionicons name="close" size={14} color={Colors.light.text} />
                </Pressable>
              ) : null}
            </View>
          </View>
          {/* A store that sells only one kind has nothing to switch between. */}
          {sellsUkay && sellsRtw ? (
            <View style={styles.tabs}>
              {FILTERS.map((f) => {
                const on = filter === f.key;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setFilter(f.key);
                    }}
                    style={[styles.tab, on && styles.tabOn]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
                      {f.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </Animated.View>

        {/* The items */}
        <View style={styles.itemsWrap}>
          <View style={styles.gridHead}>
            <Text style={styles.gridTitle}>{filter === 'all' ? 'All items' : FILTERS.find((f) => f.key === filter).label}</Text>
            {!loading && !error ? (
              <Text style={styles.gridCount}>
                {shown.length} {shown.length === 1 ? 'item' : 'items'}
              </Text>
            ) : null}
          </View>
          {loading ? (
            <View style={styles.grid}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={{ width: cellWidth }}>
                  <SkeletonBlock style={{ aspectRatio: 4 / 5, borderRadius: 18 }} />
                  <SkeletonBlock style={{ height: 12, borderRadius: 6, marginTop: 10, width: '80%' }} />
                </View>
              ))}
            </View>
          ) : error ? (
            <View style={styles.errorState}>
              <EmptyState icon="cloud-offline-outline" title="Couldn't load this store's items" subtitle="Check your connection and try again." />
              <Button variant="secondary" label="Retry" onPress={retryFetchProducts} />
            </View>
          ) : shown.length ? (
            <View style={styles.grid}>
              {shown.map((p, i) => (
                <Animated.View
                  key={p.id}
                  style={{ width: cellWidth }}
                  entering={reduceMotion ? undefined : FadeInDown.delay(120 + Math.min(i, 7) * 50).duration(500).easing(EASE_OUT_QUINT)}
                >
                  <ProductCard
                    product={p}
                    favorited={isFavorite(p.id)}
                    onPress={() => navigation.navigate('Product', { product: p })}
                    onToggleFavorite={() => handleToggleFavorite(p)}
                  />
                </Animated.View>
              ))}
            </View>
          ) : (
            <Text style={styles.none}>
              {q
                ? `No items in this store match "${search.trim()}".`
                : items.length
                ? 'No items in this category yet.'
                : 'This store has no items yet.'}
            </Text>
          )}
        </View>
      </Animated.ScrollView>

      {/* Over the banner: back and cart. */}
      <View style={[styles.heroTop, { top: insets.top + 8 }]} pointerEvents="box-none">
        <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} dark />
        <IconButton icon="cart-outline" label="View cart" onPress={() => navigation.navigate('Cart')} badge={cartCount} dark />
      </View>

      {/* The compact bar, once the banner has scrolled away. Its buttons do
          what the banner's do, so it can sit over them while invisible. */}
      <Animated.View style={[styles.compact, { height: barHeight, paddingTop: insets.top }, compactStyle]} pointerEvents="box-none">
        <IconButton icon="chevron-back" label="Go back" onPress={() => navigation.goBack()} />
        <StoreLogo uri={store?.logoUrl} size={30} radius={9} />
        <Text style={styles.compactName} numberOfLines={1}>
          {name}
        </Text>
        <IconButton icon="cart-outline" label="View cart" onPress={() => navigation.navigate('Cart')} badge={cartCount} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  flex: { flex: 1 },

  hero: { overflow: 'hidden' },
  heroRing: { position: 'absolute', borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.14)' },
  heroTop: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  iconButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  iconButtonDark: { backgroundColor: 'rgba(255,255,255,0.14)' },
  iconButtonLight: { backgroundColor: 'transparent' },
  badge: {
    position: 'absolute',
    top: 4,
    right: 3,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: Colors.light.tint,
    borderWidth: 2,
    borderColor: Colors.light.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '600', color: '#fff' },

  idCard: {
    marginTop: -92,
    marginHorizontal: 16,
    paddingTop: 18,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    shadowColor: Colors.light.text,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 6,
  },
  idLogo: {
    marginTop: -50,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
  },
  idName: { marginTop: 10, marginBottom: 2, fontSize: 21, fontWeight: '600', letterSpacing: -0.4, lineHeight: 26, color: Colors.light.text },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: Colors.light.icon },
  catTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  catTagText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', color: '#fff' },
  stats: { flexDirection: 'row', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F1EBE3' },
  stat: { flex: 1, alignItems: 'center' },
  statMiddle: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#F1EBE3' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValue: { fontSize: 16, fontWeight: '600', color: Colors.light.text },
  statLabel: { fontSize: 10.5, color: Colors.light.icon },

  about: { marginTop: 16, marginHorizontal: 20 },
  aboutText: { fontSize: 13, lineHeight: 21, color: '#453E38' },
  aboutMore: { fontSize: 12.5, fontWeight: '600', color: Colors.light.tint, marginTop: 2 },

  review: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 14,
    marginHorizontal: 20,
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#F3EEE6',
  },
  reviewScore: { fontSize: 28, fontWeight: '600', color: Colors.light.text },
  reviewText: { fontSize: 11.5, lineHeight: 17, color: Colors.light.icon, marginTop: 3 },
  reviewNoneTitle: { fontSize: 13, fontWeight: '600', color: Colors.light.text },

  sticky: { paddingTop: 14, paddingBottom: 10, paddingHorizontal: 20, backgroundColor: Colors.light.background, zIndex: 6 },
  searchHalo: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: 18,
    backgroundColor: 'rgba(196,98,62,0.12)',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    paddingLeft: 14,
    paddingRight: 8,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    fontSize: 14.5,
    color: Colors.light.text,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  clear: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(28,27,26,0.07)', alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', gap: 6, marginTop: 10, padding: 4, backgroundColor: '#EFE9E0', borderRadius: 14 },
  tab: { flexGrow: 1, height: 36, paddingHorizontal: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabOn: {
    backgroundColor: '#FFFFFF',
    shadowColor: Colors.light.text,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 1,
  },
  tabText: { fontSize: 13, fontWeight: '500', color: Colors.light.icon },
  tabTextOn: { fontWeight: '600', color: Colors.light.text },

  itemsWrap: { paddingBottom: 40 },
  gridHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 20, paddingBottom: 10 },
  gridTitle: { fontSize: 16, fontWeight: '600', color: Colors.light.text },
  gridCount: { fontSize: 12, color: Colors.light.icon },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 18, paddingHorizontal: 20 },
  none: { textAlign: 'center', paddingVertical: 30, paddingHorizontal: 30, fontSize: 13, color: Colors.light.icon },
  errorState: { alignItems: 'center', paddingHorizontal: 20, gap: 12 },

  compact: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(250,247,242,0.97)',
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    zIndex: 9,
  },
  compactName: { flex: 1, fontSize: 16, fontWeight: '600', color: Colors.light.text },
});
