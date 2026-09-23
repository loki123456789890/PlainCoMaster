// screens/Shopscreen.js
//
// The catalogue, in the approved home/shop preview's design: a header that
// stays put (title and count, search, category tabs with a sliding
// indicator) over a two-column grid, and the tab bar underneath.
//
// One screen, two views. Without a storeId this is the whole shop, opened
// as a tab; with one it is that store's page, pushed from "Shop by store"
// or a product's "Sold by" line, with a back arrow instead of the tab bar.
// Same grid, search and filters either way, so a store page is the Shop
// narrowed rather than a second catalogue to keep in step.
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  TextInput,
  RefreshControl,
  ScrollView,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  useReducedMotion,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { showAppAlert } from '../utils/appAlert';
import { auth } from '../firebaseConfig';
import { useProducts } from '../context/ProductContext';
import { useStores, useStoreRatings, storeReviewCountLabel } from '../context/StoreContext';
import { formatAverage, matchedDescriptionSentence } from '../utils/reviews';
import { useCart } from '../context/CartContext';
import { useFavorites } from '../context/FavoritesContext';
import { Colors } from '../constants/theme';
import StarRating from '../components/ui/StarRating';
import Avatar from '../components/ui/Avatar';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import SkeletonBlock from '../components/ui/Skeleton';
import ProductCard from '../components/shop/ProductCard';
import TabBar from '../components/shop/TabBar';
import Reveal from '../components/shop/Reveal';
import { EASE_OUT_QUINT } from '../constants/motion';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'ready-to-wear', label: 'Ready-to-Wear' },
  { key: 'ukay-ukay', label: 'Ukay-Ukay' },
];
const FILTER_LABEL = { 'ready-to-wear': 'Ready-to-Wear', 'ukay-ukay': 'Ukay-Ukay' };

// Words a shopper might type for a category, beyond its stored name.
const TYPE_WORDS = {
  'ukay-ukay': 'ukay-ukay ukay secondhand second-hand pre-loved preloved thrift',
  'ready-to-wear': 'ready-to-wear rtw brand new',
};

// A store younger than this, with no reviews yet, is labelled "New store".
const NEW_STORE_MS = 30 * 24 * 60 * 60 * 1000;

const menuItems = [
  { icon: 'location-outline', label: 'Location' },
  { icon: 'help-circle-outline', label: 'Help' },
];

// The category tabs: a white pill slides under the chosen one.
function FilterTabs({ active, onSelect }) {
  const reduceMotion = useReducedMotion();
  const [layouts, setLayouts] = useState({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const ready = FILTERS.every((f) => layouts[f.key]);

  useEffect(() => {
    const l = layouts[active];
    if (!l) return;
    const firstPlacement = w.value === 0;
    const timing = { duration: 380, easing: EASE_OUT_QUINT };
    x.value = reduceMotion || firstPlacement ? l.x : withTiming(l.x, timing);
    w.value = reduceMotion || firstPlacement ? l.width : withTiming(l.width, timing);
  }, [active, layouts]); // eslint-disable-line react-hooks/exhaustive-deps

  const indicator = useAnimatedStyle(() => ({ width: w.value, transform: [{ translateX: x.value }] }));

  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {ready ? <Animated.View style={[styles.tabIndicator, indicator]} /> : null}
      {FILTERS.map((f) => {
        const on = f.key === active;
        return (
          <Pressable
            key={f.key}
            style={styles.tab}
            onLayout={(e) => {
              const { x: lx, width } = e.nativeEvent.layout;
              setLayouts((prev) => ({ ...prev, [f.key]: { x: lx, width } }));
            }}
            onPress={() => onSelect(f.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Show ${f.label}`}
          >
            <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
              {f.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Loading placeholder shaped like the grid, so nothing shifts when it fills.
function GridSkeleton() {
  return (
    <View style={styles.skeletonGrid}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={styles.skeletonCell}>
          <SkeletonBlock style={styles.skeletonPhoto} />
          <SkeletonBlock style={styles.skeletonLine} />
          <SkeletonBlock style={[styles.skeletonLine, styles.skeletonLineShort]} />
        </View>
      ))}
    </View>
  );
}

function NoResults({ title, message, onClear }) {
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View style={styles.empty} entering={reduceMotion ? undefined : FadeIn.duration(450).easing(EASE_OUT_QUINT)}>
      <View style={styles.emptyIcon}>
        <Ionicons name="search" size={32} color={Colors.light.tint} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyText}>{message}</Text> : null}
      {onClear ? (
        <Pressable
          style={({ pressed }) => [styles.emptyButton, pressed && { opacity: 0.8 }]}
          onPress={onClear}
          accessibilityRole="button"
        >
          <Text style={styles.emptyButtonText}>Clear search &amp; filters</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export default function ShopScreen({ navigation, route }) {
  const { products, loading, error, retryFetchProducts } = useProducts();
  const { cartCount } = useCart();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { stores, getStore } = useStores();
  const storeId = route.params?.storeId || null;
  const store = getStore(storeId);
  const [activeFilter, setActiveFilter] = useState(route.params?.filterType || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const reduceMotion = useReducedMotion();
  const searchRef = useRef(null);

  // Home can send us here with a category chosen, or with the search bar
  // tapped; this also covers being sent again while already open.
  useEffect(() => {
    if (route.params?.filterType) setActiveFilter(route.params.filterType);
  }, [route.params?.filterType]);
  useEffect(() => {
    if (!route.params?.focusSearch) return undefined;
    const t = setTimeout(() => searchRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [route.params?.focusSearch]);

  // Pull to refresh re-subscribes the catalogue. Cleared on any settle of
  // the results, not just `loading`: for a signed-out viewer the retry sets
  // loading to false when it already is, which alone would never re-render.
  useEffect(() => {
    if (!loading) setRefreshing(false);
  }, [loading, products, error]);

  const handleRefresh = () => {
    setRefreshing(true);
    retryFetchProducts?.();
  };

  // Guests can browse the catalog, but favoriting needs an account.
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

  const handleSelectFilter = (key) => {
    if (key === activeFilter) return;
    Haptics.selectionAsync();
    setActiveFilter(key);
  };

  const clearAll = () => {
    setSearchQuery('');
    setActiveFilter('all');
  };

  const scopedProducts = useMemo(
    () => (storeId ? products.filter((p) => p.storeId === storeId) : products),
    [products, storeId]
  );

  // Items per store, for "Shop by store". A store with nothing listed is
  // left out: a card that leads to an empty page is a dead end.
  const storeCounts = useMemo(() => {
    const counts = {};
    products.forEach((p) => {
      if (p.storeId) counts[p.storeId] = (counts[p.storeId] || 0) + 1;
    });
    return counts;
  }, [products]);
  const browsableStores = stores.filter((s) => storeCounts[s.id] > 0);

  // Seller ratings, side by side in the store row and in full on a store's page.
  const ratings = useStoreRatings(storeId ? [storeId] : browsableStores.map((s) => s.id));
  const storeRating = storeId ? ratings[storeId] : undefined;

  // What the store sells, read off its listings, so it cannot claim a
  // category it has no items in.
  const storeSells = [
    scopedProducts.some((p) => p.type === 'ukay-ukay') && 'Ukay-Ukay',
    scopedProducts.some((p) => p.type === 'ready-to-wear') && 'Ready-to-Wear',
  ].filter(Boolean);

  // Category and search compose (AND): typing never resets the tab.
  const query = searchQuery.trim().toLowerCase();
  const filteredProducts = scopedProducts
    .filter((p) => activeFilter === 'all' || p.type === activeFilter)
    .filter((p) => !query || p.name?.toLowerCase().includes(query) || (TYPE_WORDS[p.type] || '').includes(query));

  const showFilters = !storeId || storeSells.length > 1;
  const count = filteredProducts.length;

  const renderProduct = ({ item, index }) => (
    <Animated.View
      style={styles.cell}
      entering={reduceMotion ? undefined : FadeInDown.delay(Math.min(index, 7) * 45).duration(500).easing(EASE_OUT_QUINT)}
    >
      <ProductCard
        product={item}
        favorited={isFavorite(item.id)}
        storeName={storeId ? null : getStore(item.storeId)?.name}
        onPress={() => navigation.navigate('Product', { product: item })}
        onToggleFavorite={() => handleToggleFavorite(item)}
      />
    </Animated.View>
  );

  const renderListHeader = () => (
    <>
      {/* A store's own page: its logo, what it sells, how long it has been
          on PlainCo, its description and its seller rating. */}
      {storeId ? (
        <View style={styles.profile}>
          <View style={styles.profileRow}>
            <Avatar uri={store?.logoUrl} size={48} icon="storefront-outline" />
            <View style={styles.flex}>
              <Text style={styles.profileMeta}>
                {scopedProducts.length} {scopedProducts.length === 1 ? 'item' : 'items'}
                {storeSells.length > 0 ? ` · ${storeSells.join(' & ')}` : ''}
              </Text>
              {store?.createdAt ? (
                <Text style={styles.profileMeta}>
                  On PlainCo since {store.createdAt.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
                </Text>
              ) : null}
            </View>
          </View>
          {store?.description ? <Text style={styles.profileDescription}>{store.description}</Text> : null}
          {/* Nothing renders until the rating has loaded, so a slow read
              never flashes "No reviews yet" at a store that has some. */}
          {storeRating ? (
            <View style={styles.rating}>
              {storeRating.count > 0 ? (
                <>
                  <View style={styles.ratingRow}>
                    <StarRating rating={storeRating.average} size={15} label={store?.name || 'this store'} />
                    <Text style={styles.ratingValue}>{formatAverage(storeRating.average)}</Text>
                    <Text style={styles.ratingCount}>({storeReviewCountLabel(storeRating)})</Text>
                  </View>
                  <Text style={styles.ratingMatched}>{matchedDescriptionSentence(storeRating)}</Text>
                </>
              ) : (
                <Text style={styles.ratingCount}>
                  No reviews yet. Buyers can review an item once their order is delivered.
                </Text>
              )}
            </View>
          ) : null}
        </View>
      ) : (
        // Hidden while searching, like the preview: the results are what
        // matter then. Remounting replays the entrance when it comes back.
        !query && (
          <View style={styles.extras}>
            {browsableStores.length > 0 && (
              <>
                <Reveal delay={0}>
                  <Text style={styles.subhead}>Shop by store</Text>
                </Reveal>
                <Reveal delay={60} style={styles.storesBleed}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.storesRow}
                    decelerationRate="fast"
                  >
                    {browsableStores.map((s) => {
                      const rating = ratings[s.id];
                      const rated = rating?.count > 0;
                      // "New store" only when it is: under 30 days on PlainCo
                      // and not yet reviewed. Otherwise just the item count.
                      const isNew = !rated && s.createdAt && Date.now() - s.createdAt.getTime() < NEW_STORE_MS;
                      const count = storeCounts[s.id];
                      const label = [
                        s.name,
                        `${count} ${count === 1 ? 'item' : 'items'}`,
                        rated ? `rated ${formatAverage(rating.average)} out of 5` : isNew ? 'new store' : null,
                      ]
                        .filter(Boolean)
                        .join(', ');
                      return (
                        <AnimatedPressable
                          key={s.id}
                          style={styles.storeCard}
                          onPress={() => navigation.push('Shop', { storeId: s.id })}
                          rippleColor={Colors.light.border}
                          accessibilityRole="button"
                          accessibilityLabel={label}
                        >
                          {s.logoUrl ? (
                            <Image source={{ uri: s.logoUrl }} style={styles.storeLogo} contentFit="cover" transition={150} />
                          ) : (
                            <View style={[styles.storeLogo, styles.storeLogoEmpty]}>
                              <Ionicons name="storefront-outline" size={20} color={Colors.light.tint} />
                            </View>
                          )}
                          <View style={styles.storeCardText}>
                            <Text style={styles.storeCardName} numberOfLines={1}>
                              {s.name}
                            </Text>
                            <View style={styles.storeCardMetaRow}>
                              <Text style={styles.storeCardMeta}>
                                {count} {count === 1 ? 'item' : 'items'}
                                {rated || isNew ? ' · ' : ''}
                                {isNew ? 'New store' : ''}
                              </Text>
                              {rated ? (
                                <>
                                  <Ionicons name="star" size={12} color={Colors.light.tint} />
                                  <Text style={styles.storeCardMeta}>
                                    <Text style={styles.storeCardRating}>{formatAverage(rating.average)}</Text> ({rating.count})
                                  </Text>
                                </>
                              ) : null}
                            </View>
                          </View>
                          <Ionicons name="chevron-forward" size={16} color="#B3AAA0" style={styles.storeChevron} />
                        </AnimatedPressable>
                      );
                    })}
                  </ScrollView>
                </Reveal>
              </>
            )}
            {/* Location and Help are about the shopper, not a store, so only
                the main Shop carries them. */}
            <Reveal delay={120} style={styles.menuRow}>
              {menuItems.map((item) => (
                <AnimatedPressable
                  key={item.label}
                  style={styles.menuButton}
                  onPress={() => navigation.navigate(item.label)}
                  rippleColor={Colors.light.border}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                >
                  <Ionicons name={item.icon} size={17} color={Colors.light.text} />
                  <Text style={styles.menuButtonLabel}>{item.label}</Text>
                </AnimatedPressable>
              ))}
            </Reveal>
          </View>
        )
      )}
    </>
  );

  const emptyTitle = query
    ? 'No products found'
    : activeFilter === 'all'
    ? storeId
      ? 'This store has no items yet'
      : 'No products available'
    : 'No products in this category yet';
  const emptyMessage = query
    ? `Nothing matches "${searchQuery.trim()}"${activeFilter !== 'all' ? ` in ${FILTER_LABEL[activeFilter]}` : ''}. Try a different keyword or category.`
    : null;

  return (
    <SafeAreaView style={styles.container} edges={storeId ? ['top', 'bottom'] : ['top']}>
      {/* The header stays put while the grid scrolls under it; a soft
          shadow shows once there is something underneath. */}
      <View style={[styles.header, scrolled && styles.headerStuck]}>
        {storeId ? (
          <View style={styles.storeHead}>
            <Pressable
              onPress={() => navigation.goBack()}
              style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={24} color={Colors.light.text} />
            </Pressable>
            <Text style={styles.storeTitle} numberOfLines={1}>
              {store?.name || 'Store'}
            </Text>
            <Pressable
              onPress={() => navigation.navigate('Cart')}
              style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={cartCount > 0 ? `View cart, ${cartCount} items` : 'View cart'}
            >
              <Ionicons name="cart-outline" size={23} color={Colors.light.text} />
              {cartCount > 0 && (
                <View style={styles.cartBadge}>
                  <Text style={styles.cartBadgeText}>{cartCount > 99 ? '99+' : cartCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={styles.titleRow}>
            <Text style={styles.title} accessibilityRole="header">
              Shop
            </Text>
            {!loading && !error ? (
              <Text style={styles.count}>
                {count} {count === 1 ? 'item' : 'items'}
              </Text>
            ) : null}
          </View>
        )}

        <View style={styles.searchWrap}>
          {searchFocused ? <View style={styles.searchHalo} /> : null}
          <View style={[styles.search, searchFocused && styles.searchFocused]}>
            <Ionicons name="search" size={19} color={Colors.light.icon} />
            <TextInput
              ref={searchRef}
              style={styles.searchInput}
              placeholder={storeId ? 'Search this store' : 'Search by name or category'}
              placeholderTextColor="#8E857B"
              value={searchQuery}
              onChangeText={setSearchQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              returnKeyType="search"
              autoCorrect={false}
              accessibilityLabel={storeId ? 'Search this store' : 'Search products'}
            />
            {searchQuery.length > 0 && (
              <Pressable
                onPress={() => {
                  setSearchQuery('');
                  searchRef.current?.focus();
                }}
                style={styles.clear}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close" size={14} color={Colors.light.text} />
              </Pressable>
            )}
          </View>
        </View>

        {/* A store that sells only one kind has nothing to switch between. */}
        {showFilters ? <FilterTabs active={activeFilter} onSelect={handleSelectFilter} /> : null}
      </View>

      {loading ? (
        <GridSkeleton />
      ) : error ? (
        <Animated.View style={styles.errorState} entering={reduceMotion ? undefined : FadeIn.duration(220)}>
          <EmptyState icon="cloud-offline-outline" title="Couldn't load products" subtitle="Check your connection and try again." />
          <Button variant="secondary" label="Retry" onPress={retryFetchProducts} />
        </Animated.View>
      ) : (
        <FlatList
          data={filteredProducts}
          renderItem={renderProduct}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScroll={(e) => {
            const past = e.nativeEvent.contentOffset.y > 4;
            if (past !== scrolled) setScrolled(past);
          }}
          scrollEventThrottle={32}
          ListHeaderComponent={renderListHeader()}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.light.tint}
              colors={[Colors.light.tint]}
            />
          }
          ListEmptyComponent={
            <NoResults
              title={emptyTitle}
              message={emptyMessage}
              onClear={query || activeFilter !== 'all' ? clearAll : null}
            />
          }
        />
      )}

      {storeId ? null : <TabBar navigation={navigation} current="Shop" />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  flex: { flex: 1 },

  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: Colors.light.background,
    zIndex: 5,
  },
  headerStuck: {
    shadowColor: Colors.light.text,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  title: { fontSize: 26, fontWeight: '600', letterSpacing: -0.5, color: Colors.light.text },
  count: { fontSize: 12.5, color: Colors.light.icon },
  storeHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, marginHorizontal: -8 },
  storeTitle: { flex: 1, fontSize: 20, fontWeight: '600', letterSpacing: -0.3, color: Colors.light.text, marginHorizontal: 4 },
  iconButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  iconButtonPressed: { backgroundColor: 'rgba(28,27,26,0.06)' },
  cartBadge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: Colors.light.tint,
    borderWidth: 2,
    borderColor: Colors.light.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadgeText: { fontSize: 9.5, fontWeight: '600', color: '#fff' },

  searchWrap: { position: 'relative' },
  // The Clay focus halo, drawn as a tinted shape since there's no spread shadow.
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
  searchFocused: { borderColor: Colors.light.tint },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    fontSize: 14.5,
    color: Colors.light.text,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  clear: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(28,27,26,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  tabs: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 12,
    padding: 4,
    backgroundColor: '#EFE9E0',
    borderRadius: 14,
  },
  tabIndicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 0,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    shadowColor: Colors.light.text,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 1,
  },
  tab: { flexGrow: 1, height: 38, paddingHorizontal: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 13, fontWeight: '500', color: Colors.light.icon },
  tabTextOn: { fontWeight: '600', color: Colors.light.text },

  grid: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 24 },
  row: { gap: 12 },
  // Half the row each, so a last card with no neighbour doesn't stretch.
  cell: { flex: 1, maxWidth: '50%', marginBottom: 18 },

  profile: { paddingBottom: 14 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  profileMeta: { fontSize: 12.5, color: Colors.light.icon, marginTop: 2 },
  profileDescription: { fontSize: 13, color: Colors.light.text, marginTop: 10, lineHeight: 19 },
  rating: { paddingTop: 10, gap: 4 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ratingValue: { fontSize: 14, fontWeight: '700', color: Colors.light.text },
  ratingCount: { fontSize: 13, color: Colors.light.icon, lineHeight: 19 },
  ratingMatched: { fontSize: 13, color: Colors.light.text, lineHeight: 19 },

  extras: { paddingTop: 4, paddingBottom: 18 },
  subhead: { fontSize: 13, fontWeight: '600', color: Colors.light.icon, marginBottom: 10 },
  // The row runs to the screen edges; its padding lines the first card up
  // with the grid.
  storesBleed: { marginHorizontal: -20 },
  storesRow: { gap: 10, paddingHorizontal: 20, paddingBottom: 2 },
  storeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#EDE5DA',
    backgroundColor: '#FFFFFF',
    maxWidth: 280,
  },
  storeLogo: { width: 44, height: 44, borderRadius: 13 },
  storeLogoEmpty: { backgroundColor: '#F3E3DA', alignItems: 'center', justifyContent: 'center' },
  storeCardText: { flexShrink: 1 },
  storeCardName: { fontSize: 14, fontWeight: '600', letterSpacing: -0.1, color: Colors.light.text },
  storeCardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  storeCardMeta: { fontSize: 12, color: Colors.light.icon },
  storeCardRating: { fontWeight: '600', color: Colors.light.text },
  storeChevron: { marginLeft: 4 },
  menuRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  menuButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 40,
    paddingLeft: 12,
    paddingRight: 15,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#EDE5DA',
    backgroundColor: '#FFFFFF',
  },
  menuButtonLabel: { fontSize: 13, fontWeight: '500', color: Colors.light.text },

  empty: { alignItems: 'center', paddingTop: 36, paddingHorizontal: 16 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: '#F3E3DA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: Colors.light.text, textAlign: 'center' },
  emptyText: { fontSize: 13, lineHeight: 19.5, color: Colors.light.icon, textAlign: 'center', marginTop: 6 },
  emptyButton: {
    marginTop: 16,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
  },
  emptyButtonText: { fontSize: 13, fontWeight: '600', color: Colors.light.text },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, gap: 12 },

  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, paddingTop: 6, columnGap: 12 },
  skeletonCell: { width: '47%', flexGrow: 1, marginBottom: 18 },
  skeletonPhoto: { aspectRatio: 4 / 5, borderRadius: 18 },
  skeletonLine: { height: 12, borderRadius: 6, marginTop: 10, width: '80%' },
  skeletonLineShort: { marginTop: 6, width: '40%' },
});
