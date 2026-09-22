import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
} from 'react-native';
import { showAppAlert } from '../utils/appAlert';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  useReducedMotion,
  Easing,
  FadeIn,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { db, auth, functions } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { PAYMENT_METHODS, isPayOnDelivery, requiresOnlinePayment } from '../constants/payment';
import { Colors, Spacing, Radius, Shadow } from '../constants/theme';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import SkeletonBlock from '../components/ui/Skeleton';
import ProductImage from '../components/ui/ProductImage';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

// Handles "$450.00", "450", or 450 — always returns a clean number
const parsePrice = (price) => {
  if (typeof price === 'number') return price;
  if (typeof price === 'string') {
    const cleaned = price.replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
  }
  return 0;
};

// A thin rust-tinted ring that flashes over a section to draw the eye to
// exactly what's missing (no address / no payment method selected) —
// pairs with the existing validation Alert instead of replacing it, so a
// screen-reader user still gets the authoritative message while a sighted
// user also sees *where*.
function ValidationRing({ opacity }) {
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View pointerEvents="none" style={[styles.validationRing, animatedStyle]} />;
}

export default function CheckoutScreen({ navigation, route }) {
  // Captured ONCE, at mount, rather than read from route.params on every
  // render.
  //
  // Checkout is opened with its lines and they never change while it is
  // open — "Edit" goes back to the cart rather than editing in place — so
  // a ref is the honest description of the data either way. What makes it
  // necessary rather than tidy is the sandbox payment round trip:
  // SandboxPayment navigates BACK here with its result, and the returning
  // params did not carry orderItems with them. Reading params on that
  // render produced an empty basket and submitted an order with no lines,
  // which the server correctly refused as "An order needs at least one
  // item" — surfacing to the customer as a generic "Could not place your
  // order" after a payment they had just approved.
  //
  // Holding the lines here makes the round trip irrelevant: what is
  // submitted is what was reviewed, whatever navigation does to params in
  // between.
  const orderItems = useRef(route.params?.orderItems || []).current;
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [shippingAddress, setShippingAddress] = useState(null);
  const [loadingAddress, setLoadingAddress] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  // Shake + flash-highlight targets for the two required-but-missing
  // selections (address, payment method) — triggered from handlePlaceOrder
  // alongside the existing Alert, never in place of it.
  const addressShakeX = useSharedValue(0);
  const addressHighlight = useSharedValue(0);
  const addressShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: addressShakeX.value }] }));
  const paymentShakeX = useSharedValue(0);
  const paymentHighlight = useSharedValue(0);
  const paymentShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: paymentShakeX.value }] }));

  const triggerShake = (sharedValue) => {
    if (reduceMotion) return;
    sharedValue.value = withSequence(
      withTiming(-6, { duration: 45, easing: Easing.linear }),
      withTiming(6, { duration: 45, easing: Easing.linear }),
      withTiming(-4, { duration: 45, easing: Easing.linear }),
      withTiming(4, { duration: 45, easing: Easing.linear }),
      withTiming(0, { duration: 45, easing: Easing.linear })
    );
  };

  const flashHighlight = (sharedValue) => {
    if (reduceMotion) {
      sharedValue.value = 1;
      setTimeout(() => {
        sharedValue.value = 0;
      }, 700);
      return;
    }
    sharedValue.value = withSequence(
      withTiming(1, { duration: 120, easing: EASE_OUT_QUART }),
      withTiming(0, { duration: 600, easing: EASE_OUT_QUART })
    );
  };

  // Refetch on every focus, not just on mount — this is how we pick up a
  // freshly saved/edited address when the user comes back from LocationScreen.
  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadAddress = async () => {
        if (!auth.currentUser) {
          setLoadingAddress(false);
          return;
        }
        try {
          const userDocRef = doc(db, 'users', auth.currentUser.uid);
          const userDocSnap = await getDoc(userDocRef);
          if (isActive) {
            setShippingAddress(
              userDocSnap.exists() ? userDocSnap.data().shippingAddress || null : null
            );
          }
        } catch (error) {
          console.error('Error loading shipping address:', error);
        } finally {
          if (isActive) setLoadingAddress(false);
        }
      };

      loadAddress();
      return () => {
        isActive = false;
      };
    }, [])
  );

  const subtotal = orderItems.reduce((sum, item) => {
    const price = parsePrice(item.price);
    const qty = item.quantity || 1;
    return sum + price * qty;
  }, 0);

  const shipping = 0; // Free shipping
  const total = subtotal + shipping;

  // Gentle pulse on the pinned footer total whenever it actually changes —
  // same treatment Cartscreen.js gives its own footer total, so the two
  // screens' totals read as the same element carried forward, not two
  // different widgets that happen to show the same number.
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

  const handleSelectPayment = (id) => {
    if (id === selectedPayment) return;
    Haptics.selectionAsync();
    setSelectedPayment(id);
  };

  const handleAddressPress = () => {
    Haptics.selectionAsync();
    navigation.navigate('Location');
  };

  const handlePlaceOrder = async () => {
    if (!auth.currentUser) {
      showAppAlert('Login Required', 'Please sign in to place an order.', [
        { text: 'Login', onPress: () => navigation.navigate('Login') },
        { text: 'Cancel' },
      ]);
      return;
    }

    if (orderItems.length === 0) {
      showAppAlert('Empty Order', 'There are no items to check out.');
      return;
    }

    if (!shippingAddress) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      triggerShake(addressShakeX);
      flashHighlight(addressHighlight);
      showAppAlert(
        'Delivery Address Required',
        'Please add a delivery address before placing your order.',
        [
          { text: 'Add Address', onPress: () => navigation.navigate('Location') },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    if (!selectedPayment) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      triggerShake(paymentShakeX);
      flashHighlight(paymentHighlight);
      showAppAlert('Payment Method Required', 'Please select a payment method.');
      return;
    }

    // Everything above is a reason not to charge anyone. Only past it does
    // an online method divert through the sandbox — there is no point
    // simulating a payment for an order that would be refused for a
    // missing address anyway, and doing so would show the customer a
    // "payment approved" screen followed by a failure.
    //
    // The order is NOT placed here for online methods. SandboxPayment
    // returns its result as a route param, and the effect below picks it
    // up and calls submitOrder. COD skips all of it.
    if (requiresOnlinePayment(selectedPayment)) {
      // `total` here is the client's own arithmetic, shown for display
      // only — the same number already on the footer. The server prices
      // the order from the catalogue and authorises THAT, so a stale price
      // makes this screen show a figure that is out of date rather than
      // one that gets charged. Nothing downstream reads it back.
      navigation.navigate('SandboxPayment', {
        amount: total,
        paymentMethod: selectedPayment,
        // Handed over so the sandbox can hand them BACK. Returning to
        // this screen does not reliably restore the params it was opened
        // with — it can remount with only what the returning navigate
        // carries — and a checkout that resumes with an empty basket
        // submits an order with no lines. Round-tripping the lines makes
        // the outcome independent of which of those navigation does.
        orderItems,
      });
      return;
    }

    submitOrder(null, selectedPayment);
  };

  // Resumes checkout once SandboxPayment hands back an outcome.
  //
  // `at` is a timestamp the sandbox stamps on every result, and it is what
  // makes a SECOND attempt work: without it, choosing 'declined' twice in
  // a row would produce an identical param object, the effect would not
  // re-run, and the button would appear dead. Consuming the param (setting
  // it back to undefined) before submitting closes the other half — a
  // remount must not replay a payment that already happened.
  //
  // Both the method and the outcome come from the RESULT rather than from
  // this screen's state, because returning from the sandbox can remount
  // checkout and reset that state to its initial values.
  useEffect(() => {
    const result = route.params?.sandboxResult;
    if (!result) return;
    navigation.setParams({ sandboxResult: undefined });
    // Restores the picker's appearance to match what was actually chosen,
    // so a refused payment leaves the customer looking at the method they
    // picked rather than an empty selection they must make again.
    setSelectedPayment(result.paymentMethod);
    submitOrder(result.outcome, result.paymentMethod);
    // submitOrder is redefined every render and is not a dependency worth
    // memoising for; the param guard above is what keeps this from firing
    // twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.sandboxResult]);

  const submitOrder = async (sandboxOutcome, paymentMethod) => {
    // What the server needs, and deliberately nothing more: which product,
    // how many, and the chosen size/colour. Prices, the subtotal, the total
    // and the delivery address are all looked up server-side now — a field
    // the client cannot supply is a field the client cannot forge.
    //
    // Lines are sent as-is rather than totalled per product here. The
    // function does that itself (a product can occupy several lines with
    // different sizes), and it has to, because it cannot trust an arithmetic
    // result the client hands it.
    //
    // A cart line's own `id` is its CART document id and the product it
    // points at is in `productId`. A Buy Now line is a raw spread of the
    // product, so its `id` IS the product id and it has no `productId` —
    // hence the fallback, in that order, and hence cartItemId being sent
    // only when the line genuinely came from a cart document.
    const items = orderItems.map((item) => ({
      productId: item.productId || item.id,
      quantity: item.quantity || 1,
      size: item.selectedSize || item.size || null,
      color: item.selectedColor || item.color || null,
      cartItemId: item.productId && item.id ? item.id : null,
    }));

    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // One call replaces the client-side transaction that used to read
      // every product, decrement stock, write the order and clear the cart.
      // All of that still happens atomically — just on the server, where
      // the prices it multiplies are the ones in the catalog.
      const placeOrder = httpsCallable(functions, 'placeOrder');
      // sandboxOutcome is omitted entirely for COD rather than sent as
      // null — the function refuses a COD order that carries one, because
      // a client confused about which methods are paid online is a bug
      // worth failing loudly rather than absorbing.
      const { data: placedOrder } = await placeOrder({
        items,
        paymentMethod,
        ...(sandboxOutcome ? { sandboxOutcome } : {}),
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // reset() rather than navigate(): the order exists now, and the back
      // gesture must not return into a checkout that would happily place
      // it a second time. Home is left beneath the confirmation so back
      // still goes somewhere sensible rather than nowhere.
      //
      // Everything the confirmation renders is passed through, because the
      // client already holds it — re-reading would spend a read to show
      // data it has, and would race the serverTimestamp that has not
      // resolved locally yet. All plain serialisable values.
      navigation.reset({
        index: 1,
        routes: [
          { name: 'Home' },
          { name: 'OrderConfirmation', params: { order: placedOrder } },
        ],
      });
    } catch (error) {
      console.error('Error placing order:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      // The callable reports refusals through HttpsError, which reaches the
      // client as error.code ('functions/failed-precondition') plus whatever
      // structured detail the function attached. These branches read that
      // detail rather than the message, so the wording stays here in the UI
      // layer instead of being assembled server-side.
      const reason = error.details?.reason;

      if (reason === 'no-address') {
        showAppAlert(
          'Delivery Address Required',
          'Please add a delivery address before placing your order.',
          [
            { text: 'Add Address', onPress: () => navigation.navigate('Location') },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
        return;
      }

      // The sandbox gateway refused. Nothing was written — no order, no
      // stock decrement — and the cart is intact, so the only useful
      // offers are "try that again" and "pick another method". Both are
      // given, because a declined card and an unresponsive gateway call
      // for different next steps and the customer knows which they had.
      if (reason === 'payment-declined') {
        showAppAlert(
          'Payment Not Completed',
          `${error.message}\n\nYour order was not placed and nothing was charged.`,
          [
            { text: 'Try Again', onPress: () => handlePlaceOrder() },
            // "Change Method" truncated to "Change Meth..." in the dialog's
            // two-button row. The shorter word carries the same meaning
            // beside "Try Again" and next to a payment picker that is
            // still on screen with the refused method highlighted.
            { text: 'Change', style: 'cancel' },
          ]
        );
        return;
      }

      if (reason === 'unavailable') {
        showAppAlert(
          "Item(s) No Longer Available",
          'Some items in your cart are no longer being sold. Please remove them ' +
            'and try again — everything else can still be checked out.'
        );
        return;
      }

      if (reason === 'insufficient-stock') {
        const detail = (error.details?.items || [])
          .map((i) => `• ${i.name} — only ${i.available} left (${i.requested} requested)`)
          .join('\n');
        showAppAlert(
          'Not Enough Stock',
          `The following item(s) don't have enough stock:\n\n${detail}\n\nPlease update your cart and try again.`
        );
        return;
      }

      if (reason === 'rate-limited') {
        // Phrased as "in a short time" rather than naming a number,
        // because the limit is an anti-abuse threshold and stating it
        // tells someone probing it exactly what to stay under. The wait,
        // on the other hand, is worth being concrete about — a person who
        // hit this by retrying a failing cart needs to know whether to
        // wait or walk away.
        const seconds = Number(error.details?.retryAfterSeconds) || 0;
        const minutes = Math.ceil(seconds / 60);
        const wait = seconds > 90
          ? `about ${minutes} minutes`
          : 'a moment';
        showAppAlert(
          'Too Many Attempts',
          `You've tried to place several orders in a short time. Please wait ${wait} and try again.`
        );
        return;
      }

      if (error.code === 'functions/unauthenticated') {
        showAppAlert('Login Required', 'Please sign in to place an order.', [
          { text: 'Login', onPress: () => navigation.navigate('Login') },
          { text: 'Cancel', style: 'cancel' },
        ]);
        return;
      }

      if (error.code === 'functions/permission-denied') {
        showAppAlert(
          'Account Deactivated',
          'This account has been deactivated and cannot place orders. Please contact support.'
        );
        return;
      }

      // isConnected reflects our own NetInfo listener at the moment the call
      // failed; the callable reports the same condition as
      // 'functions/unavailable'. Either one means a network drop rather than
      // a refusal from the backend.
      const isNetworkError = !isConnected || error.code === 'functions/unavailable';
      if (isNetworkError) {
        showAppAlert(
          'No Internet Connection',
          'Network connection lost. Please check your connection and try again.'
        );
        return;
      }

      showAppAlert('Error', 'Could not place your order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // The online branch used to say "Secure checkout — your details stay
  // private", which was true only because nothing was collected at all.
  // Now that a payment step genuinely runs, saying nothing about its being
  // simulated would be the first place this app overstated itself.
  const trustText = isPayOnDelivery(selectedPayment)
    ? 'Pay when your order arrives — no online payment needed'
    : 'Sandbox payment — simulated, and no card details are collected';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
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
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 24 }} />
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            No internet connection — some details may be outdated.
          </Text>
        </View>
      )}

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Item List */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Items</Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel="Edit items in cart"
          >
            <Text style={styles.editLink}>Edit</Text>
          </TouchableOpacity>
        </View>
        {orderItems.map((item, index) => (
          <View key={index} style={styles.itemRow}>
            {(item.image || item.imageUrl) ? (
              <ProductImage uri={item.image || item.imageUrl} style={styles.itemImage} />
            ) : null}
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.itemMeta}>
                {item.selectedSize || item.size} · {item.selectedColor || item.color} · Qty {item.quantity || 1}
              </Text>
            </View>
            <Text style={styles.itemPrice}>
              ₱{(parsePrice(item.price) * (item.quantity || 1)).toFixed(2)}
            </Text>
          </View>
        ))}

        {/* Delivery Address */}
        <Text style={styles.sectionTitle}>Delivery Address</Text>
        <Animated.View style={addressShakeStyle}>
          <View style={styles.highlightWrap}>
            {loadingAddress ? (
              <View style={[styles.addressCardRow, styles.skeletonCard]}>
                <SkeletonBlock style={styles.skeletonIcon} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <SkeletonBlock style={styles.skeletonLine} />
                  <SkeletonBlock style={[styles.skeletonLine, styles.skeletonLineShort]} />
                </View>
              </View>
            ) : shippingAddress ? (
              <AnimatedPressable
                onPress={handleAddressPress}
                accessibilityRole="button"
                accessibilityLabel={`Delivery address: ${shippingAddress.fullName}, ${shippingAddress.address}. Tap to change.`}
              >
                <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(220).easing(EASE_OUT_QUART)}>
                  <Card style={styles.addressCardRow}>
                    <Ionicons name="location-outline" size={20} color={Colors.light.tint} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.addressName}>
                        {shippingAddress.fullName} · {shippingAddress.phone}
                      </Text>
                      <Text style={styles.addressDetail}>
                        {shippingAddress.address}, {shippingAddress.city}, {shippingAddress.province} {shippingAddress.zipCode}
                      </Text>
                    </View>
                    <Text style={styles.changeText}>Change</Text>
                  </Card>
                </Animated.View>
              </AnimatedPressable>
            ) : (
              <AnimatedPressable
                onPress={handleAddressPress}
                accessibilityRole="button"
                accessibilityLabel="Add a delivery address"
              >
                <Card style={styles.addAddressCard}>
                  <Ionicons name="add-circle-outline" size={20} color={Colors.light.tint} />
                  <Text style={styles.addAddressText}>Add a delivery address</Text>
                </Card>
              </AnimatedPressable>
            )}
            <ValidationRing opacity={addressHighlight} />
          </View>
        </Animated.View>

        {/* Order Summary */}
        <Text style={styles.sectionTitle}>Order Summary</Text>
        <Card>
          <View style={styles.row}>
            <Text style={styles.label}>Subtotal</Text>
            <Text style={styles.value}>₱{subtotal.toFixed(2)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Shipping</Text>
            <Text style={styles.valueMoss}>Free</Text>
          </View>
          <View style={[styles.row, styles.totalRowInline]}>
            <Text style={styles.totalLabelInline}>Total</Text>
            <Text style={styles.totalValueInline}>₱{total.toFixed(2)}</Text>
          </View>
        </Card>

        {/* Payment Method */}
        <Text style={styles.sectionTitle}>Payment Method</Text>
        <Animated.View style={paymentShakeStyle}>
          <View style={styles.highlightWrap}>
            <View style={styles.paymentRow}>
              {PAYMENT_METHODS.map((option) => {
                const isSelected = selectedPayment === option.id;
                return (
                  <AnimatedPressable
                    key={option.id}
                    style={[styles.paymentOption, isSelected && styles.paymentOptionActive]}
                    onPress={() => handleSelectPayment(option.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Pay with ${option.label}`}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Ionicons
                      name={option.icon}
                      size={22}
                      color={isSelected ? '#fff' : Colors.light.tint}
                    />
                    <Text style={[styles.paymentOptionText, isSelected && styles.paymentOptionTextActive]} numberOfLines={1}>
                      {option.label}
                    </Text>
                  </AnimatedPressable>
                );
              })}
            </View>
            <ValidationRing opacity={paymentHighlight} />
          </View>
        </Animated.View>
      </ScrollView>

      <View style={styles.footer}>
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
          <Text style={styles.trustText}>{trustText}</Text>
        </View>
        <Button
          variant="primary"
          label={!isConnected ? 'No Internet Connection' : 'Place Order'}
          onPress={handlePlaceOrder}
          disabled={submitting || !isConnected}
          loading={submitting}
        />
      </View>
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
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: Colors.light.text },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-start' },
  content: { flex: 1, paddingHorizontal: 20, paddingVertical: 20 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.light.text, marginBottom: 15, marginTop: 10 },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
    marginTop: 10,
  },
  editLink: { fontSize: 13, fontWeight: '600', color: Colors.light.tint },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  itemImage: { width: 50, height: 50, borderRadius: 8, backgroundColor: Colors.light.border },
  itemName: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  itemMeta: { fontSize: 12, color: Colors.light.icon, marginTop: 2 },
  itemPrice: { fontSize: 14, fontWeight: '600', color: Colors.light.text },

  // Validation shake/highlight wrap — a plain relative-position View so the
  // ValidationRing overlay can sit above whichever child (skeleton, address
  // card, or "add address" card) currently renders inside it.
  highlightWrap: { position: 'relative' },
  validationRing: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: Radius.lg + 4,
    borderWidth: 2,
    borderColor: Colors.light.danger,
  },

  addressCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  skeletonCard: { ...Shadow.card },
  skeletonIcon: { width: 20, height: 20, borderRadius: 4 },
  skeletonLine: { height: 12, borderRadius: 4, marginTop: 6 },
  skeletonLineShort: { width: '60%' },
  addressName: { fontSize: 14, fontWeight: '600', color: Colors.light.text, marginBottom: 4 },
  addressDetail: { fontSize: 12, color: Colors.light.icon, lineHeight: 18 },
  changeText: { fontSize: 13, color: Colors.light.tint, fontWeight: '600', marginLeft: 10 },
  addAddressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderColor: Colors.light.tint,
    borderStyle: 'dashed',
    marginBottom: 10,
  },
  addAddressText: { fontSize: 14, color: Colors.light.tint, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  label: { fontSize: 14, color: Colors.light.icon },
  value: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  valueMoss: { fontSize: 14, fontWeight: 'bold', color: Colors.light.secondary },
  totalRowInline: { borderTopWidth: 1, borderTopColor: Colors.light.border, marginTop: 10 },
  totalLabelInline: { fontSize: 16, fontWeight: 'bold', color: Colors.light.text },
  totalValueInline: { fontSize: 16, fontWeight: 'bold', color: Colors.light.highlight },

  paymentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 10 },
  paymentOption: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  paymentOptionActive: {
    backgroundColor: Colors.light.tint,
    borderColor: Colors.light.tint,
  },
  paymentOptionText: { fontSize: 13, fontWeight: '600', color: Colors.light.tint },
  paymentOptionTextActive: { color: '#fff' },

  // Footer — deliberately mirrors Cartscreen.js's footer (same total pulse,
  // trust row and Button treatment) so the Cart -> Checkout handoff reads
  // as one continuous flow, not two differently-built screens.
  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
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
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  totalLabel: { fontSize: 16, fontWeight: '600', color: Colors.light.text },
  totalPrice: { fontSize: 22, fontWeight: 'bold', color: Colors.light.highlight },
  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  trustText: { fontSize: 12, color: Colors.light.icon, flex: 1 },
});
