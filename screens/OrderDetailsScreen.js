// screens/OrderDetailsScreen.js
//
// Order details, from the approved orders-and-chat preview: the order as a
// clothing tag (status, a four-step tracker, the order number with a copy
// button and the date placed), then the seller with a Message button, the
// items, where it's going, how it was paid, the receipt and a way to
// support.
import React, { useEffect, useRef, useState } from 'react';
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
  withRepeat,
  cancelAnimation,
  useReducedMotion,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { Colors, Spacing, Radius } from '../constants/theme';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import StarRating from '../components/ui/StarRating';
import ProductImage from '../components/ui/ProductImage';
import StoreLogo from '../components/shop/StoreLogo';
import { useStores } from '../context/StoreContext';
import { REVIEWS_COLLECTION, mapReviewDoc, isOrderReviewable } from '../utils/reviews';
import { getPaymentLabel, getPaymentIcon, getPaymentStatus, getPaymentNote } from '../constants/payment';
import { formatOrderNumber } from '../utils/orderNumber';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';
import { orderRef, chatFields, hasUnread } from '../utils/orderChat';

// The same four steps the Store Manager moves an order through
// (AdminOrdersScreen's STATUS_SEQUENCE), so the two sides never disagree
// on how far along it is. The first reads "Placed" here: to a buyer,
// "Pending" sounds like something is stuck. Cancelled orders skip the
// tracker; a bar frozen mid-way would read as "still coming".
const STEPS = [
  { key: 'pending', label: 'Placed' },
  { key: 'processing', label: 'Processing' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
];

const stepIndex = (status) => Math.max(0, STEPS.findIndex((s) => s.key === status));

// The tag's colour: Clay while the order is moving, Moss (success) once
// it arrives, Rust if it was cancelled.
const tagColor = (status) => {
  if (status === 'delivered') return Colors.light.success;
  if (status === 'cancelled') return Colors.light.danger;
  return Colors.light.tint;
};

const headline = (status) => {
  switch (status) {
    case 'pending': return 'Order placed';
    case 'processing': return 'Being prepared';
    case 'shipped': return 'On its way';
    case 'delivered': return 'Delivered';
    case 'cancelled': return 'Cancelled';
    default: return 'Order placed';
  }
};

const reassurance = (status, storeName) => {
  const store = storeName || 'The store';
  switch (status) {
    case 'pending': return `${store} has your order.`;
    case 'processing': return `${store} is getting your order ready.`;
    case 'shipped': return "It's on its way to you.";
    case 'delivered': return 'Delivered. We hope you love it.';
    case 'cancelled': return 'This order was cancelled.';
    default: return 'Tracking this order for you.';
  }
};

// "Sep 22, 2026" -> "Sep 22", for the tracker's small date line.
const shortDate = (date) => (date ? String(date).split(',')[0] : '');

const peso = (n) => `₱${Number(n || 0).toFixed(2)}`;

// A dashed rule. RN draws a dashed border on one side only on iOS; a
// fully bordered box clipped to its top edge dashes on both platforms.
function DashedRule({ color, style }) {
  return (
    <View style={[styles.dashClip, style]}>
      <View style={[styles.dashBox, { borderColor: color }]} />
    </View>
  );
}

// The current step's dot breathes, unless Reduce Motion is on.
function NowDot({ color, reduceMotion }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) return undefined;
    scale.value = withRepeat(withTiming(0.6, { duration: 900 }), -1, true);
    return () => cancelAnimation(scale);
  }, [reduceMotion, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Animated.View style={[styles.nowInner, { backgroundColor: color }, style]} />;
}

// Four white dots joined by a line, on the tag: ticked when done, a ring
// and a breathing dot for the current step, faint for what's to come.
function Tracker({ index, color, placedDate, reduceMotion }) {
  return (
    <View style={styles.track}>
      {STEPS.map((step, i) => {
        const done = i < index;
        const now = i === index;
        const sub = i === 0 ? shortDate(placedDate) : now ? 'Now' : '';
        return (
          <View key={step.key} style={[styles.trackStep, !done && !now && styles.trackTodo]}>
            {i > 0 && <View style={[styles.trackLine, i <= index && styles.trackLineOn]} />}
            <View style={[styles.trackDot, (done || now) && styles.trackDotOn, now && styles.trackDotNow]}>
              {done ? <Ionicons name="checkmark" size={13} color={color} /> : null}
              {now ? <NowDot color={color} reduceMotion={reduceMotion} /> : null}
            </View>
            <Text style={styles.trackLabel}>{step.label}</Text>
            {sub ? <Text style={styles.trackSub}>{sub}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function SectionTitle({ children }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export default function OrderDetailsScreen({ navigation, route }) {
  const { order } = route.params || {};
  const items = order?.items || [];
  const reduceMotion = useReducedMotion();
  const { getStore } = useStores();
  const store = order?.storeId ? getStore(order.storeId) : null;

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

  // The order passed in is a snapshot from the list. The order document is
  // watched live, so the unread badge appears while this screen is open
  // (and clears on the way back from the chat), and the tag moves on when
  // the store marks the order shipped.
  const [chat, setChat] = useState(() => (order ? chatFields(order) : null));
  const [liveStatus, setLiveStatus] = useState(null);
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!order?.id || !uid) return undefined;
    return onSnapshot(
      orderRef(uid, order.id),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        setChat(chatFields(data));
        if (data.status) setLiveStatus(data.status);
      },
      (error) => console.error('Could not watch order for messages:', error)
    );
  }, [order?.id]);
  const unreadFromStore = hasUnread(chat, 'customer');

  const status = (liveStatus || order?.status || 'pending').toLowerCase();

  // A quiet "arrived" pulse on the tag's headline when the order is
  // delivered. Skipped under Reduce Motion.
  const headScale = useSharedValue(1);
  const headStyle = useAnimatedStyle(() => ({ transform: [{ scale: headScale.value }] }));
  useEffect(() => {
    if (reduceMotion || status !== 'delivered') return;
    headScale.value = withSequence(
      withTiming(1.06, { duration: 140, easing: EASE_OUT_QUINT }),
      withTiming(1, { duration: 220, easing: EASE_OUT_QUART })
    );
  }, [status, reduceMotion, headScale]);

  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(formatOrderNumber(order.id));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      console.error('Could not copy order number:', error);
    }
  };

  const handleOpenChat = () => {
    Haptics.selectionAsync();
    navigation.navigate('OrderChat', {
      customerId: auth.currentUser?.uid,
      orderId: order.id,
      side: 'customer',
      storeId: order.storeId,
      title: order.storeName || 'The store',
    });
  };

  const handleContactSupport = () => {
    navigation.navigate('Help');
  };

  const handleWriteReview = (item) => {
    Haptics.selectionAsync();
    navigation.navigate('WriteReview', { orderId: order.id, item, storeId: order.storeId });
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.headerBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Order details</Text>
      {order ? (
        <TouchableOpacity
          onPress={handleContactSupport}
          style={[styles.headerBtn, styles.headerBtnEnd]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Get help with this order"
        >
          <Ionicons name="help-circle-outline" size={24} color={Colors.light.tint} />
        </TouchableOpacity>
      ) : (
        <View style={styles.headerBtn} />
      )}
    </View>
  );

  if (!order) {
    return (
      <SafeAreaView style={styles.container}>
        {header}
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

  const isCancelled = status === 'cancelled';
  const color = tagColor(status);
  const beforeShipping = status === 'pending' || status === 'processing';
  // Exactly the lines firestore.rules will accept a review for: a delivered
  // order, and a product listed in that order's own productIds. Orders
  // placed before productIds existed yield an empty set and show no review
  // row at all — an absent button beats one that fails on submit.
  const canReviewThisOrder = isOrderReviewable(order);
  const reviewableProductIds = new Set(order.productIds || []);
  const shippingAddress = order.shippingAddress;
  const paymentMethod = order.paymentMethod;
  const paymentLabel = getPaymentLabel(paymentMethod);
  // Read from the order's own paymentStatus rather than assumed from the
  // method, so an order that was never charged cannot claim it was.
  const isPaid = paymentMethod && paymentMethod !== 'cod' && getPaymentStatus(order) === 'paid';
  const paymentTrustText = !paymentMethod
    ? ''
    : paymentMethod === 'cod'
      ? 'Pay the rider when it arrives'
      : isPaid
        ? paymentMethod === 'card' ? 'Credit / debit card' : 'E-wallet'
        : `Not charged. The ${paymentLabel} payment was not completed.`;

  // Shown only where it is true, and stated plainly rather than softened.
  // An order carrying a simulated authorisation must say so on the screen
  // a customer or a Store Manager would point at as proof of payment.
  const sandboxNote = getPaymentNote(order);
  const itemCount = items.reduce((n, item) => n + (item.quantity || 1), 0);
  const fade = (delay) => (reduceMotion ? undefined : FadeIn.duration(220).delay(delay).easing(EASE_OUT_QUART));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {header}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* The tag */}
        <Animated.View
          entering={fade(0)}
          style={[styles.tag, { backgroundColor: color }]}
        >
          <View style={styles.tagGlow} />
          <View style={styles.tagString} />
          <View style={styles.tagHole} />

          <View style={styles.tagOrdRow}>
            <Text style={styles.tagOrdLabel}>ORDER</Text>
            <Text style={styles.tagOrdNumber}>{formatOrderNumber(order.id)}</Text>
            <TouchableOpacity
              onPress={handleCopy}
              style={styles.tagCopy}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Order number copied' : 'Copy order number'}
            >
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={13} color="#fff" />
            </TouchableOpacity>
            {copied ? <Text style={styles.tagCopied}>Copied</Text> : null}
          </View>

          <View
            accessible
            accessibilityRole="header"
            accessibilityLabel={`${headline(status)}. ${reassurance(status, order.storeName)}`}
          >
            <Animated.Text style={[styles.tagHead, headStyle]}>{headline(status)}</Animated.Text>
            <Text style={styles.tagSub}>{reassurance(status, order.storeName)}</Text>
          </View>

          {isCancelled ? (
            <Text style={styles.tagCancelNote}>
              If you have questions about this order, our support team can help.
            </Text>
          ) : (
            <View
              accessible
              accessibilityLabel={`Step ${stepIndex(status) + 1} of 4: ${STEPS[stepIndex(status)].label}`}
            >
              <Tracker
                index={stepIndex(status)}
                color={color}
                placedDate={order.date}
                reduceMotion={reduceMotion}
              />
            </View>
          )}

          <DashedRule color="rgba(255,255,255,0.4)" style={styles.tagRule} />
          <View style={styles.tagMeta}>
            <Text style={styles.tagMetaLabel}>Placed</Text>
            <Text style={styles.tagMetaValue}>{order.date || '—'}</Text>
          </View>
        </Animated.View>

        {/* The seller, and the way into the order's chat. Only orders that
            belong to a store have someone to talk to. */}
        {order.storeId ? (
          <Animated.View entering={fade(40)}>
            <Card variant="flat" style={styles.sellerCard}>
              <View style={styles.sellerRow}>
                <StoreLogo uri={store?.logoUrl} size={44} radius={14} />
                <View style={styles.sellerWho}>
                  <Text style={styles.sellerName} numberOfLines={2}>{order.storeName || 'The store'}</Text>
                  <Text style={styles.sellerRole}>Seller</Text>
                </View>
                <AnimatedPressable
                  onPress={handleOpenChat}
                  style={styles.msgBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${order.storeName || 'the store'}${unreadFromStore ? ', new message' : ''}`}
                >
                  <Ionicons name="chatbubble-outline" size={16} color="#fff" />
                  <Text style={styles.msgBtnText}>Message</Text>
                  {unreadFromStore ? <View style={styles.msgBadge} /> : null}
                </AnimatedPressable>
              </View>
              {beforeShipping ? (
                <View style={styles.sellerHint}>
                  <Ionicons name="camera-outline" size={15} color={Colors.light.secondary} />
                  <Text style={styles.sellerHintText}>
                    Ask for a photo of the exact piece before it ships.
                  </Text>
                </View>
              ) : null}
            </Card>
          </Animated.View>
        ) : null}

        {/* Items */}
        <SectionTitle>{itemCount === 1 ? 'Item · 1' : `Items · ${itemCount}`}</SectionTitle>
        {items.length === 0 ? (
          <Text style={styles.emptyItemsText}>No item details available for this order.</Text>
        ) : (
          items.map((item, index) => {
            const existingReview = reviewsByProductId[item.productId];
            const showReviewRow =
              canReviewThisOrder && item.productId && reviewableProductIds.has(item.productId);
            const qty = item.quantity || 1;
            const chips = [item.size, item.color, `×${qty}`].filter(Boolean);

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
                    accessibilityLabel={`${item.name}${item.size ? `, size ${item.size}` : ''}${item.color ? `, color ${item.color}` : ''}, quantity ${qty}, ${peso(Number(item.price) * qty)}`}
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
                      <View style={styles.chips}>
                        {chips.map((c) => (
                          <Text key={c} style={styles.chip}>{c}</Text>
                        ))}
                      </View>
                    </View>
                    <Text style={styles.itemPrice}>{peso(Number(item.price) * qty)}</Text>
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

        {/* Deliver to */}
        <SectionTitle>Deliver to</SectionTitle>
        <Animated.View entering={fade(60)}>
          <Card variant="flat" style={styles.row}>
            <View style={[styles.ico, styles.icoClay]}>
              <Ionicons name="location-outline" size={18} color={Colors.light.tint} />
            </View>
            {shippingAddress ? (
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{shippingAddress.fullName}</Text>
                <Text style={styles.rowBody}>{shippingAddress.phone}</Text>
                <Text style={styles.rowBody}>
                  {shippingAddress.address}, {shippingAddress.city}, {shippingAddress.province} {shippingAddress.zipCode}
                </Text>
              </View>
            ) : (
              <Text style={[styles.rowText, styles.rowBody]}>Address not available for this order.</Text>
            )}
          </Card>
        </Animated.View>

        {/* Payment */}
        <SectionTitle>Payment</SectionTitle>
        <Animated.View entering={fade(80)}>
          <Card variant="flat" style={styles.payCard}>
            <View style={styles.payRow}>
              <View style={[styles.ico, styles.icoMoss]}>
                <Ionicons name={getPaymentIcon(paymentMethod)} size={18} color={Colors.light.secondary} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{paymentLabel}</Text>
                {paymentTrustText ? <Text style={styles.rowBody}>{paymentTrustText}</Text> : null}
              </View>
              {isPaid ? <Text style={styles.paidPill}>Paid</Text> : null}
            </View>
            {sandboxNote ? (
              <View style={styles.sandbox}>
                <Ionicons name="flask-outline" size={15} color={Colors.light.icon} />
                <Text style={styles.sandboxText}>{sandboxNote}</Text>
              </View>
            ) : null}
          </Card>
        </Animated.View>

        {/* Receipt */}
        <Animated.View entering={fade(100)}>
          <Card variant="flat" style={styles.receipt}>
            <View style={styles.receiptLine}>
              <Text style={styles.receiptLabel}>Subtotal</Text>
              <Text style={styles.receiptValue}>{peso(order.subtotal || order.total)}</Text>
            </View>
            <View style={styles.receiptLine}>
              <Text style={styles.receiptLabel}>Shipping</Text>
              {order.shipping ? (
                <Text style={styles.receiptValue}>{peso(order.shipping)}</Text>
              ) : (
                <Text style={styles.receiptFree}>Free</Text>
              )}
            </View>
            <DashedRule color={Colors.light.border} style={styles.receiptRule} />
            <View style={styles.receiptTotal}>
              <Text style={styles.receiptTotalLabel}>Total</Text>
              <Text style={styles.receiptTotalValue}>{peso(order.total)}</Text>
            </View>
          </Card>
        </Animated.View>

        {/* Support */}
        <Animated.View entering={fade(120)}>
          <AnimatedPressable
            onPress={handleContactSupport}
            accessibilityRole="button"
            accessibilityLabel="Problem with this order? Contact PlainCo support"
          >
            <Card variant="flat" style={styles.help}>
              <View style={[styles.ico, styles.icoClay]}>
                <Ionicons name="help-circle-outline" size={18} color={Colors.light.tint} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Problem with this order?</Text>
                <Text style={styles.rowBody}>Contact PlainCo support</Text>
              </View>
              <Text style={styles.helpGo}>Help</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.light.tint} />
            </Card>
          </AnimatedPressable>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const WHITE_SOFT = 'rgba(255,255,255,0.28)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  headerBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerBtnEnd: { alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text },
  content: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: Colors.light.icon,
    marginTop: 22,
    marginBottom: 10,
  },

  // The tag
  tag: { borderRadius: Radius.xl, padding: 20, paddingBottom: 18, overflow: 'hidden' },
  tagGlow: {
    position: 'absolute',
    right: -40,
    top: -60,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  tagString: {
    position: 'absolute',
    top: -6,
    right: 26,
    width: 2,
    height: 28,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  tagHole: {
    position: 'absolute',
    top: 18,
    right: 20,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.light.background,
  },
  tagOrdRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 30 },
  tagOrdLabel: { fontSize: 11.5, color: 'rgba(255,255,255,0.85)', letterSpacing: 0.4 },
  tagOrdNumber: { fontSize: 12.5, fontWeight: '600', color: '#fff', fontVariant: ['tabular-nums'], letterSpacing: 0.6 },
  tagCopy: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagCopied: { fontSize: 11, color: '#fff', fontWeight: '600' },
  tagHead: { fontSize: 24, fontWeight: '600', color: '#fff', marginTop: 12, alignSelf: 'flex-start' },
  tagSub: { fontSize: 13, color: 'rgba(255,255,255,0.92)', marginTop: 2 },
  tagCancelNote: { fontSize: 12.5, color: '#fff', lineHeight: 18, marginTop: 14 },
  tagRule: { marginTop: 16 },
  tagMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  tagMetaLabel: { fontSize: 12, color: 'rgba(255,255,255,0.82)' },
  tagMetaValue: { fontSize: 12, fontWeight: '600', color: '#fff' },

  // Tracker
  track: { flexDirection: 'row', marginTop: 20 },
  trackStep: { flex: 1, alignItems: 'center' },
  trackTodo: { opacity: 0.72 },
  trackLine: {
    position: 'absolute',
    top: 11,
    right: '50%',
    width: '100%',
    height: 2,
    backgroundColor: WHITE_SOFT,
  },
  trackLineOn: { backgroundColor: '#fff' },
  trackDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackDotOn: { backgroundColor: '#fff', borderColor: '#fff' },
  trackDotNow: {
    shadowColor: '#fff',
    shadowOpacity: 0.5,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  nowInner: { width: 9, height: 9, borderRadius: 4.5 },
  trackLabel: { fontSize: 11, fontWeight: '600', color: '#fff', marginTop: 6 },
  trackSub: { fontSize: 10, color: 'rgba(255,255,255,0.78)', marginTop: 1 },

  // Dashed rule
  dashClip: { height: 1, overflow: 'hidden' },
  dashBox: { height: 2, borderWidth: 1, borderStyle: 'dashed', borderRadius: 1 },

  // Seller
  sellerCard: { padding: 0, marginTop: 22, overflow: 'hidden' },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  sellerWho: { flex: 1, minWidth: 0 },
  sellerName: { fontSize: 14, fontWeight: '600', color: Colors.light.text, lineHeight: 19 },
  sellerRole: { fontSize: 12, color: Colors.light.icon },
  msgBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.light.tint,
    paddingHorizontal: 14,
    minHeight: 40,
    borderRadius: Radius.md,
  },
  msgBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  msgBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.light.text,
    borderWidth: 2,
    borderColor: '#fff',
  },
  sellerHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  sellerHintText: { flex: 1, fontSize: 12, color: Colors.light.icon },

  // Items
  emptyItemsText: { fontSize: 13, color: Colors.light.icon },
  // The card is a column (line, then optional review row).
  itemCard: { padding: 12, marginBottom: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'center' },
  itemImage: { width: 64, height: 64, borderRadius: Radius.md, backgroundColor: Colors.light.border },
  itemImagePlaceholder: { justifyContent: 'center', alignItems: 'center' },
  itemDetails: { flex: 1, marginLeft: 12, marginRight: 8 },
  itemName: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: {
    fontSize: 11,
    color: Colors.light.icon,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
    overflow: 'hidden',
  },
  itemPrice: { fontSize: 14, fontWeight: '600', color: Colors.light.highlight, fontVariant: ['tabular-nums'] },
  // A quiet in-card row, not a Button: asking for a review should not
  // compete with the Message button, and Clay is spent here on the text
  // rather than on a filled block.
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

  // Icon rows (address, payment, help)
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14 },
  ico: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  icoClay: { backgroundColor: Colors.light.tint + '15' },
  icoMoss: { backgroundColor: Colors.light.secondary + '20' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: Colors.light.text, marginBottom: 2 },
  rowBody: { fontSize: 13, color: Colors.light.icon, lineHeight: 19 },

  // Payment
  payCard: { padding: 0 },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  paidPill: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.light.secondary,
    backgroundColor: Colors.light.secondary + '20',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  sandbox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 14,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  sandboxText: { flex: 1, fontSize: 11.5, color: Colors.light.icon, lineHeight: 16 },

  // Receipt
  receipt: { marginTop: 22 },
  receiptLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  receiptLabel: { fontSize: 13.5, color: Colors.light.icon },
  receiptValue: { fontSize: 13.5, color: Colors.light.text, fontVariant: ['tabular-nums'] },
  receiptFree: { fontSize: 13.5, fontWeight: '600', color: Colors.light.success },
  receiptRule: { marginTop: 10 },
  receiptTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 14 },
  receiptTotalLabel: { fontSize: 15, fontWeight: '600', color: Colors.light.text },
  receiptTotalValue: { fontSize: 24, fontWeight: '600', color: Colors.light.highlight, fontVariant: ['tabular-nums'] },

  // Support
  help: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, marginTop: 22 },
  helpGo: { fontSize: 13, fontWeight: '600', color: Colors.light.tint },

  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyActionWrap: { marginTop: Spacing.md, width: 200, alignSelf: 'center' },
});
