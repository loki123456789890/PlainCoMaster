// screens/OrderDetailsScreen.js
//
// Order details, from the approved order-details preview: a status card
// whose colour, icon and tracker follow the order, then the order itself as
// one receipt (the seller with a message bubble, the items with their
// review strip, the totals and how it was paid), where it's going, and a
// "Need help?" card whose first row changes with the status.
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
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
  ZoomIn,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { collection, query, where, getDocs, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';
import { Colors, Spacing, Radius } from '../constants/theme';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import EmptyState from '../components/ui/EmptyState';
import { showAppAlert } from '../utils/appAlert';
import {
  RETURN_STATUS,
  canReportProblem,
  reportDeadline,
  reasonLabel,
  returnRequestRef,
  returnStatusLine,
  maskedAccount,
} from '../constants/returns';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import StarRating from '../components/ui/StarRating';
import ProductImage from '../components/ui/ProductImage';
import StoreLogo from '../components/shop/StoreLogo';
import { useStores } from '../context/StoreContext';
import { REVIEWS_COLLECTION, mapReviewDoc, isOrderReviewable } from '../utils/reviews';
import { getPaymentLabel, getPaymentIcon, getPaymentStatus, getPaymongoReceipt } from '../constants/payment';
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

const CREAM = Colors.light.background;
const DAY_MS = 24 * 60 * 60 * 1000;

// The status card, per status: two stops of a gradient, the icon, the
// headline. Ink while the store has it, Clay once it's moving, Moss
// (success) when it arrives, and a muted ash for a cancelled order —
// cancelled is an outcome, not an error, so it doesn't get Rust.
const HERO = {
  pending: { colors: ['#3A332E', '#26211D'], icon: 'receipt-text-outline', title: 'Order placed' },
  processing: { colors: ['#3A332E', '#26211D'], icon: 'package-variant', title: 'Getting it ready' },
  shipped: { colors: [Colors.light.tint, '#A14A2B'], icon: 'truck-delivery-outline', title: 'On its way' },
  delivered: { colors: [Colors.light.success, '#46543C'], icon: 'package-variant-closed-check', title: 'Delivered' },
  cancelled: { colors: ['#6F6760', '#544D47'], icon: 'close-circle-outline', title: 'Order cancelled' },
};

const shortDay = (date) =>
  date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

const formatDay = (date) =>
  date ? date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';

const subline = (status, storeName, deliveredDate) => {
  const store = storeName || 'The store';
  switch (status) {
    case 'pending': return `${store} has your order.`;
    case 'processing': return `${store} is packing your order.`;
    case 'shipped': return 'Your order has left the store.';
    case 'delivered':
      return deliveredDate
        ? `It arrived on ${shortDay(deliveredDate)}. We hope you love it.`
        : 'Delivered. We hope you love it.';
    case 'cancelled': return 'This order will not be delivered.';
    default: return 'Tracking this order for you.';
  }
};

// "Sep 22, 2026" -> "Sep 22", for the tracker's small date line.
const shortDate = (date) => (date ? String(date).split(',')[0] : '');

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// A dashed rule. RN draws a dashed border on one side only on iOS; a
// fully bordered box clipped to its top edge dashes on both platforms.
function DashedRule({ color, style }) {
  return (
    <View style={[styles.dashClip, style]}>
      <View style={[styles.dashBox, { borderColor: color }]} />
    </View>
  );
}

// The tear line across the receipt: a dashed rule with a half-circle bite
// out of each edge, in the page colour.
function ReceiptCut() {
  return (
    <View style={styles.cut}>
      <DashedRule color="#D9CFC2" />
      <View style={[styles.cutBite, styles.cutBiteLeft]} />
      <View style={[styles.cutBite, styles.cutBiteRight]} />
    </View>
  );
}

// The receipt's paper: rounded at the top, scalloped along the bottom.
// Drawn as one SVG path behind the content so the border follows the
// scallops on both platforms (a View can't be cut like that).
const SCALLOP_R = 6;
const SCALLOP_STEP = 20;
function receiptPath(w, h) {
  const r = 22;
  const n = Math.max(1, Math.floor(w / SCALLOP_STEP));
  const step = w / n;
  let d = `M0.5,${r} A${r - 0.5},${r - 0.5} 0 0 1 ${r},0.5 L${w - r},0.5 A${r - 0.5},${r - 0.5} 0 0 1 ${w - 0.5},${r} L${w - 0.5},${h}`;
  for (let k = n - 1; k >= 0; k -= 1) {
    const cx = step / 2 + k * step;
    d += ` L${cx + SCALLOP_R},${h} A${SCALLOP_R},${SCALLOP_R} 0 0 0 ${cx - SCALLOP_R},${h}`;
  }
  return `${d} L0.5,${h} Z`;
}

function Receipt({ children }) {
  const [size, setSize] = useState(null);
  return (
    <View
      style={styles.receipt}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (!size || size.w !== width || size.h !== height) setSize({ w: width, h: height });
      }}
    >
      {size ? (
        <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path d={receiptPath(size.w, size.h)} fill="#fff" stroke="#ECE4D9" strokeWidth={1} />
        </Svg>
      ) : null}
      {children}
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

// The status icon in its tile. A delivery truck drifts and a parcel being
// packed bobs, so a moving order looks like one; still under Reduce Motion.
function HeroIcon({ status, reduceMotion }) {
  const move = useSharedValue(0);
  const moving = status === 'shipped' || status === 'processing' || status === 'pending';
  useEffect(() => {
    if (reduceMotion || !moving) return undefined;
    move.value = withRepeat(withTiming(1, { duration: status === 'shipped' ? 800 : 1000 }), -1, true);
    return () => cancelAnimation(move);
  }, [reduceMotion, moving, status, move]);
  const style = useAnimatedStyle(() =>
    status === 'shipped'
      ? { transform: [{ translateX: -2 + move.value * 5 }, { translateY: -move.value }] }
      : { transform: [{ translateY: -move.value * 3 }] }
  );
  return (
    <Animated.View
      key={status}
      entering={reduceMotion ? undefined : ZoomIn.duration(420).easing(EASE_OUT_QUINT).delay(120)}
      style={styles.heroIcon}
    >
      <Animated.View style={style}>
        <MaterialCommunityIcons name={HERO[status]?.icon || HERO.pending.icon} size={28} color={CREAM} />
      </Animated.View>
    </Animated.View>
  );
}

// Four dots joined by a rail, in a darker inset on the status card: ticked
// when done, a ring and a breathing dot for the current step, faint for
// what's to come. A delivered order ticks all four.
function Tracker({ index, delivered, color, dates, reduceMotion }) {
  return (
    <View style={styles.track}>
      {STEPS.map((step, i) => {
        const done = i < index || delivered;
        const now = i === index && !delivered;
        const sub = dates[i] || (now ? 'Now' : '');
        return (
          <View key={step.key} style={[styles.trackStep, !done && !now && styles.trackTodo]}>
            {i > 0 && <View style={[styles.trackLine, i <= index && styles.trackLineOn]} />}
            <View style={[styles.trackDot, { backgroundColor: color }, (done || now) && styles.trackDotOn, now && styles.trackDotNow]}>
              {done ? <Ionicons name="checkmark" size={12} color={color} /> : null}
              {now ? <NowDot color={color} reduceMotion={reduceMotion} /> : null}
            </View>
            <Text style={styles.trackLabel}>{step.label}</Text>
            <Text style={styles.trackSub}>{sub || ' '}</Text>
          </View>
        );
      })}
    </View>
  );
}

function SectionTitle({ children }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

// One row of the "Need help?" card.
function HelpRow({ icon, tone = 'clay', title, body, chip, onPress, label, first }) {
  const moss = tone === 'moss';
  return (
    <AnimatedPressable
      onPress={onPress}
      style={[styles.helpRow, !first && styles.helpRowRule]}
      accessibilityRole="button"
      accessibilityLabel={label || `${title} ${body || ''}`}
    >
      <View style={[styles.ico, moss ? styles.icoMoss : styles.icoClay]}>
        <Ionicons name={icon} size={18} color={moss ? Colors.light.secondary : Colors.light.tint} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {body ? <Text style={styles.rowBody}>{body}</Text> : null}
        {chip ? <Text style={styles.daysChip}>{chip}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.light.icon} />
    </AnimatedPressable>
  );
}

export default function OrderDetailsScreen({ navigation, route }) {
  const { order } = route.params || {};
  const items = order?.items || [];
  const reduceMotion = useReducedMotion();
  const { getStore } = useStores();
  const store = order?.storeId ? getStore(order.storeId) : null;

  // Reviews this customer has already written against this order, keyed by
  // product id, so each line can offer "How was it?" or "Your review"
  // rather than a single guess for the whole order.
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
        // Non-fatal by design: losing this read only means the strip reads
        // "How was it?" when it could have shown the review. WriteReviewScreen
        // loads the authoritative answer on open and switches itself into
        // edit mode, so nothing is lost or duplicated.
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
  // (and clears on the way back from the chat), and the card moves on when
  // the store marks the order shipped.
  const [chat, setChat] = useState(() => (order ? chatFields(order) : null));
  const [liveStatus, setLiveStatus] = useState(null);
  // When the order became delivered, stamped by the server. The list does
  // not pass it (a Timestamp is not a navigation param), so it comes from
  // the same live read.
  const [deliveredAt, setDeliveredAt] = useState(null);
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
        setDeliveredAt(data.deliveredAt || null);
      },
      (error) => console.error('Could not watch order for messages:', error)
    );
  }, [order?.id]);
  const unreadFromStore = hasUnread(chat, 'customer');

  const status = (liveStatus || order?.status || 'pending').toLowerCase();

  // A reported problem about this order, watched live so the store's
  // decision shows up while the screen is open. Only a delivered order can
  // have one, so nothing is opened for the rest. `undefined` until the
  // first answer, so the "Something wrong with it?" row doesn't flash in
  // and then turn into a status card.
  const [problem, setProblem] = useState(undefined);
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!order?.id || !uid || status !== 'delivered') return undefined;
    return onSnapshot(
      returnRequestRef(uid, order.id),
      (snapshot) => setProblem(snapshot.exists() ? snapshot.data() : null),
      (error) => {
        console.error('Could not watch problem report:', error);
        setProblem(null);
      }
    );
  }, [order?.id, status]);

  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const handleWithdraw = async () => {
    setWithdrawing(true);
    try {
      // The one change the rules let a customer make to a report, and only
      // before the store has decided.
      await updateDoc(returnRequestRef(auth.currentUser.uid, order.id), {
        status: 'withdrawn',
        withdrawnAt: serverTimestamp(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setConfirmWithdraw(false);
    } catch (error) {
      console.error('Could not withdraw problem report:', error);
      setConfirmWithdraw(false);
      showAppAlert(
        'Not withdrawn',
        error?.code === 'permission-denied'
          ? 'The store has already decided on this report, so it can no longer be withdrawn.'
          : 'Check your connection and try again.'
      );
    } finally {
      setWithdrawing(false);
    }
  };

  // A quiet "arrived" pulse on the headline when the order is delivered.
  // Skipped under Reduce Motion.
  const headScale = useSharedValue(1);
  const headStyle = useAnimatedStyle(() => ({ transform: [{ scale: headScale.value }] }));
  useEffect(() => {
    if (reduceMotion || status !== 'delivered') return;
    headScale.value = withSequence(
      withTiming(1.06, { duration: 140, easing: EASE_OUT_QUINT }),
      withTiming(1, { duration: 220, easing: EASE_OUT_QUART })
    );
  }, [status, reduceMotion, headScale]);

  // The top bar picks up a hairline once the page scrolls under it.
  const [scrolled, setScrolled] = useState(false);

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

  // Opens Help with the support request already about this order, so it
  // goes to the store that sold it without the customer finding it again.
  const handleContactSupport = () => {
    Haptics.selectionAsync();
    navigation.navigate('Help', {
      order: { id: order.id, storeId: order.storeId, storeName: order.storeName || '' },
    });
  };

  const deadline = reportDeadline(deliveredAt);
  const canReport = problem === null && canReportProblem({ status }, deliveredAt);
  const handleReportProblem = () => {
    Haptics.selectionAsync();
    navigation.navigate('ReportProblem', {
      order: {
        id: order.id,
        items: order.items || [],
        storeId: order.storeId,
        storeName: order.storeName || '',
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
      },
      deadline: deadline ? deadline.getTime() : null,
    });
  };

  // A star tapped on the strip opens the review with that rating chosen.
  const handleWriteReview = (item, initialRating) => {
    Haptics.selectionAsync();
    navigation.navigate('WriteReview', {
      orderId: order.id,
      item,
      storeId: order.storeId,
      storeName: order.storeName || '',
      ...(initialRating ? { initialRating } : null),
    });
  };

  const header = (
    <View style={[styles.header, scrolled && styles.headerScrolled]}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.headerBtn}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={24} color={Colors.light.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Order details</Text>
      {/* Balances Back so the title stays centered. Help lives in the
          "Need help?" card at the end of the order, not here. */}
      <View style={styles.headerBtn} />
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
  const isDelivered = status === 'delivered';
  const hero = HERO[status] || HERO.pending;
  const heroDark = hero.colors[1];
  const deliveredDate = deliveredAt?.toDate?.() || null;
  const trackerDates = [shortDate(order.date), '', '', isDelivered ? shortDay(deliveredDate) : ''];
    // Exactly the lines firestore.rules will accept a review for: a delivered
  // order, and a product listed in that order's own productIds. Orders
  // placed before productIds existed yield an empty set and show no review
  // strip at all — an absent button beats one that fails on submit.
  const canReviewThisOrder = isOrderReviewable(order);
  const reviewableProductIds = new Set(order.productIds || []);
  const shippingAddress = order.shippingAddress;
  const paymentMethod = order.paymentMethod;
  const paymentLabel = getPaymentLabel(paymentMethod);
  // Read from the order's own paymentStatus rather than assumed from the
  // method, so an order that was never charged cannot claim it was.
  const isPaid = paymentMethod && paymentMethod !== 'cod' && getPaymentStatus(order) === 'paid';

  // Which PayMongo payment took the money, so a customer has a reference
  // to quote. A test-mode payment says so: it's the proof of payment a
  // customer or Store Manager would point at.
  const receipt = getPaymongoReceipt(order);
  const paymentLine = !paymentMethod
    ? ''
    : paymentMethod === 'cod'
      ? 'Pay the rider when it arrives'
      : !isPaid
        ? `Not charged. The ${paymentLabel} payment was not completed.`
        : receipt
          ? `via PayMongo${receipt.test ? ' · Test mode' : ''}`
          : paymentMethod === 'card' ? 'Credit / debit card' : 'E-wallet';

  const daysLeft = deadline ? Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / DAY_MS)) : 0;
  const reportChip = deadline
    ? `Report by ${formatDay(deadline)} · ${daysLeft <= 1 ? 'last day' : `${daysLeft} days left`}`
    : '';

  const hasSeller = Boolean(order.storeId);
  const beforeShipping = status === 'pending' || status === 'processing';
  const hasFirstHelpRow = canReport || (hasSeller && !isDelivered);
  const enter = (delay) =>
    reduceMotion ? undefined : FadeInDown.duration(420).delay(delay).easing(EASE_OUT_QUINT);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {header}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        scrollEventThrottle={32}
        onScroll={(e) => {
          const past = e.nativeEvent.contentOffset.y > 6;
          if (past !== scrolled) setScrolled(past);
        }}
      >
        {/* Status card */}
        <Animated.View entering={enter(40)} style={[styles.heroShadow, { shadowColor: heroDark, backgroundColor: heroDark }]}>
          <LinearGradient
            colors={hero.colors}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.heroRingBig} />
            <View style={styles.heroRing} />

            <View style={styles.heroTop}>
              <TouchableOpacity
                onPress={handleCopy}
                style={styles.orderPill}
                hitSlop={{ top: 8, bottom: 8 }}
                accessibilityRole="button"
                accessibilityLabel={copied ? 'Order number copied' : `Order ${formatOrderNumber(order.id)}. Copy order number`}
              >
                <Text style={styles.orderPillLabel}>ORDER</Text>
                <Text style={styles.orderPillNumber}>{formatOrderNumber(order.id)}</Text>
                <View style={styles.orderPillIcon}>
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={11} color={CREAM} />
                </View>
              </TouchableOpacity>
              {order.date ? <Text style={styles.heroDate} numberOfLines={1}>{`Placed ${order.date}`}</Text> : null}
            </View>

            <View
              style={styles.heroMain}
              accessible
              accessibilityRole="header"
              accessibilityLabel={`${hero.title}. ${subline(status, order.storeName, deliveredDate)}`}
            >
              <HeroIcon status={status} reduceMotion={reduceMotion} />
              <View style={styles.heroWords}>
                <Animated.Text style={[styles.heroTitle, headStyle]}>{hero.title}</Animated.Text>
                <Text style={styles.heroSub}>{subline(status, order.storeName, deliveredDate)}</Text>
              </View>
            </View>

            {isCancelled ? (
              <Text style={styles.cancelNote}>
                {isPaid
                  ? 'If you already paid, message the seller about your refund.'
                  : 'If you have questions about this order, the seller or our support team can help.'}
              </Text>
            ) : (
              <View
                style={styles.trackWrap}
                accessible
                accessibilityLabel={isDelivered ? 'All 4 steps done: Delivered' : `Step ${stepIndex(status) + 1} of 4: ${STEPS[stepIndex(status)].label}`}
              >
                <Tracker
                  index={stepIndex(status)}
                  delivered={isDelivered}
                  color={heroDark}
                  dates={trackerDates}
                  reduceMotion={reduceMotion}
                />
              </View>
            )}
          </LinearGradient>
        </Animated.View>

        {/* The order, as one receipt */}
        <Animated.View entering={enter(160)}>
          <SectionTitle>Your order</SectionTitle>
        </Animated.View>
        <Animated.View entering={enter(200)}>
          <Receipt>
            {hasSeller ? (
              <>
                <View style={styles.sellerRow}>
                  <StoreLogo uri={store?.logoUrl} size={42} radius={13} />
                  <View style={styles.sellerWho}>
                    <Text style={styles.sellerName} numberOfLines={2}>{order.storeName || 'The store'}</Text>
                    <Text style={styles.sellerRole} numberOfLines={1}>
                      {unreadFromStore ? 'Seller · sent you a message' : 'Seller · tap the bubble to message'}
                    </Text>
                  </View>
                  <AnimatedPressable
                    onPress={handleOpenChat}
                    style={styles.msgBtn}
                    accessibilityRole="button"
                    accessibilityLabel={`Message ${order.storeName || 'the store'}${unreadFromStore ? ', new message' : ''}`}
                  >
                    <Ionicons name="chatbubble-outline" size={18} color="#fff" />
                    {unreadFromStore ? <View style={styles.msgBadge} /> : null}
                  </AnimatedPressable>
                </View>
                <ReceiptCut />
              </>
            ) : null}

            {items.length === 0 ? (
              <Text style={styles.emptyItemsText}>No item details available for this order.</Text>
            ) : (
              items.map((item, index) => {
                const existingReview = reviewsByProductId[item.productId];
                const showReview =
                  canReviewThisOrder && item.productId && reviewableProductIds.has(item.productId);
                const qty = item.quantity || 1;
                const meta = [item.size ? `Size ${item.size}` : '', item.color, `Qty ${qty}`].filter(Boolean).join(' · ');

                return (
                  <View key={index} style={index > 0 && styles.itemGap}>
                    <View
                      style={styles.itemRow}
                      accessible
                      accessibilityLabel={`${item.name}${item.size ? `, size ${item.size}` : ''}${item.color ? `, color ${item.color}` : ''}, quantity ${qty}, ${peso(Number(item.price) * qty)}`}
                    >
                      {item.image ? (
                        <ProductImage uri={item.image} style={styles.itemImage} />
                      ) : (
                        <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                          <Ionicons name="shirt-outline" size={26} color="#B9AFA3" />
                        </View>
                      )}
                      <View style={styles.itemDetails}>
                        <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                        <Text style={styles.itemMeta} numberOfLines={1}>{meta}</Text>
                      </View>
                      <Text style={styles.itemPrice}>{peso(Number(item.price) * qty)}</Text>
                    </View>

                    {/* Asking for the review here, on the delivered order,
                        rather than in a push or an email: this is the one
                        screen a customer opens already holding the item. */}
                    {showReview ? (
                      existingReview ? (
                        <AnimatedPressable
                          style={styles.reviewStrip}
                          onPress={() => handleWriteReview(item)}
                          accessibilityRole="button"
                          accessibilityLabel={`Your ${existingReview.rating}-star review of ${item.name}. Edit`}
                        >
                          <View style={styles.reviewWords}>
                            <Text style={styles.reviewTitle}>Your review</Text>
                            <Text style={styles.reviewHint}>Thanks for rating this item</Text>
                          </View>
                          <StarRating rating={existingReview.rating} size={14} />
                          <Text style={styles.reviewEdit}>Edit</Text>
                        </AnimatedPressable>
                      ) : (
                        <View style={[styles.reviewStrip, styles.reviewStripAsk]}>
                          {/* Five 44pt star targets don't fit beside the words,
                              so the words get their own line above them. */}
                          <Text style={styles.reviewAskLine} numberOfLines={1}>
                            <Text style={styles.reviewTitle}>How was it?</Text>
                            <Text style={styles.reviewHint}>  ·  Tap a star to rate</Text>
                          </Text>
                          <StarRating
                            rating={0}
                            size={22}
                            style={styles.reviewAskStars}
                            editable
                            color={Colors.light.tint}
                            label={item.name}
                            onChange={(value) => handleWriteReview(item, value)}
                          />
                        </View>
                      )
                    ) : null}
                  </View>
                );
              })
            )}

            <ReceiptCut />

            <View style={styles.totLine}>
              <Text style={styles.totLabel}>Subtotal</Text>
              <Text style={styles.totValue}>{peso(order.subtotal || order.total)}</Text>
            </View>
            <View style={styles.totLine}>
              <Text style={styles.totLabel}>Shipping</Text>
              {order.shipping ? (
                <Text style={styles.totValue}>{peso(order.shipping)}</Text>
              ) : (
                <Text style={styles.totFree}>Free</Text>
              )}
            </View>
            <View style={styles.totBig}>
              <Text style={styles.totBigLabel}>Total</Text>
              <Text style={styles.totBigValue}>{peso(order.total)}</Text>
            </View>

            {paymentMethod ? (
              <View
                style={styles.pay}
                accessible
                accessibilityLabel={`${paymentLabel}. ${paymentLine}${receipt?.ref ? `, reference ${receipt.ref}` : ''}${isPaid ? '. Paid' : ''}`}
              >
                <View style={styles.payIcon}>
                  <Ionicons name={getPaymentIcon(paymentMethod)} size={18} color="#5F564E" />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.payTitle}>{paymentLabel}</Text>
                  <Text style={styles.payBody}>{paymentLine}</Text>
                  {receipt?.ref ? (
                    <Text style={styles.payRef} numberOfLines={1} selectable>{receipt.ref}</Text>
                  ) : null}
                </View>
                {isPaid ? (
                  <View style={[styles.paidPill, isCancelled && styles.paidPillWarm]}>
                    {isCancelled ? null : <Ionicons name="checkmark" size={12} color="#3F4B36" />}
                    <Text style={[styles.paidPillText, isCancelled && styles.paidPillTextWarm]}>Paid</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
          </Receipt>
        </Animated.View>

        {/* Where it's going */}
        <Animated.View entering={enter(300)}>
          <SectionTitle>{isDelivered ? 'Delivered to' : isCancelled ? 'Was going to' : 'Deliver to'}</SectionTitle>
        </Animated.View>
        <Animated.View entering={enter(340)}>
          <Card variant="flat" style={styles.addressCard}>
            <View style={[styles.ico, styles.icoClay]}>
              <Ionicons name="location-outline" size={18} color={Colors.light.tint} />
            </View>
            {shippingAddress ? (
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{shippingAddress.fullName}</Text>
                <Text style={styles.rowBody}>{shippingAddress.phone}</Text>
                <Text style={styles.rowBody}>
                  {[shippingAddress.address, shippingAddress.city, `${shippingAddress.province || ''} ${shippingAddress.zipCode || ''}`.trim()]
                    .filter(Boolean)
                    .join(', ')}
                </Text>
              </View>
            ) : (
              <Text style={[styles.rowText, styles.rowBody]}>Address not available for this order.</Text>
            )}
          </Card>
        </Animated.View>

        {/* A reported problem, once there is one: where it stands, live. */}
        {problem ? (
          <>
            <SectionTitle>Problem report</SectionTitle>
            <Animated.View entering={enter(380)}>
              <ProblemCard
                problem={problem}
                order={order}
                onMessage={handleOpenChat}
                onWithdraw={() => {
                  Haptics.selectionAsync();
                  setConfirmWithdraw(true);
                }}
              />
            </Animated.View>
          </>
        ) : null}

        {/* Need help? The first row follows the status; support is always last. */}
        <Animated.View entering={enter(400)}>
          <SectionTitle>Need help?</SectionTitle>
        </Animated.View>
        <Animated.View entering={enter(440)}>
          <Card variant="flat" style={styles.helpCard}>
            {canReport ? (
              <HelpRow
                first
                icon="warning-outline"
                title="Something wrong with it?"
                body="Wrong item or size, damage, or not as described."
                chip={reportChip}
                onPress={handleReportProblem}
                label={`Something wrong with it? Report a problem until ${formatDay(deadline)}`}
              />
            ) : hasSeller && isCancelled ? (
              <HelpRow
                first
                icon="chatbubble-outline"
                title="Ask the seller"
                body="Find out why it was cancelled, or ask about a refund."
                onPress={handleOpenChat}
              />
            ) : hasSeller && !isDelivered ? (
              <HelpRow
                first
                icon="chatbubble-outline"
                title="Need to change something?"
                body={
                  beforeShipping
                    ? 'Message the seller before it ships. You can ask for a photo of the exact piece, too.'
                    : 'Message the seller before it arrives.'
                }
                onPress={handleOpenChat}
              />
            ) : null}
            <HelpRow
              first={!hasFirstHelpRow}
              icon="help-circle-outline"
              tone="moss"
              title={hasFirstHelpRow ? 'Something else?' : 'Problem with this order?'}
              body="Contact PlainCo support"
              onPress={handleContactSupport}
            />
          </Card>
        </Animated.View>

        <Animated.Text entering={enter(500)} style={styles.foot}>
          {`Order ${formatOrderNumber(order.id)} · PlainCo`}
        </Animated.Text>
      </ScrollView>

      <ConfirmDialog
        visible={confirmWithdraw}
        onClose={() => setConfirmWithdraw(false)}
        title="Withdraw your report?"
        confirmLabel="Withdraw"
        cancelLabel="Keep it"
        onConfirm={handleWithdraw}
        loading={withdrawing}
        icon="arrow-undo-outline"
      >
        <Text style={styles.dialogBody}>
          {`${order.storeName || 'The store'} won't review it, and you can't report this order again.`}
        </Text>
      </ConfirmDialog>
    </SafeAreaView>
  );
}

const PROBLEM_TONES = {
  clay: Colors.light.tint,
  moss: Colors.light.secondary,
  ash: Colors.light.icon,
};

// Where a reported problem stands: the step as a badge, one sentence on
// what happens next, and the money — what is owed, where it goes, and the
// reference once it is paid. Ends without a refund (declined, withdrawn)
// show no money at all.
function ProblemCard({ problem, order, onMessage, onWithdraw }) {
  const meta = RETURN_STATUS[problem.status] || RETURN_STATUS.requested;
  const owesNothing = problem.status === 'declined' || problem.status === 'withdrawn';
  const items = Array.isArray(problem.items) ? problem.items : [];
  const refundTo =
    problem.refundMethod === 'original'
      ? `Your ${getPaymentLabel(problem.paymentMethod || order.paymentMethod)} payment`
      : maskedAccount(problem.payout);
  const canMessage =
    order.storeId && (problem.status === 'declined' || (problem.status === 'approved' && problem.resolution === 'return_first'));

  return (
    <Card variant="flat" style={styles.problemCard}>
      <View style={styles.problemHead}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{reasonLabel(problem.reason)}</Text>
          <Text style={styles.rowBody} numberOfLines={2}>
            {items.map((item) => (item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name)).join(', ')}
          </Text>
        </View>
        <Badge label={meta.label} color={PROBLEM_TONES[meta.tone]} />
      </View>

      <Text style={styles.problemLine}>{returnStatusLine(problem, order.storeName)}</Text>

      {problem.status === 'declined' && problem.declineReason ? (
        <View style={styles.problemQuote}>
          <Text style={styles.problemQuoteLabel}>Their reason</Text>
          <Text style={styles.problemQuoteText}>{problem.declineReason}</Text>
        </View>
      ) : null}

      {owesNothing ? null : (
        <View style={styles.problemMoney}>
          <View style={styles.totLine}>
            <Text style={styles.totLabel}>{problem.status === 'refunded' ? 'Refunded' : 'Refund'}</Text>
            <Text style={styles.problemAmount}>{peso(problem.refundAmount)}</Text>
          </View>
          {refundTo ? (
            <View style={styles.totLine}>
              <Text style={styles.totLabel}>To</Text>
              <Text style={styles.totValue}>{refundTo}</Text>
            </View>
          ) : null}
          {problem.status === 'refunded' && problem.refundReference ? (
            <View style={styles.totLine}>
              <Text style={styles.totLabel}>Reference</Text>
              <Text style={[styles.totValue, styles.problemRef]} selectable>{problem.refundReference}</Text>
            </View>
          ) : null}
        </View>
      )}

      {canMessage || problem.status === 'requested' ? (
        <View style={styles.problemActions}>
          {canMessage ? (
            <TouchableOpacity onPress={onMessage} hitSlop={8} accessibilityRole="button" style={styles.problemAction}>
              <Ionicons name="chatbubble-outline" size={15} color={Colors.light.tint} />
              <Text style={styles.problemActionText}>{`Message ${order.storeName || 'the store'}`}</Text>
            </TouchableOpacity>
          ) : null}
          {problem.status === 'requested' ? (
            <TouchableOpacity onPress={onWithdraw} hitSlop={8} accessibilityRole="button" style={styles.problemAction}>
              <Text style={styles.problemWithdrawText}>Withdraw report</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const CREAM_SOFT = 'rgba(250,247,242,0.22)';
const PAPER_TINT = '#F8F3EB';
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: Colors.light.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'transparent',
    zIndex: 2,
  },
  headerScrolled: { borderBottomColor: Colors.light.border },
  headerBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 16.5, fontWeight: '600', color: Colors.light.text },
  content: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: Colors.light.icon,
    marginTop: 24,
    marginBottom: 10,
    marginHorizontal: 4,
  },

  // Status card
  heroShadow: {
    borderRadius: 28,
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 14 },
    elevation: 6,
  },
  hero: { borderRadius: 28, padding: 18, paddingBottom: 20, overflow: 'hidden' },
  heroRing: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    right: -70,
    top: -90,
    borderWidth: 1.5,
    borderColor: 'rgba(250,247,242,0.12)',
  },
  heroRingBig: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    right: -125,
    top: -145,
    borderWidth: 1.5,
    borderColor: 'rgba(250,247,242,0.07)',
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  orderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 30,
    paddingLeft: 11,
    paddingRight: 5,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(250,247,242,0.14)',
  },
  orderPillLabel: { fontSize: 11, fontWeight: '500', letterSpacing: 0.9, color: 'rgba(250,247,242,0.75)' },
  orderPillNumber: { fontSize: 11.5, fontWeight: '600', letterSpacing: 0.9, color: CREAM, fontVariant: ['tabular-nums'] },
  orderPillIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(250,247,242,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroDate: { flexShrink: 1, fontSize: 11.5, color: 'rgba(250,247,242,0.8)' },
  heroMain: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18, marginBottom: 20 },
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: 'rgba(250,247,242,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroWords: { flex: 1 },
  heroTitle: { fontSize: 25, fontWeight: '600', letterSpacing: -0.4, color: CREAM, alignSelf: 'flex-start' },
  heroSub: { fontSize: 12.5, lineHeight: 18, color: 'rgba(250,247,242,0.86)', marginTop: 3 },
  cancelNote: {
    fontSize: 12.5,
    lineHeight: 19,
    color: CREAM,
    backgroundColor: 'rgba(0,0,0,0.16)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    overflow: 'hidden',
  },

  // Tracker
  trackWrap: { backgroundColor: 'rgba(0,0,0,0.14)', borderRadius: 18, paddingTop: 14, paddingBottom: 10, paddingHorizontal: 4 },
  track: { flexDirection: 'row' },
  trackStep: { flex: 1, alignItems: 'center' },
  trackTodo: { opacity: 0.6 },
  trackLine: {
    position: 'absolute',
    top: 10,
    right: '50%',
    width: '100%',
    height: 3,
    borderRadius: 2,
    backgroundColor: CREAM_SOFT,
  },
  trackLineOn: { backgroundColor: CREAM },
  trackDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(250,247,242,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackDotOn: { backgroundColor: CREAM, borderColor: CREAM },
  trackDotNow: {
    shadowColor: CREAM,
    shadowOpacity: 0.6,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  nowInner: { width: 8, height: 8, borderRadius: 4 },
  trackLabel: { fontSize: 11, fontWeight: '600', color: CREAM, marginTop: 7 },
  trackSub: { fontSize: 10, color: 'rgba(250,247,242,0.8)', marginTop: 1 },

  // Dashed rule
  dashClip: { height: 1, overflow: 'hidden' },
  dashBox: { height: 2, borderWidth: 1, borderStyle: 'dashed', borderRadius: 1 },

  // Receipt
  receipt: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 26 },
  cut: { marginVertical: 16, marginHorizontal: -16, justifyContent: 'center' },
  cutBite: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.light.background,
  },
  cutBiteLeft: { left: -9 },
  cutBiteRight: { right: -9 },

  // Seller
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  sellerWho: { flex: 1, minWidth: 0 },
  sellerName: { fontSize: 14, fontWeight: '600', color: Colors.light.text, lineHeight: 18 },
  sellerRole: { fontSize: 11.5, color: Colors.light.icon, marginTop: 1 },
  msgBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.light.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  msgBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.light.text,
    borderWidth: 2,
    borderColor: '#fff',
  },

  // Items
  emptyItemsText: { fontSize: 13, color: Colors.light.icon },
  itemGap: { marginTop: 14 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemImage: { width: 64, height: 64, borderRadius: 16, backgroundColor: '#ECE7DF' },
  itemImagePlaceholder: { justifyContent: 'center', alignItems: 'center' },
  itemDetails: { flex: 1, minWidth: 0 },
  itemName: { fontSize: 14, fontWeight: '600', color: Colors.light.text, lineHeight: 18 },
  itemMeta: { fontSize: 12, color: Colors.light.icon, marginTop: 2 },
  itemPrice: { fontSize: 14.5, fontWeight: '600', color: Colors.light.highlight, fontVariant: ['tabular-nums'] },
  reviewStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: PAPER_TINT,
  },
  // The editable stars bring their own 44pt targets, so less padding.
  reviewStripAsk: { flexDirection: 'column', alignItems: 'stretch', gap: 0, paddingTop: 10, paddingBottom: 2 },
  reviewAskLine: { textAlign: 'center' },
  reviewAskStars: { justifyContent: 'center' },
  reviewWords: { flex: 1 },
  reviewTitle: { fontSize: 12.5, fontWeight: '500', color: Colors.light.text },
  reviewHint: { fontSize: 11, color: Colors.light.icon },
  reviewEdit: { fontSize: 12.5, fontWeight: '600', color: Colors.light.tint, marginLeft: 4 },

  // Totals
  totLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totLabel: { fontSize: 13, color: Colors.light.icon },
  totValue: { fontSize: 13, fontWeight: '500', color: Colors.light.text, fontVariant: ['tabular-nums'] },
  totFree: { fontSize: 13, fontWeight: '600', color: Colors.light.success },
  totBig: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0E9DF',
  },
  totBigLabel: { fontSize: 14.5, fontWeight: '600', color: Colors.light.text },
  totBigValue: { fontSize: 24, fontWeight: '600', color: Colors.light.highlight, fontVariant: ['tabular-nums'], letterSpacing: -0.2 },

  // Payment
  pay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 16,
    backgroundColor: PAPER_TINT,
  },
  payIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  payTitle: { fontSize: 13.5, fontWeight: '600', color: Colors.light.text },
  payBody: { fontSize: 11, color: Colors.light.icon, lineHeight: 15 },
  payRef: { fontSize: 10.5, color: Colors.light.icon, fontFamily: MONO, marginTop: 1 },
  paidPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 26,
    paddingLeft: 8,
    paddingRight: 10,
    borderRadius: Radius.pill,
    backgroundColor: '#E9EDE4',
  },
  paidPillWarm: { backgroundColor: '#F3E9D2', paddingLeft: 10 },
  paidPillText: { fontSize: 11.5, fontWeight: '600', color: '#3F4B36' },
  paidPillTextWarm: { color: '#6B5A2E' },

  // Icon rows (address, help)
  addressCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, paddingHorizontal: 16, borderRadius: 22 },
  ico: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  icoClay: { backgroundColor: '#F6E6DE' },
  icoMoss: { backgroundColor: '#EEF0EA' },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 14, fontWeight: '600', color: Colors.light.text, marginBottom: 1 },
  rowBody: { fontSize: 12.5, color: Colors.light.icon, lineHeight: 19 },

  // Need help?
  helpCard: { padding: 0, borderRadius: 22, overflow: 'hidden' },
  helpRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16 },
  helpRowRule: { borderTopWidth: 1, borderTopColor: '#F1EBE2' },
  daysChip: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: '#F3E9D2',
    color: '#6B5A2E',
    fontSize: 10.5,
    fontWeight: '600',
    overflow: 'hidden',
  },
  foot: { textAlign: 'center', fontSize: 11, color: '#A0968C', marginTop: 20 },

  // Problem report
  problemCard: { padding: 14 },
  problemHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  problemLine: { fontSize: 13, color: Colors.light.text, lineHeight: 19, marginTop: 10 },
  problemQuote: {
    marginTop: 10,
    padding: 12,
    borderRadius: Radius.md,
    backgroundColor: Colors.light.border + '60',
  },
  problemQuoteLabel: { fontSize: 11, fontWeight: '600', color: Colors.light.icon, marginBottom: 2 },
  problemQuoteText: { fontSize: 13, color: Colors.light.text, lineHeight: 19 },
  problemMoney: { marginTop: 10, paddingTop: 6, borderTopWidth: 1, borderTopColor: Colors.light.border },
  problemAmount: { fontSize: 14, fontWeight: '600', color: Colors.light.highlight, fontVariant: ['tabular-nums'] },
  problemRef: { fontFamily: MONO, fontSize: 12.5 },
  problemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  problemAction: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  problemActionText: { fontSize: 13, fontWeight: '600', color: Colors.light.tint },
  problemWithdrawText: { fontSize: 13, fontWeight: '600', color: Colors.light.icon },
  dialogBody: { fontSize: 14, color: Colors.light.icon, lineHeight: 20, textAlign: 'center' },

  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyActionWrap: { marginTop: Spacing.md, width: 200, alignSelf: 'center' },
});
