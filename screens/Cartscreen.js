import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Image,
  FlatList,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  useReducedMotion,
  FadeIn,
  FadeOutLeft,
  LinearTransition,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { auth } from '../firebaseConfig';
import { useProducts } from '../context/ProductContext';
import { useCart } from '../context/CartContext';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { COLOR_PALETTE } from '../constants/productOptions';
import { Colors, Spacing, Radius, Shadow } from '../constants/theme';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import SkeletonBlock from '../components/ui/Skeleton';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

// Handles price as "₱450.00", "450", or a plain number 450
const parsePrice = (price) => {
  if (typeof price === 'number') return price;
  if (typeof price === 'string') {
    const cleaned = price.replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
  }
  return 0;
};

// Same defensive parse as Checkoutscreen.js's parseStock — some products
// still have "stock" stored as a string left over from before the admin
// forms started saving it as a number. Returns null (treated as unlimited)
// rather than 0 for anything non-numeric, so legacy data doesn't
// permanently lock a line's quantity stepper at 1.
const parseStock = (stock) => {
  const parsed = parseInt(stock, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

const getColorHex = (colorName) => {
  const found = COLOR_PALETTE.find((c) => c.name === colorName);
  return found ? found.hex : null;
};

// Loading placeholder shaped like a real cart row, so there's no layout
// shift once the live cart data swaps in.
function CartSkeleton() {
  return (
    <View style={styles.listContent}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.skeletonRow}>
          <SkeletonBlock style={styles.itemImage} />
          <View style={styles.itemDetails}>
            <SkeletonBlock style={styles.skeletonLine} />
            <SkeletonBlock style={[styles.skeletonLine, styles.skeletonLineShort]} />
            <SkeletonBlock style={styles.skeletonStepper} />
          </View>
        </View>
      ))}
    </View>
  );
}

// One cart line: image, name/specs, a remove button, and — when the
// product is still available — a quantity stepper and line subtotal.
// Pulled out of the FlatList's renderItem into its own component (rendered
// via JSX, not called as a plain function) so its press-feedback and
// price-pulse animations can use hooks safely, and so Reanimated's
// entering/exiting/layout props have a stable per-row identity to animate.
function CartRow({ item, available, maxQuantity, onRemove, onQuantityChange }) {
  const reduceMotion = useReducedMotion();
  const quantity = item.quantity || 1;
  const unitPrice = parsePrice(item.price);
  const lineTotal = unitPrice * quantity;
  const atMin = quantity <= 1;
  const atMax = maxQuantity !== null && quantity >= maxQuantity;
  const colorHex = getColorHex(item.color);

  // Brief scale pulse whenever this line's subtotal actually changes, so a
  // quantity edit reads as a direct result of the tap rather than a silent
  // number swap.
  const totalScale = useSharedValue(1);
  const totalAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: totalScale.value }] }));
  const previousTotal = useRef(lineTotal);
  useEffect(() => {
    if (previousTotal.current !== lineTotal) {
      if (!reduceMotion) {
        totalScale.value = withSequence(
          withTiming(1.12, { duration: 90, easing: EASE_OUT_QUINT }),
          withTiming(1, { duration: 160, easing: EASE_OUT_QUART })
        );
      }
      previousTotal.current = lineTotal;
    }
  }, [lineTotal]);

  const handleRemovePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onRemove(item);
  };

  const handleDecrease = () => {
    if (atMin) return;
    Haptics.selectionAsync();
    onQuantityChange(item, quantity - 1);
  };

  const handleIncrease = () => {
    if (atMax) return;
    Haptics.selectionAsync();
    onQuantityChange(item, quantity + 1);
  };

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(220).easing(EASE_OUT_QUART)}
      exiting={reduceMotion ? undefined : FadeOutLeft.duration(200).easing(EASE_OUT_QUINT)}
      layout={reduceMotion ? undefined : LinearTransition.duration(220).easing(EASE_OUT_QUART)}
    >
      <Card style={[styles.cartItemRow, !available && styles.cartItemRowUnavailable]}>
        <View style={styles.topRow}>
          <Image
            source={{ uri: item.image }}
            style={[styles.itemImage, !available && styles.itemImageUnavailable]}
          />
          <View style={styles.itemDetails}>
            <Text style={[styles.itemName, !available && styles.itemNameUnavailable]} numberOfLines={2}>
              {item.name}
            </Text>
            <View style={styles.itemSpecsRow}>
              {colorHex && <View style={[styles.colorDot, { backgroundColor: colorHex }]} />}
              <Text style={styles.itemSpecs}>
                Size {item.size} · {item.color}
              </Text>
            </View>
            {!available && (
              <View style={styles.unavailableBadge}>
                <Ionicons name="alert-circle-outline" size={14} color={Colors.light.danger} />
                <Text style={styles.unavailableText}>No longer available</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            onPress={handleRemovePress}
            style={styles.deleteButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name} from cart`}
          >
            <Ionicons name="trash-outline" size={20} color={Colors.light.danger} />
          </TouchableOpacity>
        </View>

        {available && (
          <View style={styles.bottomRow}>
            <View style={styles.stepper}>
              <AnimatedPressable
                style={[styles.stepperButton, atMin && styles.stepperButtonDisabled]}
                onPress={handleDecrease}
                disabled={atMin}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`Decrease quantity for ${item.name}`}
                accessibilityState={{ disabled: atMin }}
              >
                <Ionicons name="remove" size={16} color={atMin ? Colors.light.icon : Colors.light.text} />
              </AnimatedPressable>
              <Text style={styles.stepperValue}>{quantity}</Text>
              <AnimatedPressable
                style={[styles.stepperButton, atMax && styles.stepperButtonDisabled]}
                onPress={handleIncrease}
                disabled={atMax}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel={`Increase quantity for ${item.name}`}
                accessibilityState={{ disabled: atMax }}
              >
                <Ionicons name="add" size={16} color={atMax ? Colors.light.icon : Colors.light.text} />
              </AnimatedPressable>
            </View>
            <View style={styles.priceColumn}>
              <Text style={styles.itemUnitPrice}>₱{unitPrice.toFixed(2)} each</Text>
              <Animated.Text style={[styles.itemLineTotal, totalAnimatedStyle]}>
                ₱{lineTotal.toFixed(2)}
              </Animated.Text>
            </View>
          </View>
        )}
        {available && atMax && maxQuantity > 0 && (
          <Text style={styles.maxStockNote}>Only {maxQuantity} in stock</Text>
        )}
      </Card>
    </Animated.View>
  );
}

export default function CartScreen({ navigation }) {
  const { cartItems, loading: cartLoading, removeFromCart, addToCart, updateQuantity } = useCart();
  // Live products list, used to check whether a cart item's original
  // product still exists and, when it does, to cap the quantity stepper at
  // its current stock — the cart item itself keeps its own saved
  // price/name regardless (see note on handleCheckout below).
  const {
    products,
    loading: productsLoading,
    error: productsError,
    retryFetchProducts,
  } = useProducts();
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  // Most-recently-removed item, kept just long enough to offer an Undo
  // instead of a blocking "Are you sure?" confirmation before every
  // deletion — removing is reversible for a few seconds, so it doesn't
  // need to be gated up front.
  const [undoItem, setUndoItem] = useState(null);
  const undoTimerRef = useRef(null);

  useEffect(() => {
    if (!auth.currentUser) {
      // Cart is a customer-only screen and shouldn't render at all if
      // nobody's signed in. CartContext already resolves loading=false
      // for guests, so this just handles the redirect.
      navigation.replace('Login');
    }
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  // Both listeners gate this screen, not just the cart's. Availability is
  // decided by looking a cart line's productId up in `products`, so until
  // the catalog has actually arrived that lookup answers "no" for
  // everything — which rendered a full cart as every row struck out with
  // "No longer available", a ₱0.00 subtotal, and Checkout disabled, for as
  // long as the products listener took to resolve. The cart's own listener
  // usually resolves first, so this was the normal path, not a race.
  const loading = cartLoading || productsLoading;

  const getProduct = (item) => products.find((p) => p.id === item.productId);
  const isAvailable = (item) => Boolean(getProduct(item));

  const availableCartItems = cartItems.filter(isAvailable);
  const hasUnavailableItems = cartItems.length > availableCartItems.length;

  const subtotal = availableCartItems.reduce((total, item) => {
    return total + parsePrice(item.price) * (item.quantity || 1);
  }, 0);
  const shipping = 0; // Free shipping — mirrors Checkoutscreen.js's summary.
  const total = subtotal + shipping;

  // Gentle pulse on the footer total whenever it actually changes (a
  // quantity edit or a removal), same treatment as each row's own
  // line-subtotal pulse above.
  const totalScale = useSharedValue(1);
  const totalAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: totalScale.value }] }));
  const previousTotalRef = useRef(total);
  useEffect(() => {
    if (previousTotalRef.current !== total) {
      if (!reduceMotion) {
        totalScale.value = withSequence(
          withTiming(1.08, { duration: 100, easing: EASE_OUT_QUINT }),
          withTiming(1, { duration: 180, easing: EASE_OUT_QUART })
        );
      }
      previousTotalRef.current = total;
    }
  }, [total]);

  const handleRemove = async (item) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoItem(item);
    undoTimerRef.current = setTimeout(() => setUndoItem(null), 4000);

    const result = await removeFromCart(item.id);
    if (!result.success) {
      console.error('Error removing item:', result.error);
      setUndoItem(null);
    }
  };

  const handleUndo = async () => {
    if (!undoItem) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    // Re-adds as a new cart line via the normal addToCart path — it'll get
    // a fresh doc id, which is fine, since nothing downstream depends on a
    // restored line reusing its original id.
    const itemData = { ...undoItem };
    delete itemData.id;
    delete itemData.addedAt;
    setUndoItem(null);
    const result = await addToCart(itemData);
    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      console.error('Error restoring item:', result.error);
    }
  };

  const handleQuantityChange = async (item, nextQuantity) => {
    const result = await updateQuantity(item.id, nextQuantity);
    if (!result.success) {
      console.error('Error updating quantity:', result.error);
    }
  };

  const handleCheckout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('Checkout', { orderItems: availableCartItems });
  };

  const renderCartItem = ({ item }) => {
    const product = getProduct(item);
    return (
      <CartRow
        item={item}
        available={Boolean(product)}
        maxQuantity={product ? parseStock(product.stock) : null}
        onRemove={handleRemove}
        onQuantityChange={handleQuantityChange}
      />
    );
  };

  // Delay dropping into the empty-cart view until any pending Undo has
  // resolved — otherwise removing the very last item would yank the Undo
  // toast off-screen along with the footer that hosts it.
  const showEmptyState = !loading && cartItems.length === 0 && !undoItem;

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
        <Text style={styles.headerTitle}>Shopping Cart</Text>
        <View style={{ width: 40 }} />
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            No internet connection — your cart may be outdated.
          </Text>
        </View>
      )}

      {loading ? (
        <CartSkeleton />
      ) : productsError ? (
        // Same reasoning as the loading gate above, for the other way the
        // catalog can be missing: a failed products listener also leaves
        // `products` empty, which would strike out every row as "No longer
        // available" and claim the cart is worthless. We genuinely don't
        // know what's still in stock here, so say that instead of guessing
        // the alarming direction.
        <Animated.View
          style={styles.centerContainer}
          entering={reduceMotion ? undefined : FadeIn.duration(280).easing(EASE_OUT_QUART)}
        >
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't check your cart"
            subtitle="We can't confirm which items are still available right now."
          />
          <View style={styles.shopNowButtonWrap}>
            <Button variant="secondary" label="Retry" onPress={retryFetchProducts} />
          </View>
        </Animated.View>
      ) : showEmptyState ? (
        <Animated.View
          style={styles.centerContainer}
          entering={reduceMotion ? undefined : FadeIn.duration(280).easing(EASE_OUT_QUART)}
        >
          <EmptyState
            icon="cart-outline"
            title="Your cart is empty"
            subtitle="Ukay-ukay finds and ready-to-wear pieces are just a tap away."
          />
          <View style={styles.shopNowButtonWrap}>
            <Button variant="primary" label="Shop Now" onPress={() => navigation.navigate('Shop')} />
          </View>
        </Animated.View>
      ) : (
        <>
          <FlatList
            data={cartItems}
            renderItem={renderCartItem}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
          <View style={styles.footer}>
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
                  accessibilityLabel={`Undo removing ${undoItem.name}`}
                >
                  <Text style={styles.undoAction}>Undo</Text>
                </TouchableOpacity>
              </Animated.View>
            )}
            {hasUnavailableItems && (
              <Text style={styles.unavailableFooterNote}>
                Some items are no longer available and won&apos;t be included in checkout.
              </Text>
            )}
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>₱{subtotal.toFixed(2)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Shipping</Text>
              <Text style={styles.summaryValueMoss}>Free</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Animated.Text
                style={[styles.totalPrice, totalAnimatedStyle]}
                accessibilityLiveRegion="polite"
              >
                ₱{total.toFixed(2)}
              </Animated.Text>
            </View>
            <View style={styles.trustRow}>
              <Ionicons name="shield-checkmark-outline" size={13} color={Colors.light.icon} />
              <Text style={styles.trustText}>Cash on Delivery available — pay when it arrives</Text>
            </View>
            <Button
              variant="primary"
              label="Checkout"
              onPress={handleCheckout}
              disabled={availableCartItems.length === 0}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: Colors.light.text, textAlign: 'center', flex: 1 },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-start' },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.light.danger + '15',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.danger + '40',
  },
  offlineBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.light.danger },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  shopNowButtonWrap: { marginTop: 20, width: 200 },
  listContent: { padding: 20 },

  // Cart row
  cartItemRow: { marginBottom: 15 },
  cartItemRowUnavailable: { backgroundColor: Colors.light.border + '60' },
  topRow: { flexDirection: 'row', alignItems: 'flex-start' },
  itemImage: { width: 64, height: 64, borderRadius: Radius.sm, backgroundColor: Colors.light.border },
  itemImageUnavailable: { opacity: 0.4 },
  itemDetails: { flex: 1, marginLeft: 12 },
  itemName: { fontSize: 15, fontWeight: 'bold', color: Colors.light.text },
  itemNameUnavailable: { color: Colors.light.icon },
  itemSpecsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  colorDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: Colors.light.border },
  itemSpecs: { fontSize: 12, color: Colors.light.icon },
  unavailableBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  unavailableText: { fontSize: 12, fontWeight: '600', color: Colors.light.danger },
  deleteButton: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center', marginLeft: 4 },

  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.light.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperButtonDisabled: { opacity: 0.4 },
  stepperValue: { fontSize: 15, fontWeight: 'bold', color: Colors.light.text, minWidth: 22, textAlign: 'center' },
  priceColumn: { alignItems: 'flex-end' },
  itemUnitPrice: { fontSize: 11, color: Colors.light.icon },
  itemLineTotal: { fontSize: 15, fontWeight: 'bold', color: Colors.light.highlight, marginTop: 2 },
  maxStockNote: { fontSize: 11, color: Colors.light.danger, marginTop: 8, textAlign: 'right' },

  // Loading skeleton
  skeletonRow: {
    flexDirection: 'row',
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: 15,
    ...Shadow.card,
  },
  skeletonLine: { height: 14, borderRadius: 4, marginTop: 8 },
  skeletonLineShort: { width: '50%' },
  skeletonStepper: { height: 32, width: 110, borderRadius: 16, marginTop: 16 },

  // Footer / order summary
  footer: { padding: 20, borderTopWidth: 1, borderTopColor: Colors.light.border, backgroundColor: Colors.light.background },
  unavailableFooterNote: {
    fontSize: 12,
    color: Colors.light.danger,
    marginBottom: 10,
    textAlign: 'center',
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  summaryLabel: { fontSize: 13, color: Colors.light.icon },
  summaryValue: { fontSize: 13, fontWeight: '600', color: Colors.light.text },
  summaryValueMoss: { fontSize: 13, fontWeight: 'bold', color: Colors.light.secondary },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 12,
    marginBottom: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  totalLabel: { fontSize: 16, fontWeight: '600', color: Colors.light.text },
  totalPrice: { fontSize: 22, fontWeight: 'bold', color: Colors.light.highlight },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  trustText: { fontSize: 12, color: Colors.light.icon, flex: 1 },

  // Undo toast — the one deliberately dark surface in this screen. It
  // borrows Colors.dark's ink/canvas/tint values (not a live theme switch,
  // just the palette already defined for an inverted surface) so a
  // transient overlay reads as "floating above the page" the way a
  // snackbar conventionally does, distinct from the canvas-colored cards
  // around it.
  undoToast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: Colors.dark.background,
    borderRadius: Radius.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
    ...Shadow.card,
  },
  undoText: { flex: 1, fontSize: 13, color: Colors.dark.text },
  undoAction: { fontSize: 13, fontWeight: 'bold', color: Colors.dark.tint },
});
