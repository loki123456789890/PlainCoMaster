// screens/OrderConfirmationScreen.js
//
// The receipt a customer sees the moment an order goes through.
//
// Checkout used to end on showAppAlert('Order Placed', ...) followed by
// navigate('Home'), which meant the order number — the one string a
// customer needs to talk to support about this purchase, and the string
// OrderDetailsScreen and AdminOrdersScreen both identify it by — was
// never shown at the moment they would write it down. PRODUCT.md names
// trust in the transaction as the thing that matters most for a
// COD-first audience; ending the most consequential moment in the app on
// a dismissed modal was the weakest point in that story.
//
// Everything rendered here arrives through navigation params rather than
// a fresh read. The order was just written and the client already holds
// every field; re-fetching would spend a read to display data it has, and
// would race the serverTimestamp that has not resolved locally yet. Which
// is also why no date is shown — "just now" is the only honest answer at
// this instant, and OrdersScreen shows the real one once the server
// stamps it.
//
// In the approved product-details/checkout preview's design: a moss tile
// whose tick draws itself in, the order number(s), status, payment and
// total on one card, and two ways on. What was bought and where it goes
// are one tap away in My Orders.
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withDelay,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Colors } from '../constants/theme';
import { EASE_OUT_QUINT } from '../constants/motion';
import { getPaymentLabel, isPayOnDelivery } from '../constants/payment';
import { formatOrderNumber } from '../utils/orderNumber';
import Reveal from '../components/shop/Reveal';
import { BigEmpty } from '../components/shop/TabScreen';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const INK = Colors.light.text;
const MOSS = Colors.light.secondary;
const PRICE = '#8C6D0C';

// The one moment on this screen that earns motion: the tile settles in
// and its tick draws. Not a celebration — a COD order is a promise to pay
// a rider later, not a completed transaction to throw confetti at.
function SuccessTile({ reduceMotion }) {
  const pop = useSharedValue(reduceMotion ? 1 : 0);
  const draw = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    pop.value = withDelay(150, withTiming(1, { duration: 600, easing: EASE_OUT_QUINT }));
    draw.value = withDelay(450, withTiming(1, { duration: 500, easing: EASE_OUT_QUINT }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const tile = useAnimatedStyle(() => ({ opacity: pop.value, transform: [{ scale: 0.5 + pop.value * 0.5 }] }));
  const tick = useAnimatedProps(() => ({ strokeDashoffset: 40 * (1 - draw.value) }));
  return (
    <Animated.View style={[styles.tile, tile]}>
      <Svg width={46} height={46} viewBox="0 0 24 24">
        <AnimatedPath
          d="M5 12.5l4.5 4.5L19 7.5"
          stroke={MOSS}
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={40}
          animatedProps={tick}
        />
      </Svg>
    </Animated.View>
  );
}

function Row({ label, children }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {children}
    </View>
  );
}

export default function OrderConfirmationScreen({ navigation, route }) {
  const order = route.params?.order;
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();

  // Reachable only by placing an order, so an absent param means a stale
  // deep link or a malformed nav call.
  if (!order) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 40 }]}>
        <BigEmpty
          icon="receipt-outline"
          title="Nothing to show here"
          text="This confirmation is no longer available. Your orders are all listed under My Orders."
          actionLabel="View My Orders"
          onAction={() => navigation.navigate('Orders')}
        />
      </View>
    );
  }

  // One checkout can produce several orders — one per store in the cart,
  // each with its own number (see placeOrder). The fallback shape covers a
  // result from before the split, which carried a single orderId.
  const placedOrders =
    Array.isArray(order.orders) && order.orders.length > 0
      ? order.orders
      : [{ orderId: order.orderId, items: order.items || [] }];
  const split = placedOrders.length > 1;
  const payOnDelivery = isPayOnDelivery(order.paymentMethod);
  const storeName = placedOrders[0]?.storeName;
  // An online payment the sandbox approved: the payment/orders preview's
  // "Payment successful" wording, with the Paid status beside it. A COD
  // order has nothing paid yet, so it keeps "Order placed!".
  const paid = order.paymentStatus === 'paid';

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 40, paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
      showsVerticalScrollIndicator={false}
    >
      <SuccessTile reduceMotion={reduceMotion} />
      <Reveal delay={350}>
        <Text style={styles.title} accessibilityRole="header">
          {paid ? 'Payment successful' : split ? 'Orders placed!' : 'Order placed!'}
        </Text>
      </Reveal>
      <Reveal delay={430}>
        <Text style={styles.text}>
          {split
            ? `Your cart came from ${placedOrders.length} stores, so it ships as ${placedOrders.length} orders. We'll show updates in My Orders as each is prepared and shipped.`
            : paid
            ? `Your order is on its way to ${storeName || 'the store'}. You can follow it in My Orders.`
            : `${storeName || 'The store'} has your order. We'll show updates in My Orders as it's prepared and shipped.`}
        </Text>
      </Reveal>

      {/* The order number leads, because it is the reason this screen
          exists. Selectable so it can be copied into a support message. */}
      <Reveal delay={510} style={styles.card}>
        {placedOrders.map((placed) => (
          <Row key={placed.orderId} label={split && placed.storeName ? placed.storeName : 'Order no.'}>
            <Text style={styles.rowValue} selectable>
              {formatOrderNumber(placed.orderId)}
            </Text>
          </Row>
        ))}
        {paid ? (
          <>
            <Row label="Paid with">
              <Text style={styles.rowValue}>
                {getPaymentLabel(order.paymentMethod)}
                {order.paymentSandbox ? ' (test)' : ''}
              </Text>
            </Row>
            <Row label="Payment">
              <Text style={[styles.pill, styles.pillPaid]}>Paid</Text>
            </Row>
          </>
        ) : (
          <>
            <Row label="Status">
              <Text style={styles.pill}>Processing</Text>
            </Row>
            <Row label="Payment">
              <Text style={styles.rowValue}>
                {getPaymentLabel(order.paymentMethod)}
                {order.paymentSandbox ? ' (test)' : ''}
              </Text>
            </Row>
          </>
        )}
        <Row label={payOnDelivery ? 'To pay on delivery' : paid ? 'Amount' : 'Total'}>
          <Text style={[styles.rowValue, { color: PRICE }]}>₱{Number(order.total || 0).toFixed(2)}</Text>
        </Row>
      </Reveal>

      <Reveal delay={590} style={styles.full}>
        <Pressable
          onPress={() => navigation.navigate('Orders')}
          style={({ pressed }) => [styles.button, styles.primary, pressed && { transform: [{ scale: 0.97 }] }]}
          accessibilityRole="button"
        >
          <Text style={[styles.buttonText, { color: '#fff' }]}>View My Orders</Text>
        </Pressable>
      </Reveal>
      <Reveal delay={650} style={styles.full}>
        <Pressable
          onPress={() => navigation.navigate('Shop')}
          style={({ pressed }) => [styles.button, styles.secondary, pressed && { transform: [{ scale: 0.97 }] }]}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Continue shopping</Text>
        </Pressable>
      </Reveal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  tile: { width: 96, height: 96, borderRadius: 30, backgroundColor: '#EEF0EA', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title: { fontSize: 24, fontWeight: '600', letterSpacing: -0.5, color: INK, textAlign: 'center', marginBottom: 6 },
  text: { fontSize: 13.5, lineHeight: 21, color: Colors.light.icon, textAlign: 'center', marginBottom: 20 },
  card: {
    alignSelf: 'stretch',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EEE7DD',
    borderRadius: 18,
    paddingVertical: 9,
    paddingHorizontal: 16,
    marginBottom: 22,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 5 },
  rowLabel: { flexShrink: 1, fontSize: 13, color: Colors.light.icon },
  rowValue: { fontSize: 13, fontWeight: '600', color: INK },
  pill: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B5A2E',
    backgroundColor: '#F6EFE3',
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  pillPaid: { color: '#37412F', backgroundColor: '#EEF0EA' },
  full: { alignSelf: 'stretch', marginBottom: 10 },
  button: { height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: Colors.light.tint },
  secondary: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E4DCD1' },
  buttonText: { fontSize: 15.5, fontWeight: '600', color: INK },
});
