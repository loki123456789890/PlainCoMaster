import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  FlatList,
  Platform,
  TextInput,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { showAppAlert } from '../utils/appAlert';
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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { auth } from '../firebaseConfig';
import { useProducts } from '../context/ProductContext';
import { useStores, useStoreRatings, storeReviewCountLabel } from '../context/StoreContext';
import { formatAverage, matchedDescriptionSentence } from '../utils/reviews';
import { useCart } from '../context/CartContext';
import { useFavorites } from '../context/FavoritesContext';
import { Colors, Spacing, Radius, Shadow } from '../constants/theme';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import StarRating from '../components/ui/StarRating';
import Avatar from '../components/ui/Avatar';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import SkeletonBlock from '../components/ui/Skeleton';
import ProductImage from '../components/ui/ProductImage';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

const menuItems = [
  { icon: 'location-outline', label: 'Location', color: Colors.light.tint },
  { icon: 'help-circle-outline', label: 'Help', color: Colors.light.secondary },
];

const filterTabs = [
  { key: 'all', label: 'All' },
  { key: 'ready-to-wear', label: 'Ready-to-Wear' },
  { key: 'ukay-ukay', label: 'Ukay-Ukay' },
];

// Heart toggle with a settle-pulse on tap — same three-keyframe treatment as
// Homescreen.js's FavoriteButton, so favoriting reads identically whether
// it happens from Home's Featured Picks or from the full catalog here.
function FavoriteButton({ favorited, onToggle, accessibilityLabel }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = () => {
    if (!reduceMotion) {
      scale.value = withTiming(0.85, { duration: 80, easing: EASE_OUT_QUINT }, () => {
        scale.value = withTiming(1.15, { duration: 120, easing: EASE_OUT_QUART }, () => {
          scale.value = withTiming(1, { duration: 120, easing: EASE_OUT_QUART });
        });
      });
    }
    onToggle();
  };

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: favorited }}
      android_ripple={{ color: 'rgba(255,255,255,0.4)', radius: 18 }}
    >
      <Animated.View style={[styles.favoriteBtn, animatedStyle]}>
        <Ionicons
          name={favorited ? 'heart' : 'heart-outline'}
          size={16}
          color={favorited ? Colors.light.danger : '#fff'}
        />
      </Animated.View>
    </Pressable>
  );
}

// Loading placeholder shaped like the real 2-column grid, so there's no
// layout shift once live products swap in.
function ProductGridSkeleton() {
  return (
    <View style={styles.skeletonGrid}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.skeletonCardWrap}>
          <SkeletonBlock style={styles.productImage} />
          <SkeletonBlock style={styles.skeletonLine} />
          <SkeletonBlock style={[styles.skeletonLine, styles.skeletonLineShort]} />
        </View>
      ))}
    </View>
  );
}

// One catalog card: image, favorite heart, type badge, name, price. A
// top-level component (not defined inside ShopScreen) so React keeps a
// stable identity for each card across re-renders — otherwise every
// keystroke in search or filter tap would remount the whole grid, losing
// each card's imageFailed state and re-triggering entrance animations.
//
// `storeName` is passed only in the all-stores view. On a store's own page
// every card would repeat the name in the header, so it is left off there.
function ProductCard({ item, index, favorited, storeName, onPress, onToggleFavorite }) {
  const reduceMotion = useReducedMotion();
  const [imageFailed, setImageFailed] = useState(false);
  const isUkay = item.type === 'ukay-ukay';
  const typeColor = isUkay ? Colors.light.secondary : Colors.light.tint;
  const typeLabel = isUkay ? 'Ukay-Ukay' : 'Ready to Wear';

  return (
    <Animated.View
      style={styles.productCardWrap}
      entering={reduceMotion ? undefined : FadeInDown.delay(Math.min(index, 8) * 40).duration(220).easing(EASE_OUT_QUART)}
    >
      <AnimatedPressable
        onPress={onPress}
        rippleColor={Colors.light.border}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ₱${item.price}`}
      >
        <Card style={styles.productCard}>
          <View style={styles.productImage}>
            {imageFailed ? (
              <View style={styles.imageFallback}>
                <Ionicons name="image-outline" size={28} color={Colors.light.icon} />
              </View>
            ) : (
              <ProductImage
                uri={item.imageUrl}
                style={styles.image}
                onError={() => setImageFailed(true)}
                accessibilityLabel={`Photo of ${item.name}`}
              />
            )}
            <View style={styles.productTypeBadge}>
              {isUkay ? (
                <MaterialCommunityIcons name="recycle" size={12} color={typeColor} />
              ) : (
                <Ionicons name="shirt-outline" size={12} color={typeColor} />
              )}
              <Badge label={typeLabel} color={typeColor} />
            </View>
            <FavoriteButton
              favorited={favorited}
              onToggle={onToggleFavorite}
              accessibilityLabel={
                favorited ? `Remove ${item.name} from favorites` : `Add ${item.name} to favorites`
              }
            />
          </View>
          <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
          {storeName ? (
            <Text style={styles.productStore} numberOfLines={1}>{storeName}</Text>
          ) : null}
          <Text style={styles.productPrice}>₱{item.price}</Text>
        </Card>
      </AnimatedPressable>
    </Animated.View>
  );
}

export default function ShopScreen({ navigation, route }) {
  const { products, loading, error, retryFetchProducts } = useProducts();
  const { cartCount } = useCart();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { stores, getStore } = useStores();
  // One screen, two views. Without a storeId this is the whole shop; with
  // one it is that store's page, pushed on top from the "Shop by store"
  // row or a product's "Sold by" line. Same grid, search and filters
  // either way, so a store page is the Shop narrowed rather than a second
  // catalogue to keep in step.
  const storeId = route.params?.storeId || null;
  const store = getStore(storeId);
  const [activeFilter, setActiveFilter] = useState(route.params?.filterType || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const reduceMotion = useReducedMotion();

  // If Home navigates here again with a different filterType while this screen
  // is already mounted (rather than freshly pushed), keep activeFilter synced.
  useEffect(() => {
    if (route.params?.filterType) {
      setActiveFilter(route.params.filterType);
    }
  }, [route.params?.filterType]);

  // ProductContext's onSnapshot already keeps `products` live, so pulling to
  // refresh isn't fixing stale data — it's resyncing after a failed initial
  // fetch and giving the "did I just check for new items" gesture users
  // expect from a catalog screen. Clears once the next products/loading
  // update lands.
  // Keyed on the results too, not just `loading`.
  //
  // Keyed on [loading] alone this could never clear for a signed-out
  // viewer: retryFetchProducts() bumps ProductContext's retry token, but
  // its no-user path calls setLoading(false) when loading is ALREADY
  // false. React bails out of a state update to the same value, so no
  // re-render happens, this effect never re-runs, and the spinner turns
  // forever. Shop is browsable while signed out, so that path is reachable.
  //
  // `products` and `error` are the values a resubscribe actually replaces
  // (ProductContext assigns a fresh array on every settle, including the
  // empty one), so watching them catches the settle that `loading` alone
  // misses.
  useEffect(() => {
    if (!loading) setRefreshing(false);
  }, [loading, products, error]);

  const handleRefresh = () => {
    setRefreshing(true);
    retryFetchProducts?.();
  };

  // Guests can browse the catalog, but favoriting needs an account — same
  // guard pattern as Homescreen.js/Productscreen.js's heart icon.
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

  // Category tab and search compose together (AND), not either/or — typing
  // a search term never resets or bypasses whichever tab is currently
  // selected. Filters over the already-fetched in-memory `products` list
  // from ProductContext, same as AdminUsersScreen filters its own
  // already-fetched `users` array — no new Firestore query.
  const scopedProducts = useMemo(
    () => (storeId ? products.filter((p) => p.storeId === storeId) : products),
    [products, storeId]
  );

  // Items per store, for the "Shop by store" row. A store with nothing
  // listed is left out of the row: a card that leads to an empty page is
  // a dead end, and the store will appear once it lists something.
  const storeCounts = useMemo(() => {
    const counts = {};
    products.forEach((p) => {
      if (p.storeId) counts[p.storeId] = (counts[p.storeId] || 0) + 1;
    });
    return counts;
  }, [products]);
  const browsableStores = stores.filter((s) => storeCounts[s.id] > 0);

  // Seller ratings, side by side in the store row and in full on a store's
  // page. Comparing stores is what makes a seller rating mean anything —
  // with one store it was one number with nothing beside it.
  const ratings = useStoreRatings(storeId ? [storeId] : browsableStores.map((s) => s.id));
  const storeRating = storeId ? ratings[storeId] : undefined;

  // What the store actually sells, read off its listings rather than
  // declared anywhere, so it cannot claim a category it has no items in.
  const storeSells = [
    scopedProducts.some((p) => p.type === 'ukay-ukay') && 'Ukay-Ukay',
    scopedProducts.some((p) => p.type === 'ready-to-wear') && 'Ready-to-Wear',
  ].filter(Boolean);

  const query = searchQuery.trim().toLowerCase();
  const filteredProducts = scopedProducts
    .filter((p) => activeFilter === 'all' || p.type === activeFilter)
    .filter((p) => {
      if (!query) return true;
      return (
        p.name?.toLowerCase().includes(query) ||
        p.type?.toLowerCase().includes(query)
      );
    });

  const headerTitle = storeId ? store?.name || 'Store' : 'Shop';

  const renderCartIcon = () => (
    <View style={styles.cartIconWrapper}>
      <Ionicons name="cart-outline" size={24} color={Colors.light.text} />
      {cartCount > 0 && (
        <View style={styles.cartBadge}>
          <Text style={styles.cartBadgeText}>{cartCount > 99 ? '99+' : cartCount}</Text>
        </View>
      )}
    </View>
  );

  const renderProduct = ({ item, index }) => (
    <ProductCard
      item={item}
      index={index}
      favorited={isFavorite(item.id)}
      storeName={storeId ? null : getStore(item.storeId)?.name}
      onPress={() => navigation.navigate('Product', { product: item })}
      onToggleFavorite={() => handleToggleFavorite(item)}
    />
  );

  const renderListHeader = () => (
    <>
      {/* Store identity — real catalog info (name, item count, scope), not
          fabricated ratings/reviews. Trust here comes from consistency and
          honesty, matching DESIGN.md's "Trust reads through consistency,
          not badges" principle, not from Shopee-style seller theater. On a
          store's page it is that store's profile: what it sells, counted
          from its own listings, and how long it has been on PlainCo. */}
      <View style={styles.storeStrip}>
        {storeId ? (
          // The store's own logo, set on its Store Profile.
          <Avatar uri={store?.logoUrl} size={48} icon="storefront-outline" />
        ) : (
          <View style={styles.storeIconWrap}>
            <Ionicons name="storefront-outline" size={18} color={Colors.light.tint} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.storeName}>{storeId ? store?.name || 'Store' : 'PlainCo'}</Text>
          <Text style={styles.storeMeta}>
            {scopedProducts.length} {scopedProducts.length === 1 ? 'item' : 'items'}
            {storeId
              ? storeSells.length > 0 ? ` · ${storeSells.join(' & ')}` : ''
              : ` from ${browsableStores.length} ${browsableStores.length === 1 ? 'store' : 'stores'} · Ukay-Ukay & Ready-to-Wear`}
          </Text>
          {storeId && store?.createdAt ? (
            <Text style={styles.storeMeta}>
              On PlainCo since {store.createdAt.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })}
            </Text>
          ) : null}
          {storeId && store?.description ? (
            <Text style={styles.storeDescription}>{store.description}</Text>
          ) : null}
        </View>
      </View>

      {/* The seller rating, from this store's own verified-purchase
          reviews. Nothing renders until it has loaded, so a slow read
          never flashes "No reviews yet" at a store that has some. The
          matched-description line is the one that speaks to secondhand
          condition, which is what PRODUCT.md says shoppers must trust. */}
      {storeId && storeRating ? (
        <View style={styles.storeRating}>
          {storeRating.count > 0 ? (
            <>
              <View style={styles.storeRatingRow}>
                <StarRating rating={storeRating.average} size={15} label={store?.name || 'this store'} />
                <Text style={styles.storeRatingValue}>{formatAverage(storeRating.average)}</Text>
                <Text style={styles.storeRatingCount}>({storeReviewCountLabel(storeRating)})</Text>
              </View>
              <Text style={styles.storeRatingMatched}>{matchedDescriptionSentence(storeRating)}</Text>
            </>
          ) : (
            <Text style={styles.storeRatingCount}>
              No reviews yet. Buyers can review an item once their order is delivered.
            </Text>
          )}
        </View>
      ) : null}

      {!storeId && browsableStores.length > 0 && (
        <>
          <Text style={styles.storesTitle}>Shop by store</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.storesRow}
          >
            {browsableStores.map((s) => (
              <AnimatedPressable
                key={s.id}
                style={styles.storeCard}
                onPress={() => navigation.push('Shop', { storeId: s.id })}
                rippleColor={Colors.light.border}
                accessibilityRole="button"
                accessibilityLabel={`${s.name}, ${storeCounts[s.id]} ${storeCounts[s.id] === 1 ? 'item' : 'items'}${
                  ratings[s.id]?.count > 0 ? `, rated ${formatAverage(ratings[s.id].average)} out of 5` : ''
                }`}
              >
                <Avatar uri={s.logoUrl} size={28} icon="storefront-outline" />
                <View style={styles.storeCardText}>
                  <Text style={styles.storeCardName} numberOfLines={1}>{s.name}</Text>
                  <View style={styles.storeCardMetaRow}>
                    <Text style={styles.storeCardMeta}>
                      {storeCounts[s.id]} {storeCounts[s.id] === 1 ? 'item' : 'items'}
                    </Text>
                    {ratings[s.id]?.count > 0 && (
                      <>
                        <Text style={styles.storeCardMeta}>·</Text>
                        <Ionicons name="star" size={11} color={Colors.light.highlight} />
                        <Text style={styles.storeCardRating}>
                          {formatAverage(ratings[s.id].average)} ({ratings[s.id].count})
                        </Text>
                      </>
                    )}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={14} color={Colors.light.icon} />
              </AnimatedPressable>
            ))}
          </ScrollView>
        </>
      )}

      {/* Location and Help are about the shopper's account, not a store,
          so a store's page leaves them to the Shop it was opened from. */}
      {!storeId && (
        <View style={styles.menuRow}>
          {menuItems.map((item, index) => (
            <AnimatedPressable
              key={index}
              style={styles.menuButton}
              onPress={() => navigation.navigate(item.label)}
              rippleColor={Colors.light.border}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <Ionicons name={item.icon} size={16} color={item.color} />
              <Text style={styles.menuButtonLabel}>{item.label}</Text>
            </AnimatedPressable>
          ))}
        </View>
      )}

      <View style={[styles.searchContainer, storeId && styles.searchContainerStore]}>
        <Ionicons name="search-outline" size={20} color={Colors.light.icon} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder={storeId ? 'Search this store...' : 'Search products...'}
          placeholderTextColor={Colors.light.icon}
          value={searchQuery}
          onChangeText={setSearchQuery}
          accessibilityLabel={storeId ? 'Search this store' : 'Search products'}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearchQuery('')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={20} color={Colors.light.icon} />
          </TouchableOpacity>
        )}
      </View>

      {/* A store that sells only one kind has nothing to filter between:
          the other tab could only ever come up empty. */}
      {(!storeId || storeSells.length > 1) && (
        <View style={styles.filterRow}>
          {filterTabs.map((tab) => {
            const isActive = activeFilter === tab.key;
            return (
              <AnimatedPressable
                key={tab.key}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                onPress={() => handleSelectFilter(tab.key)}
                rippleColor={isActive ? 'rgba(255,255,255,0.3)' : Colors.light.border}
                accessibilityRole="button"
                accessibilityLabel={`Filter by ${tab.label}`}
                accessibilityState={{ selected: isActive }}
              >
                <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                  {tab.label}
                </Text>
              </AnimatedPressable>
            );
          })}
        </View>
      )}
    </>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{headerTitle}</Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('Cart')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={cartCount > 0 ? `View cart, ${cartCount} items` : 'View cart'}
          >
            {renderCartIcon()}
          </TouchableOpacity>
        </View>
        <ProductGridSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{headerTitle}</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('Cart')}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={cartCount > 0 ? `View cart, ${cartCount} items` : 'View cart'}
        >
          {renderCartIcon()}
        </TouchableOpacity>
      </View>

      {error ? (
        <Animated.View
          style={styles.errorState}
          entering={reduceMotion ? undefined : FadeIn.duration(220)}
        >
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load products"
            subtitle="Check your connection and try again."
          />
          <Button variant="secondary" label="Retry" onPress={retryFetchProducts} />
        </Animated.View>
      ) : (
        <FlatList
          data={filteredProducts}
          renderItem={renderProduct}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.productsGrid}
          showsVerticalScrollIndicator={false}
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
            <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(220)}>
              <EmptyState
                icon={query ? 'search-outline' : 'cube-outline'}
                title={
                  query
                    ? 'No products found'
                    : activeFilter === 'all'
                    ? storeId ? 'This store has no items yet' : 'No products available'
                    : 'No products in this category yet'
                }
                subtitle={query ? 'Try a different search term' : undefined}
              />
            </Animated.View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: Colors.light.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text },
  cartIconWrapper: { position: 'relative' },
  cartBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    backgroundColor: Colors.light.danger,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cartBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 12,
  },

  storeStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  storeIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.light.tint + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  storeName: { fontSize: 15, fontWeight: '700', color: Colors.light.text },
  storeMeta: { fontSize: 12, color: Colors.light.icon, marginTop: 2 },
  storeDescription: { fontSize: 13, color: Colors.light.text, marginTop: 6, lineHeight: 19 },

  storesTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.icon,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  storesRow: { paddingHorizontal: 20, gap: 10 },
  storeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
    maxWidth: 220,
  },
  storeCardText: { flexShrink: 1 },
  storeCardName: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  storeCardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  storeCardMeta: { fontSize: 12, color: Colors.light.icon },
  storeCardRating: { fontSize: 12, fontWeight: '600', color: Colors.light.text },

  storeRating: { paddingHorizontal: 20, paddingTop: 10, gap: 4 },
  storeRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  storeRatingValue: { fontSize: 14, fontWeight: '700', color: Colors.light.text },
  storeRatingCount: { fontSize: 13, color: Colors.light.icon, lineHeight: 19 },
  storeRatingMatched: { fontSize: 13, color: Colors.light.text, lineHeight: 19 },

  menuRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 10,
  },
  menuButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.border,
  },
  menuButtonLabel: { fontSize: 13, fontWeight: '600', color: Colors.light.text },
  // Same search bar pattern as AdminUsersScreen.js.
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  // Without the Location/Help row above it, the search bar needs its own
  // breathing room under the store profile.
  searchContainerStore: { marginTop: 16 },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: Colors.light.text,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: 4,
    marginBottom: 8,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.border + '80',
  },
  filterChipActive: {
    backgroundColor: Colors.light.tint,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.light.icon,
  },
  filterChipTextActive: {
    color: '#fff',
  },
  productsGrid: { paddingHorizontal: 10, paddingBottom: 20 },
  // Half the row, with the gutter as padding rather than margin, so a card
  // with no neighbour (the last of an odd count, common on a small store's
  // page) is exactly as wide as a card beside another, instead of
  // stretching across both columns.
  productCardWrap: {
    flex: 1,
    maxWidth: '50%',
    padding: 8,
  },
  productCard: {
    padding: 12,
  },
  productImage: { width: '100%', height: 160, backgroundColor: Colors.light.border, borderRadius: 8, marginBottom: 12, overflow: 'hidden', position: 'relative' },
  image: { width: '100%', height: '100%' },
  imageFallback: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.light.border },
  productTypeBadge: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  favoriteBtn: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 14,
    padding: 6,
  },
  productName: { fontSize: 14, fontWeight: '600', color: Colors.light.text, marginBottom: 4, lineHeight: 18, height: 36 },
  productStore: { fontSize: 12, color: Colors.light.icon, marginBottom: 4 },
  productPrice: { fontSize: 16, fontWeight: '700', color: Colors.light.highlight },

  // Loading skeleton — shaped like the real 2-column grid.
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 10,
    paddingTop: 16,
  },
  skeletonCardWrap: {
    width: '50%',
    padding: 8,
  },
  skeletonLine: { height: 14, borderRadius: 4, marginTop: 8 },
  skeletonLineShort: { width: '50%' },
});
