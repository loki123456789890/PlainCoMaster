import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  FlatList,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  useReducedMotion,
  FadeIn,
  FadeInDown,
  FadeOutLeft,
  LinearTransition,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFavorites } from '../context/FavoritesContext';
import { auth } from '../firebaseConfig';
import { Colors, Radius, Shadow } from '../constants/theme';
import EmptyState from '../components/ui/EmptyState';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import SkeletonBlock from '../components/ui/Skeleton';
import ProductImage from '../components/ui/ProductImage';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

const quickLinks = [
  { icon: 'list-outline', label: 'My Orders', route: 'Orders' },
  { icon: 'settings-outline', label: 'Settings', route: 'Profile' },
];

// Handles price as "₱450.00", "450", or a plain number 450 — same helper
// used in ProductScreen/CartScreen/CheckoutScreen, kept consistent here
// so a formatted-string price can't silently render as "₱NaN".
const parsePrice = (price) => {
  if (typeof price === 'number') return price;
  if (typeof price === 'string') {
    const cleaned = price.replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
  }
  return 0;
};

// Heart toggle with a settle-pulse on tap — same three-keyframe treatment as
// Homescreen.js/Shopscreen.js's FavoriteButton, so unfavoriting here reads
// identically to favoriting from the catalog. Every card on this screen is
// already favorited, so tapping always plays the "un-filling" direction.
function FavoriteButton({ onToggle, accessibilityLabel }) {
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
      accessibilityState={{ selected: true }}
      android_ripple={{ color: 'rgba(255,255,255,0.4)', radius: 18 }}
    >
      <Animated.View style={[styles.favoriteBtn, animatedStyle]}>
        <Ionicons name="heart" size={16} color={Colors.light.danger} />
      </Animated.View>
    </Pressable>
  );
}

// Loading placeholder shaped like the real header + quick links + 2-column
// grid, so there's no layout shift once live favorites swap in — unlike a
// bare spinner, which drops the quick-links row and grid metadata that
// appear the moment loading finishes.
function FavoritesSkeleton() {
  return (
    <>
      <View style={styles.quickLinksRow}>
        {quickLinks.map((link) => (
          <View key={link.route} style={styles.quickLinkSkeleton} />
        ))}
      </View>
      <View style={styles.skeletonGrid}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.skeletonCardWrap}>
            <SkeletonBlock style={styles.productImage} />
            <SkeletonBlock style={styles.skeletonLine} />
            <SkeletonBlock style={[styles.skeletonLine, styles.skeletonLineShort]} />
          </View>
        ))}
      </View>
    </>
  );
}

// One favorite card: image, type badge, unfavorite heart, name, price. A
// top-level component (not defined inside FavoritesScreen) so React keeps a
// stable identity for each card across re-renders, same reasoning as
// Shopscreen.js's ProductCard.
function FavoriteCard({ item, index, onPress, onRemove }) {
  const reduceMotion = useReducedMotion();
  const [imageFailed, setImageFailed] = useState(false);
  const isUkay = item.type === 'ukay-ukay';
  const typeColor = isUkay ? Colors.light.secondary : Colors.light.tint;
  const typeLabel = isUkay ? 'Ukay-Ukay' : 'Ready to Wear';
  const imageSource = item.imageUrl || item.image;

  return (
    <Animated.View
      style={styles.productCardWrap}
      entering={reduceMotion ? undefined : FadeInDown.delay(Math.min(index, 8) * 40).duration(220).easing(EASE_OUT_QUART)}
      exiting={reduceMotion ? undefined : FadeOutLeft.duration(200).easing(EASE_OUT_QUINT)}
      layout={reduceMotion ? undefined : LinearTransition.duration(220).easing(EASE_OUT_QUART)}
    >
      <AnimatedPressable
        onPress={onPress}
        rippleColor={Colors.light.border}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ₱${parsePrice(item.price).toFixed(2)}`}
      >
        <Card variant="flat" style={styles.productCard}>
          <View style={styles.productImage}>
            {imageFailed || !imageSource ? (
              <View style={styles.imageFallback}>
                <Ionicons name="image-outline" size={28} color={Colors.light.icon} />
              </View>
            ) : (
              <ProductImage
                uri={imageSource}
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
              onToggle={onRemove}
              accessibilityLabel={`Remove ${item.name} from favorites`}
            />
          </View>
          <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
          <Text style={styles.productPrice}>₱{parsePrice(item.price).toFixed(2)}</Text>
        </Card>
      </AnimatedPressable>
    </Animated.View>
  );
}

export default function FavoritesScreen({ navigation }) {
  const { favorites, loading, error, toggleFavorite, retryFetchFavorites } = useFavorites();
  const reduceMotion = useReducedMotion();

  // Most-recently-removed item, kept just long enough to offer an Undo —
  // same reasoning as Cartscreen.js's undoItem: removing a favorite is
  // reversible for a few seconds, so it doesn't need a blocking confirm.
  const [undoItem, setUndoItem] = useState(null);
  const undoTimerRef = useRef(null);

  useEffect(() => {
    // Favorites is real per-account Firestore data (migrated off
    // AsyncStorage), same category as Cart/Profile/Orders — a guest
    // shouldn't land on a "No favorites yet" screen that implies they
    // have an account with none. Redirect to Login instead.
    if (!auth.currentUser) {
      navigation.replace('Login');
    }
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const handleRemove = async (item) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const result = await toggleFavorite(item);
    if (result?.success) {
      setUndoItem(item);
      undoTimerRef.current = setTimeout(() => setUndoItem(null), 4000);
    }
  };

  const handleUndo = async () => {
    if (!undoItem) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    const item = undoItem;
    setUndoItem(null);
    const result = await toggleFavorite(item);
    if (result?.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const renderProduct = ({ item, index }) => (
    <FavoriteCard
      item={item}
      index={index}
      onPress={() => navigation.navigate('Product', { product: item })}
      onRemove={() => handleRemove(item)}
    />
  );

  const renderListHeader = () => (
    <>
      <View style={styles.quickLinksRow}>
        {quickLinks.map((link) => (
          <AnimatedPressable
            key={link.route}
            style={styles.quickLinkButton}
            onPress={() => navigation.navigate(link.route)}
            rippleColor={Colors.light.border}
            accessibilityRole="button"
            accessibilityLabel={link.label}
          >
            <Ionicons name={link.icon} size={16} color={Colors.light.tint} />
            <Text style={styles.quickLinkLabel}>{link.label}</Text>
          </AnimatedPressable>
        ))}
      </View>
      <Text style={styles.savedMeta}>
        {favorites.length} {favorites.length === 1 ? 'item' : 'items'} saved
      </Text>
    </>
  );

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
        <Text style={styles.headerTitle}>My Favorites</Text>
        <View style={styles.backButton} />
      </View>

      {loading ? (
        <FavoritesSkeleton />
      ) : error ? (
        <Animated.View
          style={styles.centerContainer}
          entering={reduceMotion ? undefined : FadeIn.duration(220)}
        >
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load favorites"
            subtitle="Check your connection and try again."
          />
          <View style={styles.emptyActionWrap}>
            <Button variant="secondary" label="Retry" onPress={retryFetchFavorites} />
          </View>
        </Animated.View>
      ) : (
        // Empty and populated states both stay inside the same FlatList (via
        // ListEmptyComponent rather than a full-screen swap) so the quick
        // links to Orders/Settings stay reachable even with zero favorites —
        // same structure Shopscreen.js uses for its own empty catalog case.
        <FlatList
          data={favorites}
          keyExtractor={(item) => item.id}
          renderItem={renderProduct}
          numColumns={2}
          contentContainerStyle={styles.productsGrid}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={renderListHeader()}
          ListEmptyComponent={
            <Animated.View style={styles.emptyState} entering={reduceMotion ? undefined : FadeIn.duration(220)}>
              <EmptyState
                icon="heart-outline"
                title="No favorites yet"
                subtitle="Tap the heart on any item to save it here for later."
              />
              <View style={styles.emptyActionWrap}>
                <Button variant="primary" label="Start Shopping" onPress={() => navigation.navigate('Shop')} />
              </View>
            </Animated.View>
          }
        />
      )}

      {undoItem && (
        <Animated.View
          style={styles.undoToast}
          entering={reduceMotion ? undefined : FadeIn.duration(180)}
          exiting={reduceMotion ? undefined : FadeOutLeft.duration(150)}
        >
          <Text style={styles.undoText} numberOfLines={1}>
            Removed {undoItem.name}
          </Text>
          <TouchableOpacity
            onPress={handleUndo}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`Undo removing ${undoItem.name} from favorites`}
          >
            <Text style={styles.undoAction}>Undo</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.light.text,
  },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyState: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 40 },
  emptyActionWrap: { marginTop: 20, width: 200, alignSelf: 'center' },

  // Quick links — same chip treatment as Shopscreen.js's menuRow, so this
  // screen's secondary navigation reads as the same pattern, not a
  // one-off bare icon+label row.
  quickLinksRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 10,
  },
  quickLinkButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.border,
  },
  quickLinkSkeleton: {
    flex: 1,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.border,
  },
  quickLinkLabel: { fontSize: 13, fontWeight: '600', color: Colors.light.text },

  savedMeta: {
    fontSize: 12,
    color: Colors.light.icon,
    paddingHorizontal: 20,
    marginTop: 4,
    marginBottom: 8,
  },

  productsGrid: { paddingHorizontal: 10, paddingBottom: 20 },
  productCardWrap: {
    flex: 1,
    margin: 8,
  },
  productCard: {
    padding: 12,
  },
  productImage: {
    width: '100%',
    height: 160,
    backgroundColor: Colors.light.border,
    borderRadius: 8,
    marginBottom: 12,
    overflow: 'hidden',
    position: 'relative',
  },
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
  productPrice: { fontSize: 16, fontWeight: '700', color: Colors.light.highlight },

  // Loading skeleton — shaped like the real 2-column grid.
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  skeletonCardWrap: {
    width: '50%',
    padding: 8,
  },
  skeletonLine: { height: 14, borderRadius: 4, marginTop: 8 },
  skeletonLineShort: { width: '50%' },

  // Undo toast — same treatment as Cartscreen.js's snackbar: borrows
  // Colors.dark's ink/canvas/tint values (not a live theme switch) so a
  // transient overlay reads as "floating above the page", anchored to the
  // bottom of the screen since this screen has no persistent footer.
  undoToast: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: Colors.dark.background,
    borderRadius: Radius.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
    ...Shadow.card,
  },
  undoText: { flex: 1, fontSize: 13, color: Colors.dark.text },
  undoAction: { fontSize: 13, fontWeight: 'bold', color: Colors.dark.tint },
});
