import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  AccessibilityInfo,
} from 'react-native';
import { showAppAlert } from '../utils/appAlert';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  useReducedMotion,
  useAnimatedRef,
  Easing,
  FadeIn,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { db, auth, functions } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { PAYMENT_METHODS, isPayOnDelivery, requiresOnlinePayment } from '../constants/payment';
import { Colors } from '../constants/theme';
import SkeletonBlock from '../components/ui/Skeleton';
import { TopBar, OfflineNotice } from '../components/shop/TabScreen';
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
// How each method is shown in the list: a colored letter or icon tile and
// a line under its name. The ids, labels and order are still
// constants/payment.js's.
const METHOD_LOOK = {
  gcash: { tile: '#1E6FEB', letter: 'G', name: 'GCash', line: 'Pay with your GCash wallet' },
  maya: { tile: '#1A1A1A', letter: 'M', name: 'Maya', line: 'Pay with your Maya wallet' },
  card: { tile: Colors.light.secondary, icon: 'card-outline', name: 'Credit / debit card', line: 'Visa, Mastercard' },
  cod: { tile: Colors.light.tint, icon: 'cube-outline', name: 'Cash on Delivery', line: 'Pay the rider when it arrives' },
};

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
  const insets = useSafeAreaInsets();
  const scrollRef = useAnimatedRef();
  const [stuck, setStuck] = useState(false);
  // Set when no payment method was chosen at Place order; the footer says
  // so and the options are outlined until one is picked.
  const [needPayment, setNeedPayment] = useState(false);
  // An item that sold out (or ran short) between opening checkout and
  // placing the order, shown as a notice at the top of the page.
  const [stockProblem, setStockProblem] = useState(null);
  const paymentY = useRef(0);
  // Opened from the cart (lines carry a cart productId) or from a
  // product's Buy Now (a raw product with no productId).
  const fromCart = orderItems.length > 0 && orderItems.every((item) => item.productId);
  const itemCount = orderItems.reduce((sum, item) => sum + (item.quantity || 1), 0);

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
    setNeedPayment(false);
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

    // No dialog for this one: the footer says what's missing, the options
    // are outlined, and the page scrolls to them. The message is announced
    // for screen readers, which the dialog used to be for.
    if (!selectedPayment) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setNeedPayment(true);
      triggerShake(paymentShakeX);
      flashHighlight(paymentHighlight);
      scrollRef.current?.scrollTo({ y: Math.max(0, paymentY.current - 120), animated: true });
      AccessibilityInfo.announceForAccessibility('Choose a payment method to continue.');
      return;
    }

    setStockProblem(null);

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

      // Stock problems show at the top of the page, as in the preview,
      // rather than as a dialog: the customer's next step is to change
      // what they're buying, and the notice stays in view while they do.
      if (reason === 'unavailable') {
        setStockProblem({
          title: 'Some items are no longer being sold.',
          body: 'Remove them and try again. Everything else can still be checked out.',
        });
        scrollRef.current?.scrollTo({ y: 0, animated: true });
        return;
      }

      if (reason === 'insufficient-stock') {
        const short = error.details?.items || [];
        const first = short[0];
        const title =
          short.length === 1 && first
            ? first.available > 0
              ? `Only ${first.available} of ${first.name} left.`
              : `Sorry, ${first.name} just sold out.`
            : 'Some items just ran out.';
        const body =
          short.length > 1
            ? short.map((i) => `${i.name}: ${i.available > 0 ? `only ${i.available} left` : 'sold out'}`).join('\n')
            : 'Someone else checked out first.';
        setStockProblem({ title, body });
        scrollRef.current?.scrollTo({ y: 0, animated: true });
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

  // The online methods run a simulated payment, and the page says so;
  // nothing is collected and no money moves. COD says what to have ready.
  const methodNote = isPayOnDelivery(selectedPayment)
    ? 'Pay in cash when your order arrives. Please prepare the exact amount if you can.'
    : 'Online payments are in test mode (sandbox). No money is charged and no card details are collected.';

  const footerMessage = !isConnected
    ? "You're offline. Reconnect to place your order."
    : !selectedPayment
    ? 'Choose a payment method to continue.'
    : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <TopBar title="Checkout" onBack={() => navigation.goBack()} stuck={stuck} />

      <Animated.ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => setStuck(e.nativeEvent.contentOffset.y > 4)}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* Where this step sits */}
        <View style={styles.steps} accessible accessibilityLabel={`Step 2 of 3, review and pay`}>
          <View style={styles.step}>
            <View style={[styles.stepDot, styles.stepDotDone]}>
              <Ionicons name="checkmark" size={11} color="#fff" />
            </View>
            <Text style={styles.stepText}>{fromCart ? 'Cart' : 'Item'}</Text>
          </View>
          <View style={styles.stepRule} />
          <View style={styles.step}>
            <View style={[styles.stepDot, styles.stepDotNow]}>
              <Text style={styles.stepNum}>2</Text>
            </View>
            <Text style={[styles.stepText, styles.stepTextNow]}>Review & pay</Text>
          </View>
          <View style={styles.stepRule} />
          <View style={styles.step}>
            <View style={styles.stepDot}>
              <Text style={[styles.stepNum, { color: Colors.light.icon }]}>3</Text>
            </View>
            <Text style={styles.stepText}>Done</Text>
          </View>
        </View>

        {!isConnected ? (
          <View style={styles.noticeWrap}>
            <OfflineNotice>Network connection lost. Please check your connection and try again.</OfflineNotice>
          </View>
        ) : null}

        {stockProblem ? (
          <Animated.View
            style={styles.alert}
            entering={reduceMotion ? undefined : FadeIn.duration(350).easing(EASE_OUT_QUART)}
            accessibilityRole="alert"
          >
            <Ionicons name="alert-circle-outline" size={18} color={ERR_INK} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>{stockProblem.title}</Text>
              <Text style={styles.alertText}>
                {stockProblem.body} {"You haven't been charged. "}
                <Text style={styles.alertLink} onPress={() => navigation.goBack()} accessibilityRole="link">
                  {fromCart ? 'Update your cart' : 'Choose another size'}
                </Text>
              </Text>
            </View>
          </Animated.View>
        ) : null}

        {/* Deliver to */}
        <Animated.View style={addressShakeStyle}>
          <View style={styles.highlightWrap}>
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.cardTitleRow}>
                  <Ionicons name="location-outline" size={17} color={Colors.light.tint} />
                  <Text style={styles.cardTitle}>Deliver to</Text>
                </View>
                {shippingAddress ? (
                  <Pressable onPress={handleAddressPress} hitSlop={10} accessibilityRole="button" accessibilityLabel="Change delivery address">
                    <Text style={styles.cardLink}>Change</Text>
                  </Pressable>
                ) : null}
              </View>
              {loadingAddress ? (
                <View>
                  <SkeletonBlock style={styles.skeletonLine} />
                  <SkeletonBlock style={[styles.skeletonLine, styles.skeletonLineShort]} />
                </View>
              ) : shippingAddress ? (
                <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(220).easing(EASE_OUT_QUART)}>
                  <Text style={styles.addressName}>
                    {shippingAddress.fullName} · {shippingAddress.phone}
                  </Text>
                  <Text style={styles.addressText}>
                    {shippingAddress.address}
                    {'\n'}
                    {shippingAddress.city}, {shippingAddress.province} {shippingAddress.zipCode}
                  </Text>
                </Animated.View>
              ) : (
                <Pressable
                  onPress={handleAddressPress}
                  style={({ pressed }) => [styles.addAddress, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Add a delivery address"
                >
                  <Ionicons name="add-circle-outline" size={18} color={Colors.light.tint} />
                  <Text style={styles.addAddressText}>Add a delivery address</Text>
                </Pressable>
              )}
            </View>
            <ValidationRing opacity={addressHighlight} />
          </View>
        </Animated.View>

        {/* Items */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="bag-handle-outline" size={17} color={Colors.light.tint} />
              <Text style={styles.cardTitle}>
                Items <Text style={styles.cardTitleMuted}>({itemCount})</Text>
              </Text>
            </View>
            <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Edit items">
              <Text style={styles.cardLink}>Edit</Text>
            </Pressable>
          </View>
          {orderItems.map((item, index) => (
            <View key={index} style={[styles.line, index > 0 && styles.lineNext]}>
              {item.image || item.imageUrl ? (
                <ProductImage uri={item.image || item.imageUrl} style={styles.lineImage} />
              ) : (
                <View style={styles.lineImage} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.lineName} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.lineMeta}>
                  {[item.selectedColor || item.color, item.selectedSize || item.size].filter(Boolean).join(' · ')} · Qty{' '}
                  {item.quantity || 1}
                </Text>
              </View>
              <Text style={styles.linePrice}>₱{(parsePrice(item.price) * (item.quantity || 1)).toFixed(2)}</Text>
            </View>
          ))}
        </View>

        {/* Payment method */}
        <Animated.View style={paymentShakeStyle} onLayout={(e) => (paymentY.current = e.nativeEvent.layout.y)}>
          <View style={styles.highlightWrap}>
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.cardTitleRow}>
                  <Ionicons name="card-outline" size={17} color={Colors.light.tint} />
                  <Text style={styles.cardTitle}>Payment method</Text>
                </View>
              </View>
              <View style={{ gap: 8 }} accessibilityRole="radiogroup">
                {PAYMENT_METHODS.map((option) => {
                  const on = selectedPayment === option.id;
                  const look = METHOD_LOOK[option.id] || { tile: Colors.light.icon, icon: option.icon, name: option.label, line: '' };
                  return (
                    <Pressable
                      key={option.id}
                      onPress={() => handleSelectPayment(option.id)}
                      style={({ pressed }) => [
                        styles.option,
                        needPayment && styles.optionNeed,
                        on && styles.optionOn,
                        pressed && { transform: [{ scale: 0.99 }] },
                      ]}
                      accessibilityRole="radio"
                      accessibilityLabel={`${look.name}. ${look.line}`}
                      accessibilityState={{ checked: on }}
                    >
                      <View style={[styles.optionTile, { backgroundColor: look.tile }]}>
                        {look.letter ? (
                          <Text style={styles.optionLetter}>{look.letter}</Text>
                        ) : (
                          <Ionicons name={look.icon} size={18} color="#fff" />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.optionName}>{look.name}</Text>
                        {look.line ? <Text style={styles.optionLine}>{look.line}</Text> : null}
                      </View>
                      <View style={[styles.radio, on && styles.radioOn]}>
                        {on ? <View style={styles.radioDot} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.note}>
                <Ionicons name="shield-outline" size={15} color={NOTE_INK} style={{ marginTop: 1 }} />
                <Text style={styles.noteText}>{methodNote}</Text>
              </View>
            </View>
            <ValidationRing opacity={paymentHighlight} />
          </View>
        </Animated.View>

        {/* Order summary */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="receipt-outline" size={17} color={Colors.light.tint} />
              <Text style={styles.cardTitle}>Order summary</Text>
            </View>
          </View>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Subtotal</Text>
            <Text style={styles.sumValue}>₱{subtotal.toFixed(2)}</Text>
          </View>
          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Shipping</Text>
            <Text style={styles.sumFree}>Free</Text>
          </View>
          <View style={styles.sumTotal}>
            <Text style={styles.sumTotalLabel}>Total</Text>
            <Text style={styles.sumTotalValue}>₱{total.toFixed(2)}</Text>
          </View>
        </View>
      </Animated.ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
        {footerMessage ? (
          <Text style={styles.footerMessage} accessibilityLiveRegion="polite">
            {footerMessage}
          </Text>
        ) : null}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Animated.Text style={[styles.totalPrice, totalAnimatedStyle]} accessibilityLiveRegion="polite">
            ₱{total.toFixed(2)}
          </Animated.Text>
        </View>
        <Pressable
          onPress={handlePlaceOrder}
          disabled={submitting || !isConnected}
          style={({ pressed }) => [
            styles.place,
            !isConnected && styles.placeOff,
            pressed && !submitting && { transform: [{ scale: 0.97 }] },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Place order"
          accessibilityState={{ disabled: submitting || !isConnected, busy: submitting }}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.placeText}>Place order</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const INK = Colors.light.text;
const CARD_LINE = '#EEE7DD';
const PRICE = '#8C6D0C';
const ERR = '#B42318';
const ERR_INK = '#7A1B12';
const NOTE_INK = '#6B5A2E';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },

  steps: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 20, marginTop: 4, marginBottom: 16 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  stepDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#EDE5DA', alignItems: 'center', justifyContent: 'center' },
  stepDotDone: { backgroundColor: Colors.light.secondary },
  stepDotNow: { backgroundColor: Colors.light.tint },
  stepNum: { fontSize: 10, fontWeight: '600', color: '#fff' },
  stepText: { fontSize: 11, color: Colors.light.icon },
  stepTextNow: { color: INK, fontWeight: '600' },
  stepRule: { flex: 1, height: 1.5, backgroundColor: '#E4DCD1' },

  noticeWrap: { marginHorizontal: 16, marginBottom: 12 },
  alert: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#FBEDEB',
    borderWidth: 1,
    borderColor: '#F1CFCB',
  },
  alertTitle: { fontSize: 12.5, fontWeight: '600', color: ERR_INK },
  alertText: { fontSize: 12.5, lineHeight: 18, color: ERR_INK },
  alertLink: { fontWeight: '600', textDecorationLine: 'underline' },

  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: INK },
  cardTitleMuted: { fontWeight: '400', color: Colors.light.icon },
  cardLink: { fontSize: 12.5, fontWeight: '600', color: Colors.light.tint },

  // The flash-and-shake target for a missing address or payment method.
  highlightWrap: { position: 'relative' },
  validationRing: {
    position: 'absolute',
    top: -3,
    left: 13,
    right: 13,
    bottom: 9,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: Colors.light.danger,
  },

  skeletonLine: { height: 12, borderRadius: 4, marginTop: 6 },
  skeletonLineShort: { width: '60%' },
  addressName: { fontSize: 13.5, fontWeight: '600', color: INK },
  addressText: { fontSize: 12.5, lineHeight: 19, color: Colors.light.icon, marginTop: 2 },
  addAddress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.light.tint,
  },
  addAddressText: { fontSize: 13.5, fontWeight: '600', color: Colors.light.tint },

  line: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lineNext: { marginTop: 12 },
  lineImage: { width: 58, height: 66, borderRadius: 12, backgroundColor: Colors.light.border },
  lineName: { fontSize: 13.5, fontWeight: '500', color: INK },
  lineMeta: { fontSize: 12, color: Colors.light.icon, marginTop: 2 },
  linePrice: { fontSize: 14, fontWeight: '600', color: PRICE },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E4DCD1',
  },
  optionNeed: { borderColor: '#F1CFCB' },
  optionOn: { borderColor: Colors.light.tint, backgroundColor: '#FDF6F2' },
  optionTile: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  optionLetter: { fontSize: 13, fontWeight: '700', color: '#fff' },
  optionName: { fontSize: 13.5, fontWeight: '600', color: INK },
  optionLine: { fontSize: 11.5, color: Colors.light.icon, marginTop: 1 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#CFC6BC', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: Colors.light.tint },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.light.tint },
  note: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#F6EFE3',
  },
  noteText: { flex: 1, fontSize: 11.5, lineHeight: 17, color: NOTE_INK },

  sumRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  sumLabel: { fontSize: 13, color: Colors.light.icon },
  sumValue: { fontSize: 13, fontWeight: '500', color: INK },
  sumFree: { fontSize: 13, fontWeight: '600', color: Colors.light.secondary },
  sumTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderTopWidth: 1,
    borderTopColor: '#D8CFC4',
    borderStyle: 'dashed',
    paddingTop: 10,
  },
  sumTotalLabel: { fontSize: 14, fontWeight: '600', color: INK },
  sumTotalValue: { fontSize: 19, fontWeight: '600', color: PRICE },

  footer: {
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#E4DCD1',
    backgroundColor: 'rgba(250,247,242,0.97)',
  },
  footerMessage: { fontSize: 11.5, color: ERR, textAlign: 'center', marginBottom: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginHorizontal: 4, marginBottom: 10 },
  totalLabel: { fontSize: 13, color: Colors.light.icon },
  totalPrice: { fontSize: 20, fontWeight: '600', color: PRICE },
  place: { height: 54, borderRadius: 16, backgroundColor: Colors.light.tint, alignItems: 'center', justifyContent: 'center' },
  placeOff: { backgroundColor: '#E3C3B6' },
  placeText: { fontSize: 15.5, fontWeight: '600', color: '#fff' },
});
