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
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  useReducedMotion,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';

import { Colors, Spacing, Radius } from '../constants/theme';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';
import { getPaymentLabel, getPaymentIcon, isPayOnDelivery, getPaymentStatusLabel } from '../constants/payment';
import { formatOrderNumber } from '../utils/orderNumber';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import ProductImage from '../components/ui/ProductImage';


// The one moment on this screen that earns motion: a single settle on the
// success mark. Not a celebration — PRODUCT.md rules out flash-sale
// grammar, and a COD order is a promise to pay a rider later, not a
// completed transaction to throw confetti at.
function SuccessMark({ reduceMotion }) {
  const scale = useSharedValue(reduceMotion ? 1 : 0.8);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  React.useEffect(() => {
    if (reduceMotion) return;
    scale.value = withSequence(
      withTiming(1.08, { duration: 220, easing: EASE_OUT_QUINT }),
      withTiming(1, { duration: 180, easing: EASE_OUT_QUART })
    );
  }, [reduceMotion, scale]);

  return (
    <Animated.View style={[styles.successCircle, animatedStyle]}>
      <Ionicons name="checkmark" size={34} color="#fff" />
    </Animated.View>
  );
}

export default function OrderConfirmationScreen({ navigation, route }) {
  const order = route.params?.order;
  const reduceMotion = useReducedMotion();

  // Reachable only by placing an order, so an absent param means a stale
  // deep link or a malformed nav call rather than a state a customer can
  // get into by using the app. Same treatment OrderDetailsScreen gives the
  // same situation.
  if (!order) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContainer}>
          <EmptyState
            icon="receipt-outline"
            title="Nothing to show here"
            subtitle="This confirmation is no longer available. Your orders are all listed under My Orders."
          />
          <View style={styles.emptyActionWrap}>
            <Button variant="primary" label="View My Orders" onPress={() => navigation.navigate('Orders')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const items = order.items || [];
  const payOnDelivery = isPayOnDelivery(order.paymentMethod);
  const address = order.shippingAddress;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <Animated.View
          style={styles.hero}
          entering={reduceMotion ? undefined : FadeIn.duration(240).easing(EASE_OUT_QUART)}
        >
          <SuccessMark reduceMotion={reduceMotion} />
          <Text style={styles.heroTitle}>Order placed</Text>
          <Text style={styles.heroSubtitle}>
            Thanks — we&apos;re getting it ready for you.
          </Text>
        </Animated.View>

        {/* The order number leads, because it is the reason this screen
            exists. Selectable so it can be copied into a support message
            rather than transcribed by hand. */}
        <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(240).delay(60).easing(EASE_OUT_QUART)}>
          <Card variant="flat" style={styles.orderNumberCard}>
            <Text style={styles.orderNumberLabel}>Your order number</Text>
            <Text style={styles.orderNumberValue} selectable>
              {formatOrderNumber(order.orderId)}
            </Text>
            <Text style={styles.orderNumberHint}>
              Keep this if you need to ask us about the order.
            </Text>
          </Card>
        </Animated.View>

        {/* What happens next, stated plainly rather than as a progress
            graphic — OrderDetailsScreen already owns the timeline, and
            duplicating it here would imply this order has moved when it
            has not. */}
        <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(240).delay(100).easing(EASE_OUT_QUART)}>
          <Card variant="flat" style={styles.nextCard}>
            <Text style={styles.sectionTitle}>What happens next</Text>
            <View style={styles.nextRow}>
              <Ionicons name="cube-outline" size={16} color={Colors.light.icon} />
              <Text style={styles.nextText}>We pack your order and hand it to a courier.</Text>
            </View>
            <View style={styles.nextRow}>
              <Ionicons name="car-outline" size={16} color={Colors.light.icon} />
              <Text style={styles.nextText}>
                Metro Manila usually takes 1–3 days, provincial 3–7.
              </Text>
            </View>
            <View style={styles.nextRow}>
              <Ionicons
                name={payOnDelivery ? 'cash-outline' : 'checkmark-circle-outline'}
                size={16}
                color={payOnDelivery ? Colors.light.secondary : Colors.light.icon}
              />
              <Text style={styles.nextText}>
                {payOnDelivery
                  ? 'You pay the rider when it arrives — nothing is charged now.'
                  : 'You can follow the order status under My Orders.'}
              </Text>
            </View>
          </Card>
        </Animated.View>

        {/* Items */}
        <Text style={styles.sectionHeading}>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </Text>
        {items.map((item, index) => (
          <View key={`${item.productId || 'item'}-${index}`} style={styles.itemRow}>
            {item.image ? (
              <ProductImage uri={item.image} style={styles.itemImage} />
            ) : (
              <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                <Ionicons name="shirt-outline" size={20} color={Colors.light.icon} />
              </View>
            )}
            <View style={styles.itemDetails}>
              <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.itemMeta}>
                {[item.size, item.color].filter(Boolean).join(' · ')}
                {item.size || item.color ? ' · ' : ''}Qty {item.quantity || 1}
              </Text>
            </View>
            <Text style={styles.itemPrice}>
              ₱{(Number(item.price) * (item.quantity || 1)).toFixed(2)}
            </Text>
          </View>
        ))}

        {/* Summary. Gold on the total only — DESIGN.md reserves it for
            money, and using it on every row would spend the emphasis. */}
        <Card variant="flat" style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal</Text>
            <Text style={styles.summaryValue}>₱{Number(order.subtotal || 0).toFixed(2)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Shipping</Text>
            <Text style={styles.summaryValueMoss}>
              {Number(order.shipping || 0) === 0 ? 'Free' : `₱${Number(order.shipping).toFixed(2)}`}
            </Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              {payOnDelivery ? 'To pay on delivery' : 'Total'}
            </Text>
            <Text style={styles.totalValue}>₱{Number(order.total || 0).toFixed(2)}</Text>
          </View>
        </Card>

        {/* Delivery address */}
        {address ? (
          <>
            <Text style={styles.sectionHeading}>Delivering to</Text>
            <Card variant="flat" style={styles.addressCard}>
              <Text style={styles.addressName}>{address.fullName}</Text>
              <Text style={styles.addressLine}>{address.phone}</Text>
              <Text style={styles.addressLine}>
                {[address.address, address.city, address.province, address.zipCode]
                  .filter(Boolean)
                  .join(', ')}
              </Text>
            </Card>
          </>
        ) : null}

        {/* Payment */}
        <Text style={styles.sectionHeading}>Payment</Text>
        <Card variant="flat" style={styles.paymentCard}>
          <Ionicons name={getPaymentIcon(order.paymentMethod)} size={18} color={Colors.light.tint} />
          <View style={{ flex: 1 }}>
            <Text style={styles.paymentLabel}>
              {getPaymentLabel(order.paymentMethod)} · {getPaymentStatusLabel(order)}
            </Text>
            {order.paymentSandbox ? (
              <Text style={styles.sandboxNote}>
                Sandbox payment{order.paymentRef ? ` · ${order.paymentRef}` : ''} — simulated, no real money moved
              </Text>
            ) : null}
          </View>
        </Card>

        <View style={styles.actions}>
          <Button
            variant="primary"
            label="View My Orders"
            fullWidth
            onPress={() => navigation.navigate('Orders')}
          />
          <View style={styles.secondaryActionWrap}>
            <Button
              variant="secondary"
              label="Continue Shopping"
              fullWidth
              onPress={() => navigation.navigate('Shop')}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  centerContainer: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.lg },
  emptyActionWrap: { marginTop: Spacing.md },

  hero: { alignItems: 'center', paddingVertical: Spacing.lg },
  // Moss, which DESIGN.md doubles as the success color. Deliberately not
  // Clay: Clay is for actions, and nothing here is being asked of anyone.
  successCircle: {
    width: 64,
    height: 64,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  heroTitle: { fontSize: 24, fontWeight: '700', color: Colors.light.text },
  heroSubtitle: { fontSize: 15, color: Colors.light.icon, marginTop: Spacing.xs },

  orderNumberCard: { alignItems: 'center', marginBottom: Spacing.md },
  orderNumberLabel: { fontSize: 12, color: Colors.light.icon },
  orderNumberValue: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.light.text,
    letterSpacing: 1,
    marginVertical: Spacing.xs,
  },
  orderNumberHint: { fontSize: 12, color: Colors.light.icon, textAlign: 'center' },

  nextCard: { marginBottom: Spacing.md, gap: Spacing.sm },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: Colors.light.text },
  nextRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  nextText: { flex: 1, fontSize: 13, color: Colors.light.icon, lineHeight: 19 },

  sectionHeading: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.light.text,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  itemImage: { width: 54, height: 54, borderRadius: Radius.md, backgroundColor: Colors.light.border },
  itemImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  itemDetails: { flex: 1 },
  itemName: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  itemMeta: { fontSize: 12, color: Colors.light.icon, marginTop: 2 },
  itemPrice: { fontSize: 14, fontWeight: '600', color: Colors.light.text },

  summaryCard: { marginBottom: Spacing.md },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.xs },
  summaryLabel: { fontSize: 13, color: Colors.light.icon },
  summaryValue: { fontSize: 13, color: Colors.light.text },
  summaryValueMoss: { fontSize: 13, fontWeight: '600', color: Colors.light.secondary },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  totalLabel: { fontSize: 15, fontWeight: '600', color: Colors.light.text },
  totalValue: { fontSize: 19, fontWeight: '700', color: Colors.light.highlight },

  addressCard: { marginBottom: Spacing.md },
  addressName: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  addressLine: { fontSize: 13, color: Colors.light.icon, marginTop: 2, lineHeight: 19 },

  paymentCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg },
  paymentLabel: { fontSize: 14, color: Colors.light.text },
  sandboxNote: { fontSize: 11, color: Colors.light.highlight, marginTop: 2 },

  actions: { marginTop: Spacing.sm },
  secondaryActionWrap: { marginTop: Spacing.sm },
});
