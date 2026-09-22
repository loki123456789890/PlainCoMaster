import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  useReducedMotion,
  Easing,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { Colors, Spacing, Radius } from '../constants/theme';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import StarRating from '../components/ui/StarRating';
import ProductImage from '../components/ui/ProductImage';
import { REVIEWS_COLLECTION, mapReviewDoc, isOrderReviewable } from '../utils/reviews';
import { getPaymentLabel, getPaymentIcon, getPaymentStatus } from '../constants/payment';
import { formatOrderNumber } from '../utils/orderNumber';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

// "Pending" and "processing" share one visual status — an order is
// "processing" the moment it's placed, and CheckoutScreen always creates
// orders with status: 'pending'. Mirrors OrdersScreen's TABS grouping and
// AdminOrdersScreen's status vocabulary (including 'cancelled', which
// AdminOrdersScreen can set but this screen previously had no case for —
// it fell through to the same neutral gray as an unrecognized status).
const getStatusColor = (status) => {
  switch ((status || '').toLowerCase()) {
    case 'delivered': return Colors.light.success;
    case 'processing':
    case 'pending': return Colors.light.highlight;
    case 'shipped': return Colors.light.tint;
    case 'cancelled': return Colors.light.danger;
    default: return Colors.light.icon;
  }
};

const getStatusIcon = (status) => {
  switch ((status || '').toLowerCase()) {
    case 'delivered': return 'checkmark-circle-outline';
    case 'processing':
    case 'pending': return 'time-outline';
    case 'shipped': return 'car-outline';
    case 'cancelled': return 'close-circle-outline';
    default: return 'ellipse-outline';
  }
};

const getStatusReassurance = (status) => {
  switch ((status || '').toLowerCase()) {
    case 'delivered': return 'Delivered — we hope you love it.';
    case 'shipped': return "It's on its way to you.";
    case 'processing':
    case 'pending': return "We're getting your order ready.";
    case 'cancelled': return 'This order was cancelled.';
    default: return 'Tracking this order for you.';
  }
};

// Three-stage journey shown as a timeline — mirrors OrdersScreen's own
// "Processing / Shipped / Delivered" tab labels so the two screens describe
// an order's lifecycle with the same three words. Cancelled orders skip the
// timeline entirely (see CancelledNote below); a cancelled order was never
// going to reach "Delivered", so a progress bar frozen mid-way would read
// as "still coming" instead of "stopped".
const TIMELINE_STEPS = [
  { key: 'processing', label: 'Processing' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
];

const getTimelineStepIndex = (status) => {
  switch ((status || '').toLowerCase()) {
    case 'shipped': return 1;
    case 'delivered': return 2;
    default: return 0;
  }
};


// Horizontal Processing -> Shipped -> Delivered progress. Reached steps
// fill with the order's status color; the current step gets a soft ring;
// upcoming steps stay outlined in Line. Connector fill uses opacity, not an
// animated width, so nothing here animates a layout-driving property.
function StatusTimeline({ currentIndex, statusColor, reduceMotion }) {
  return (
    <Animated.View
      style={styles.timelineWrap}
      entering={reduceMotion ? undefined : FadeIn.duration(220).delay(80).easing(EASE_OUT_QUART)}
    >
      <View style={styles.timelineRow}>
        {TIMELINE_STEPS.map((step, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isReached = index <= currentIndex;
          return (
            <React.Fragment key={step.key}>
              {index > 0 && (
                <View style={styles.timelineConnector}>
                  <View
                    style={[
                      styles.timelineConnectorFill,
                      { backgroundColor: statusColor, opacity: isReached ? 1 : 0 },
                    ]}
                  />
                </View>
              )}
              <View
                style={[
                  styles.timelineCircle,
                  isReached && { backgroundColor: statusColor, borderColor: statusColor },
                  isCurrent && !isComplete && styles.timelineCircleCurrent,
                ]}
              >
                {isComplete ? (
                  <Ionicons name="checkmark" size={13} color="#fff" />
                ) : isCurrent ? (
                  <View style={styles.timelineDot} />
                ) : null}
              </View>
            </React.Fragment>
          );
        })}
      </View>
      <View style={styles.timelineLabelsRow}>
        {TIMELINE_STEPS.map((step, index) => (
          <Text
            key={step.key}
            style={[styles.timelineLabel, index <= currentIndex && styles.timelineLabelActive]}
          >
            {step.label}
          </Text>
        ))}
      </View>
    </Animated.View>
  );
}

export default function OrderDetailsScreen({ navigation, route }) {
  const { order } = route.params || {};
  const items = order?.items || [];
  const reduceMotion = useReducedMotion();

  const statusColor = getStatusColor(order?.status);
  const isCancelled = (order?.status || '').toLowerCase() === 'cancelled';

  // A quiet "arrived" pulse on the status icon for delivered orders only —
  // same withSequence scale settle Checkoutscreen.js gives its footer total
  // when it changes, reused here as the one moment on this screen that
  // earns a little extra emphasis. Skipped under Reduce Motion.
  const heroIconScale = useSharedValue(1);
  const heroIconAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heroIconScale.value }],
  }));
  useEffect(() => {
    if (reduceMotion || !order) return;
    if ((order.status || '').toLowerCase() === 'delivered') {
      heroIconScale.value = withSequence(
        withTiming(1.12, { duration: 140, easing: EASE_OUT_QUINT }),
        withTiming(1, { duration: 220, easing: EASE_OUT_QUART })
      );
    }
  }, [order?.status]);

  // Reviews this customer has already written against this order, keyed by
  // product id, so each line can offer "Write a review" or "Edit your
  // review" rather than a single guess for the whole order.
  //
  // A one-shot read rather than a live listener, re-run on focus: the only
  // thing that changes this map is the customer coming back from
  // WriteReviewScreen, and a permanent subscription for a fact that changes
  // once per visit is a listener held open on mobile data for nothing.
  const [reviewsByProductId, setReviewsByProductId] = useState({});

  useEffect(() => {
    const orderId = order?.id;
    if (!orderId || !isOrderReviewable(order) || !auth.currentUser) return undefined;

    let cancelled = false;

    const load = async () => {
      try {
        const snapshot = await getDocs(
          query(collection(db, REVIEWS_COLLECTION), where('orderId', '==', orderId))
        );
        if (cancelled) return;
        const byProduct = {};
        snapshot.docs.forEach((docSnap) => {
          const review = mapReviewDoc(docSnap);
          byProduct[review.productId] = review;
        });
        setReviewsByProductId(byProduct);
      } catch (error) {
        // Non-fatal by design: losing this read only means the row reads
        // "Write a review" when it could have said "Edit your review".
        // WriteReviewScreen loads the authoritative answer on open and
        // switches itself into edit mode, so nothing is lost or duplicated.
        console.error('Could not load reviews for this order:', error);
      }
    };

    load();
    const unsubscribeFocus = navigation.addListener('focus', load);
    return () => {
      cancelled = true;
      unsubscribeFocus();
    };
  }, [order?.id, order?.status, navigation]);

  const handleContactSupport = () => {
    navigation.navigate('Help');
  };

  const handleWriteReview = (item) => {
    Haptics.selectionAsync();
    navigation.navigate('WriteReview', { orderId: order.id, item });
  };

  if (!order) {
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
          <Text style={styles.headerTitle}>Order Details</Text>
          <View style={{ width: 40 }} />
        </View>
        <Animated.View
          style={styles.centerContainer}
          entering={reduceMotion ? undefined : FadeIn.duration(220)}
        >
          <EmptyState
            icon="receipt-outline"
            title="Order not found"
            subtitle="This order may have been removed or the link is no longer valid."
          />
          <View style={styles.emptyActionWrap}>
            <Button variant="secondary" label="Back to Orders" onPress={() => navigation.navigate('Orders')} />
          </View>
        </Animated.View>
      </SafeAreaView>
    );
  }

  const statusLabel = (order.status || '').charAt(0).toUpperCase() + (order.status || '').slice(1);
  const timelineIndex = getTimelineStepIndex(order.status);
  // Exactly the lines firestore.rules will accept a review for: a delivered
  // order, and a product listed in that order's own productIds. Orders
  // placed before productIds existed yield an empty set and show no review
  // row at all — an absent button beats one that fails on submit.
  const canReviewThisOrder = isOrderReviewable(order);
  const reviewableProductIds = new Set(order.productIds || []);
  const shippingAddress = order.shippingAddress;
  const paymentMethod = order.paymentMethod;
  const paymentLabel = getPaymentLabel(paymentMethod);
  // "Paid via GCash" used to be printed for every online order, back when
  // selecting a method did nothing at all — it was the one sentence in
  // this screen that was not true. It is now read from the order's own
  // paymentStatus rather than assumed from the method, so an order that
  // was never charged cannot claim it was.
  const paymentTrustText = !paymentMethod
    ? ''
    : paymentMethod === 'cod'
      ? 'Pay when your order arrives — no online payment needed'
      : getPaymentStatus(order) === 'paid'
        ? `Paid via ${paymentLabel}`
        : `Not charged — ${paymentLabel} payment was not completed`;

  // Shown only where it is true, and stated plainly rather than softened.
  // An order carrying a simulated authorisation must say so on the screen
  // a customer or a Store Manager would point at as proof of payment.
  const sandboxNote = order.paymentSandbox
    ? `Sandbox payment${order.paymentRef ? ` · ${order.paymentRef}` : ''} — simulated, no real money moved`
    : '';

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
        <Text style={styles.headerTitle}>Order Details</Text>
        <TouchableOpacity
          onPress={handleContactSupport}
          style={styles.headerAction}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Get help with this order"
        >
          <Ionicons name="help-circle-outline" size={24} color={Colors.light.tint} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Order Status */}
        <Text style={styles.sectionTitle}>Order Status</Text>
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(220).easing(EASE_OUT_QUART)}
          accessible
          accessibilityLabel={`Order ${formatOrderNumber(order.id)}, status ${statusLabel}. ${getStatusReassurance(order.status)}`}
        >
          <Card variant="flat" style={styles.heroCard}>
            <View style={styles.heroTop}>
              <Animated.View
                style={[styles.heroIconCircle, { backgroundColor: statusColor + '15' }, heroIconAnimatedStyle]}
              >
                <Ionicons name={getStatusIcon(order.status)} size={26} color={statusColor} />
              </Animated.View>
              <View style={styles.heroTextWrap}>
                <Text style={[styles.heroStatusLabel, { color: statusColor }]}>{statusLabel}</Text>
                <Text style={styles.heroStatusSubtitle}>{getStatusReassurance(order.status)}</Text>
              </View>
            </View>

            {isCancelled ? (
              <View style={styles.cancelledNote}>
                <Text style={styles.cancelledNoteText}>
                  If you have questions about this order, our support team can help.
                </Text>
              </View>
            ) : (
              <StatusTimeline currentIndex={timelineIndex} statusColor={statusColor} reduceMotion={reduceMotion} />
            )}

            <View style={styles.heroDivider} />
            <View style={styles.heroMetaRow}>
              <View>
                <Text style={styles.heroMetaLabel}>Order #</Text>
                <Text style={styles.heroMetaValue}>{formatOrderNumber(order.id)}</Text>
              </View>
              <View style={styles.heroMetaRight}>
                <Text style={styles.heroMetaLabel}>Date placed</Text>
                <Text style={styles.heroMetaValue}>{order.date}</Text>
              </View>
            </View>
          </Card>
        </Animated.View>

        {/* Items */}
        <Text style={styles.sectionTitle}>Items ({items.length})</Text>
        {items.length === 0 ? (
          <Text style={styles.emptyItemsText}>No item details available for this order.</Text>
        ) : (
          items.map((item, index) => {
            const existingReview = reviewsByProductId[item.productId];
            const showReviewRow =
              canReviewThisOrder && item.productId && reviewableProductIds.has(item.productId);

            return (
              <Animated.View
                key={index}
                entering={reduceMotion ? undefined : FadeInDown.delay(Math.min(index, 8) * 40).duration(220).easing(EASE_OUT_QUART)}
              >
                <Card variant="flat" style={styles.itemCard}>
                  {/* The line itself stays one accessible unit; the review
                      row below is a separate control, so it must not be
                      swallowed into the same accessible container. */}
                  <View
                    style={styles.itemRow}
                    accessible
                    accessibilityLabel={`${item.name}${item.size ? `, size ${item.size}` : ''}${item.color ? `, color ${item.color}` : ''}, quantity ${item.quantity || 1}, ₱${(Number(item.price) * (item.quantity || 1)).toFixed(2)}`}
                  >
                    {item.image ? (
                      <ProductImage uri={item.image} style={styles.itemImage} />
                    ) : (
                      <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                        <Ionicons name="shirt-outline" size={24} color={Colors.light.icon} />
                      </View>
                    )}
                    <View style={styles.itemDetails}>
                      <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                      <Text style={styles.itemSpecs}>
                        {item.size ? `Size: ${item.size}` : ''}
                        {item.size && item.color ? '  ·  ' : ''}
                        {item.color ? `Color: ${item.color}` : ''}
                      </Text>
                      <Text style={styles.itemQty}>Qty: {item.quantity || 1}</Text>
                    </View>
                    <Text style={styles.itemPrice}>
                      ₱{(Number(item.price) * (item.quantity || 1)).toFixed(2)}
                    </Text>
                  </View>

                  {/* Asking for the review here, on the delivered order,
                      rather than in a push or an email: this is the one
                      screen a customer opens already holding the item. */}
                  {showReviewRow && (
                    <AnimatedPressable
                      style={styles.reviewRow}
                      onPress={() => handleWriteReview(item)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        existingReview
                          ? `Edit your ${existingReview.rating}-star review of ${item.name}`
                          : `Write a review of ${item.name}`
                      }
                    >
                      <Ionicons
                        name={existingReview ? 'create-outline' : 'star-outline'}
                        size={16}
                        color={Colors.light.tint}
                      />
                      <Text style={styles.reviewRowText}>
                        {existingReview ? 'Edit your review' : 'Write a review'}
                      </Text>
                      {existingReview ? (
                        <StarRating rating={existingReview.rating} size={13} />
                      ) : (
                        <Ionicons name="chevron-forward" size={16} color={Colors.light.icon} />
                      )}
                    </AnimatedPressable>
                  )}
                </Card>
              </Animated.View>
            );
          })
        )}

        {/* Delivery Address */}
        <Text style={styles.sectionTitle}>Delivery Address</Text>
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(220).delay(60).easing(EASE_OUT_QUART)}>
          <Card variant="flat" style={styles.addressCard}>
            <Ionicons
              name="location-outline"
              size={20}
              color={shippingAddress ? Colors.light.tint : Colors.light.icon}
            />
            {shippingAddress ? (
              <View style={styles.addressTextWrap}>
                <Text style={styles.addressName}>
                  {shippingAddress.fullName} · {shippingAddress.phone}
                </Text>
                <Text style={styles.addressDetail}>
                  {shippingAddress.address}, {shippingAddress.city}, {shippingAddress.province} {shippingAddress.zipCode}
                </Text>
              </View>
            ) : (
              <Text style={styles.addressMissingText}>Address not available for this order.</Text>
            )}
          </Card>
        </Animated.View>

        {/* Payment Method */}
        <Text style={styles.sectionTitle}>Payment Method</Text>
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(220).delay(80).easing(EASE_OUT_QUART)}>
          <Card variant="flat" style={styles.paymentCard}>
            <View style={[styles.paymentIconCircle, { backgroundColor: Colors.light.tint + '15' }]}>
              <Ionicons name={getPaymentIcon(paymentMethod)} size={18} color={Colors.light.tint} />
            </View>
            <View style={styles.paymentTextWrap}>
              <Text style={styles.paymentLabel}>{paymentLabel}</Text>
              {paymentTrustText ? <Text style={styles.paymentTrustText}>{paymentTrustText}</Text> : null}
              {sandboxNote ? <Text style={styles.sandboxNote}>{sandboxNote}</Text> : null}
            </View>
          </Card>
        </Animated.View>

        {/* Order Summary */}
        <Text style={styles.sectionTitle}>Order Summary</Text>
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(220).delay(100).easing(EASE_OUT_QUART)}>
          <Card variant="flat" style={styles.summaryCard}>
            <View style={styles.row}>
              <Text style={styles.label}>Subtotal</Text>
              <Text style={styles.value}>₱{Number(order.subtotal || order.total).toFixed(2)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Shipping</Text>
              {order.shipping ? (
                <Text style={styles.value}>₱{Number(order.shipping).toFixed(2)}</Text>
              ) : (
                <Text style={styles.valueMoss}>Free</Text>
              )}
            </View>
            <View style={[styles.row, styles.totalRow]}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>₱{Number(order.total).toFixed(2)}</Text>
            </View>
          </Card>
        </Animated.View>

        {/* Support */}
        <Animated.View
          style={styles.supportWrap}
          entering={reduceMotion ? undefined : FadeIn.duration(220).delay(120).easing(EASE_OUT_QUART)}
        >
          <Button variant="secondary" label="Need Help? Contact Support" onPress={handleContactSupport} />
        </Animated.View>
      </ScrollView>
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
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text },
  headerAction: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-end' },
  content: { padding: 20, paddingBottom: 40 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: Colors.light.text, marginBottom: 12 },

  // Order Status hero card
  heroCard: { marginBottom: 24 },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  heroIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroTextWrap: { flex: 1, marginLeft: 14 },
  heroStatusLabel: { fontSize: 18, fontWeight: '700', marginBottom: 2 },
  heroStatusSubtitle: { fontSize: 13, color: Colors.light.icon },
  heroDivider: { height: 1, backgroundColor: Colors.light.border, marginTop: 16, marginBottom: 12 },
  heroMetaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  heroMetaRight: { alignItems: 'flex-end' },
  heroMetaLabel: { fontSize: 11, color: Colors.light.icon, marginBottom: 2 },
  heroMetaValue: { fontSize: 13, fontWeight: '600', color: Colors.light.text },

  cancelledNote: {
    marginTop: 16,
    backgroundColor: Colors.light.danger + '10',
    borderRadius: Radius.sm,
    padding: 12,
  },
  cancelledNoteText: { fontSize: 12, color: Colors.light.danger, lineHeight: 17 },

  // Status timeline
  timelineWrap: { marginTop: 18 },
  timelineRow: { flexDirection: 'row', alignItems: 'center' },
  timelineConnector: {
    flex: 1,
    height: 2,
    backgroundColor: Colors.light.border,
    marginHorizontal: 4,
    overflow: 'hidden',
  },
  timelineConnectorFill: { flex: 1, height: 2 },
  timelineCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timelineCircleCurrent: { backgroundColor: Colors.light.background },
  timelineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.light.tint },
  timelineLabelsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  timelineLabel: { fontSize: 11, color: Colors.light.icon, fontWeight: '500', width: 70, textAlign: 'center' },
  timelineLabelActive: { color: Colors.light.text, fontWeight: '600' },

  emptyItemsText: { fontSize: 13, color: Colors.light.icon, marginBottom: 20 },
  // The card is now a column (line, then optional review row); the
  // horizontal layout it used to own moved down to itemRow.
  itemCard: {
    padding: 12,
    marginBottom: 12,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // A quiet in-card row, not a Button: asking for a review should not
  // compete with "Contact Support" at the bottom of the screen, and Clay is
  // spent here on the text rather than on a filled block.
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  reviewRowText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.light.tint },
  itemImage: { width: 60, height: 60, borderRadius: 8, backgroundColor: Colors.light.border },
  itemImagePlaceholder: { justifyContent: 'center', alignItems: 'center' },
  itemDetails: { flex: 1, marginLeft: 12 },
  itemName: { fontSize: 14, fontWeight: '600', color: Colors.light.text, marginBottom: 2 },
  itemSpecs: { fontSize: 12, color: Colors.light.icon, marginBottom: 2 },
  itemQty: { fontSize: 12, color: Colors.light.icon },
  itemPrice: { fontSize: 14, fontWeight: '700', color: Colors.light.text },

  // Delivery Address
  addressCard: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  addressTextWrap: { flex: 1, marginLeft: 12 },
  addressName: { fontSize: 14, fontWeight: '600', color: Colors.light.text, marginBottom: 4 },
  addressDetail: { fontSize: 12, color: Colors.light.icon, lineHeight: 18 },
  addressMissingText: { flex: 1, marginLeft: 12, fontSize: 13, color: Colors.light.icon },

  // Payment Method
  paymentCard: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  paymentIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  paymentTextWrap: { flex: 1, marginLeft: 12 },
  paymentLabel: { fontSize: 14, fontWeight: '600', color: Colors.light.text, marginBottom: 2 },
  paymentTrustText: { fontSize: 12, color: Colors.light.icon },
  // Gold, the money colour, and the only place it earns its reservation
  // outside a price — this line is about the money not having moved.
  sandboxNote: { fontSize: 11, color: Colors.light.highlight, marginTop: 2 },

  // Order Summary
  summaryCard: { marginBottom: 24 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  totalRow: { borderTopWidth: 1, borderTopColor: Colors.light.border, marginTop: 8, paddingTop: 12 },
  label: { fontSize: 14, color: Colors.light.icon },
  value: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  valueMoss: { fontSize: 14, fontWeight: 'bold', color: Colors.light.secondary },
  totalLabel: { fontSize: 16, fontWeight: 'bold', color: Colors.light.text },
  totalValue: { fontSize: 16, fontWeight: 'bold', color: Colors.light.highlight },

  supportWrap: { marginTop: 4 },

  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyActionWrap: { marginTop: Spacing.md, width: 200, alignSelf: 'center' },
});
