// screens/Cartscreen.js
//
// The cart, in the approved favorites/cart/profile preview's design: item
// cards with a quantity stepper, a summary card, and Checkout held above
// the tab bar with the total on it. The rules are the ones the cart
// already had — a product's stock is shared across all its lines, items
// that are no longer listed stay visible but are left out of checkout, and
// nothing is judged unavailable until the catalogue has loaded.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  useReducedMotion,
  FadeIn,
  FadeInDown,
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
import { parseStockLimit, totalQuantityByProductId } from '../utils/stock';
import { COLOR_PALETTE } from '../constants/productOptions';
import { Colors } from '../constants/theme';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import SkeletonBlock from '../components/ui/Skeleton';
import ProductImage from '../components/ui/ProductImage';
import TabBar, { goToTab } from '../components/shop/TabBar';
import { PageHead, BigEmpty, UndoToast, OfflineNotice, useAutoClear } from '../components/shop/TabScreen';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

// Handles price as "₱450.00", "450", or a plain number 450.
const parsePrice = (price) => {
  if (typeof price === 'number') return price;
  if (typeof price === 'string') {
    const cleaned = price.replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
  }
  return 0;
};

const peso = (n) => `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;

const getColorHex = (colorName) => {
  const found = COLOR_PALETTE.find((c) => c.name === colorName);
  return found ? found.hex : null;
};

function CartSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.card}>
          <SkeletonBlock style={styles.thumb} />
          <View style={styles.info}>
            <SkeletonBlock style={styles.skeletonLine} />
            <SkeletonBlock style={[styles.skeletonLine, styles.skeletonLineShort]} />
            <SkeletonBlock style={styles.skeletonStepper} />
          </View>
        </View>
      ))}
    </View>
  );
}

// − 2 +, in a bordered pill.
function Stepper({ quantity, atMin, atMax, name, onDecrease, onIncrease }) {
  return (
    <View style={styles.stepper}>
      <Pressable
        style={styles.stepButton}
        onPress={onDecrease}
        disabled={atMin}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Decrease quantity for ${name}`}
        accessibilityState={{ disabled: atMin }}
      >
        <Ionicons name="remove" size={16} color={atMin ? '#CFC6BC' : Colors.light.text} />
      </Pressable>
      <Text style={styles.stepValue}>{quantity}</Text>
      <Pressable
        style={styles.stepButton}
        onPress={onIncrease}
        disabled={atMax}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Increase quantity for ${name}`}
        accessibilityState={{ disabled: atMax }}
      >
        <Ionicons name="add" size={16} color={atMax ? '#CFC6BC' : Colors.light.text} />
      </Pressable>
    </View>
  );
}

// One cart line. `maxQuantity` is how high THIS line may go (the product's
// stock minus what its other lines already claim); `stockLimit` is the
// product's actual stock. They differ whenever the same product sits on
// more than one line, and the note quotes the second — the first is a
// budget, not a fact about the shop.
function CartRow({ item, index, product, available, maxQuantity, stockLimit, onRemove, onQuantityChange }) {
  const reduceMotion = useReducedMotion();
  const quantity = item.quantity || 1;
  const unitPrice = parsePrice(item.price);
  const lineTotal = unitPrice * quantity;
  const atMin = quantity <= 1;
  const atMax = maxQuantity !== null && quantity >= maxQuantity;
  const colorHex = getColorHex(item.color);

  // A small pulse on the line total when it changes, so a quantity tap
  // reads as the cause of the new number.
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
  }, [lineTotal]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next) => {
    Haptics.selectionAsync();
    onQuantityChange(item, next);
  };

  const oneOfAKind = product?.type === 'ukay-ukay';
  const stockNote =
    available && atMax && stockLimit > 0
      ? stockLimit === 1
        ? `Only 1 available${oneOfAKind ? ' (one-of-a-kind)' : ''}`
        : `Only ${stockLimit} in stock`
      : null;

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.delay(80 + Math.min(index, 6) * 60).duration(600).easing(EASE_OUT_QUINT)}
      exiting={reduceMotion ? undefined : FadeOutLeft.duration(300).easing(EASE_OUT_QUINT)}
      layout={reduceMotion ? undefined : LinearTransition.duration(350).easing(EASE_OUT_QUINT)}
      style={styles.card}
    >
      <View style={[styles.thumb, !available && styles.faded]}>
        {item.image ? (
          <ProductImage uri={item.image} style={StyleSheet.absoluteFill} accessibilityLabel={`Photo of ${item.name}`} />
        ) : (
          <Ionicons name="shirt-outline" size={28} color={Colors.light.icon} />
        )}
      </View>
      <View style={styles.info}>
        <Text style={[styles.name, !available && styles.faded]} numberOfLines={2}>
          {item.name}
        </Text>
        <View style={[styles.variant, !available && styles.faded]}>
          {colorHex ? <View style={[styles.swatch, { backgroundColor: colorHex }]} /> : null}
          <Text style={styles.variantText}>
            {item.color} · Size {item.size}
            {available && quantity > 1 ? `  ·  ${peso(unitPrice)} each` : ''}
          </Text>
        </View>
        {!available ? (
          <View style={styles.naBadge}>
            <Ionicons name="alert-circle-outline" size={13} color={ERR_INK} />
            <Text style={styles.naText}>No longer available</Text>
          </View>
        ) : (
          <>
            {stockNote ? <Text style={styles.stockNote}>{stockNote}</Text> : null}
            <View style={styles.row2}>
              <Animated.Text style={[styles.price, totalAnimatedStyle]}>{peso(lineTotal)}</Animated.Text>
              <Stepper
                quantity={quantity}
                atMin={atMin}
                atMax={atMax}
                name={item.name}
                onDecrease={() => !atMin && change(quantity - 1)}
                onIncrease={() => !atMax && change(quantity + 1)}
              />
            </View>
          </>
        )}
      </View>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onRemove(item);
        }}
        style={({ pressed }) => [styles.remove, pressed && styles.removePressed]}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.name} from cart`}
      >
        <Ionicons name="trash-outline" size={17} color={Colors.light.icon} />
      </Pressable>
    </Animated.View>
  );
}
const ERR_INK = '#7A1B12';

export default function CartScreen({ navigation, route }) {
  const { cartItems, loading: cartLoading, removeFromCart, addToCart, updateQuantity } = useCart();
  // The live catalogue: whether each line's product still exists, and its
  // current stock. The cart line keeps its own saved name and price.
  const { products, loading: productsLoading, error: productsError, retryFetchProducts } = useProducts();
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();
  const fromTab = route.params?.via === 'tab';

  // The most recently removed line, kept long enough to offer Undo instead
  // of a blocking "Are you sure?" before every removal.
  const [undoItem, setUndoItem] = useState(null);
  useAutoClear(undoItem, () => setUndoItem(null));

  useEffect(() => {
    // Cart is customer-only; CartContext resolves loading=false for guests,
    // so this just handles the redirect.
    if (!auth.currentUser) navigation.replace('Login');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Both listeners gate this screen: availability is decided by finding a
  // line's product in `products`, so until the catalogue arrives every row
  // would read "No longer available".
  const loading = cartLoading || productsLoading;

  const getProduct = (item) => products.find((p) => p.id === item.productId);
  const availableCartItems = cartItems.filter((item) => Boolean(getProduct(item)));
  const hasUnavailableItems = cartItems.length > availableCartItems.length;
  const availableUnits = availableCartItems.reduce((n, item) => n + (item.quantity || 1), 0);

  const subtotal = availableCartItems.reduce((sum, item) => sum + parsePrice(item.price) * (item.quantity || 1), 0);
  const shipping = 0; // Free shipping — mirrors Checkoutscreen.js's summary.
  const total = subtotal + shipping;

  const handleRemove = async (item) => {
    setUndoItem(item);
    const result = await removeFromCart(item.id);
    if (!result.success) {
      console.error('Error removing item:', result.error);
      setUndoItem(null);
    }
  };

  const handleUndo = async () => {
    if (!undoItem) return;
    // Re-added as a new line through the normal path; it gets a fresh doc
    // id, which nothing downstream depends on.
    const itemData = { ...undoItem };
    delete itemData.id;
    delete itemData.addedAt;
    setUndoItem(null);
    const result = await addToCart(itemData);
    if (result.success) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else console.error('Error restoring item:', result.error);
  };

  const handleQuantityChange = async (item, nextQuantity) => {
    const result = await updateQuantity(item.id, nextQuantity);
    if (!result.success) console.error('Error updating quantity:', result.error);
  };

  const handleCheckout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('Checkout', { orderItems: availableCartItems });
  };

  // Units of each product across ALL lines: one shirt in two sizes is two
  // lines, and its stock is a budget shared between them.
  const quantityByProductId = totalQuantityByProductId(cartItems, (item) => item.productId);

  const renderItem = ({ item, index }) => {
    const product = getProduct(item);
    const stockLimit = product ? parseStockLimit(product.stock) : null;
    // This line's ceiling is the stock left after the product's other lines
    // take their share, floored at its current quantity so a line already
    // over budget is left to be reduced rather than treated as invalid.
    const quantity = item.quantity || 1;
    const claimedElsewhere = (quantityByProductId.get(item.productId) || quantity) - quantity;
    const maxQuantity = stockLimit === null ? null : Math.max(quantity, stockLimit - claimedElsewhere);
    return (
      <CartRow
        item={item}
        index={index}
        product={product}
        available={Boolean(product)}
        maxQuantity={maxQuantity}
        stockLimit={stockLimit}
        onRemove={handleRemove}
        onQuantityChange={handleQuantityChange}
      />
    );
  };

  // Hold the empty view until a pending Undo resolves, so removing the last
  // item doesn't take the Undo away with it.
  const showEmpty = !loading && cartItems.length === 0 && !undoItem;
  const showList = !loading && !productsError && !showEmpty;
  const lines = cartItems.length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <PageHead
        title="Cart"
        meta={showList && lines > 0 ? `${lines} ${lines === 1 ? 'item' : 'items'}` : null}
        onBack={fromTab ? null : () => navigation.goBack()}
      />

      {!isConnected && <OfflineNotice>No internet connection — your cart may be outdated.</OfflineNotice>}

      {loading ? (
        <CartSkeleton />
      ) : productsError ? (
        // A failed catalogue leaves `products` empty, which would strike out
        // every line. We don't know what's in stock, so say that instead.
        <Animated.View style={styles.center} entering={reduceMotion ? undefined : FadeIn.duration(280)}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't check your cart"
            subtitle="We can't confirm which items are still available right now."
          />
          <Button variant="secondary" label="Retry" onPress={retryFetchProducts} />
        </Animated.View>
      ) : showEmpty ? (
        <BigEmpty
          icon="bag-handle-outline"
          title="Your cart is empty"
          text="Pre-loved finds and new styles are waiting in the Shop."
          actionLabel="Start shopping"
          onAction={() => goToTab(navigation, 'Shop')}
        />
      ) : (
        <FlatList
          data={cartItems}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            cartItems.length > 0 ? (
              <Animated.View style={styles.summary} entering={reduceMotion ? undefined : FadeInDown.delay(260).duration(600).easing(EASE_OUT_QUINT)}>
                <View style={styles.sumRow}>
                  <Text style={styles.sumLabel}>
                    Subtotal ({availableUnits} {availableUnits === 1 ? 'item' : 'items'})
                  </Text>
                  <Text style={styles.sumMoney}>{peso(subtotal)}</Text>
                </View>
                <View style={styles.sumRow}>
                  <Text style={styles.sumLabel}>Shipping</Text>
                  <Text style={styles.sumFree}>Free</Text>
                </View>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Total</Text>
                  <Text style={styles.totalMoney} accessibilityLiveRegion="polite">
                    {peso(total)}
                  </Text>
                </View>
                <View style={styles.trust}>
                  <Ionicons name="shield-checkmark-outline" size={13} color={Colors.light.icon} />
                  <Text style={styles.trustText}>Cash on Delivery available — pay when it arrives</Text>
                </View>
              </Animated.View>
            ) : null
          }
        />
      )}

      {showList && cartItems.length > 0 ? (
        <View style={styles.checkoutBar}>
          {hasUnavailableItems ? (
            <Text style={styles.checkoutNote}>Items no longer available won&apos;t be included in checkout.</Text>
          ) : null}
          <Button
            variant="primary"
            label={`Checkout · ${peso(total)}`}
            fontSize={16}
            onPress={handleCheckout}
            disabled={availableCartItems.length === 0}
          />
        </View>
      ) : null}

      <UndoToast
        text={undoItem ? 'Removed from Cart' : ''}
        onUndo={handleUndo}
        undoLabel={undoItem ? `Undo removing ${undoItem.name}` : undefined}
        lift={showList ? (hasUnavailableItems ? 100 : 80) : 0}
      />
      <TabBar navigation={navigation} current="Cart" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  list: { paddingHorizontal: 20, paddingBottom: 24 },

  card: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE7DD',
    borderRadius: 18,
    marginBottom: 10,
  },
  thumb: {
    width: 78,
    height: 96,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#EFE6DA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faded: { opacity: 0.55 },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: 13.5, fontWeight: '500', lineHeight: 17.5, color: Colors.light.text, paddingRight: 28 },
  variant: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  swatch: { width: 11, height: 11, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)' },
  variantText: { fontSize: 11.5, color: Colors.light.icon, flexShrink: 1 },
  stockNote: { fontSize: 10.5, color: Colors.light.secondary, marginTop: 4 },
  row2: { marginTop: 'auto', paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  price: { fontSize: 14.5, fontWeight: '600', color: Colors.light.highlight },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 34,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    borderRadius: 12,
  },
  stepButton: { width: 32, height: 31, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 24, textAlign: 'center', fontSize: 13.5, fontWeight: '600', color: Colors.light.text },
  remove: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePressed: { backgroundColor: 'rgba(28,27,26,0.06)' },
  naBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#FBEDEB',
  },
  naText: { fontSize: 11, fontWeight: '600', color: ERR_INK },

  summary: { marginTop: 6, padding: 16, borderRadius: 18, backgroundColor: '#F3EEE6' },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  sumLabel: { fontSize: 13, color: Colors.light.icon },
  sumMoney: { fontSize: 13.5, fontWeight: '600', color: Colors.light.highlight },
  sumFree: { fontSize: 13, fontWeight: '600', color: Colors.light.secondary },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderTopColor: '#D8CFC4',
    paddingTop: 12,
    marginTop: 4,
  },
  totalLabel: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  totalMoney: { fontSize: 20, fontWeight: '600', color: Colors.light.highlight },
  trust: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  trustText: { flex: 1, fontSize: 11.5, color: Colors.light.icon },

  checkoutBar: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: Colors.light.background,
  },
  checkoutNote: { fontSize: 11.5, textAlign: 'center', color: ERR_INK, marginBottom: 8 },

  skeletonLine: { height: 12, borderRadius: 6, marginTop: 6, width: '80%' },
  skeletonLineShort: { width: '45%' },
  skeletonStepper: { height: 34, width: 100, borderRadius: 12, marginTop: 'auto' },
});
