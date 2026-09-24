// screens/admin/AdminOrdersScreen.js
//
// Manage Orders, from the approved staff-screens preview: one summary card
// (delivered revenue, open value, the whole pipeline as one bar), search,
// status chips, and order cards that say what happens next ("Mark as
// shipped"). Tapping a card opens one status sheet that moves the order a
// single step forward, or cancels it behind a confirmation.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { showAppAlert } from '../../utils/appAlert';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  useReducedMotion,
  FadeInDown,
} from 'react-native-reanimated';
import { db } from '../../firebaseConfig';
import {
  collectionGroup,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  runTransaction,
} from 'firebase/firestore';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { useAdmin } from '../../context/AdminContext';
import { parseStock, totalQuantityByProductId } from '../../utils/stock';
import { orderNumber, normalizeOrderNumberQuery } from '../../utils/orderNumber';
import { Colors, Spacing, Radius } from '../../constants/theme';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import AnimatedPressable from '../../components/ui/AnimatedPressable';
import SkeletonBlock from '../../components/ui/Skeleton';
import ProductImage from '../../components/ui/ProductImage';
import Sheet from '../../components/shop/Sheet';
import Reveal from '../../components/shop/Reveal';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../../constants/motion';
import { logStoreActivity, ACTIONS } from '../../utils/activityLog';
import {
  getPaymentLabel,
  getPaymentStatus,
  getPaymentStatusLabel,
  getPaymongoReceipt,
  isPayOnDelivery,
} from '../../constants/payment';
import { chatFields, hasUnread } from '../../utils/orderChat';

// Which statuses an order may be cancelled FROM.
//
// Cancelling restores the stock that checkout decremented, so the question
// "can this be cancelled?" is really "are the goods still ours?". Up to and
// including Processing they are: nothing has left the shop, and putting the
// item back on the shelf is exactly right. Once an order is Shipped the item
// is in transit and may already be with the customer — restoring stock there
// would invent inventory that doesn't physically exist, and a returned parcel
// is a returns/restocking flow, not a cancellation. Delivered is the same
// case, more so.
//
// Cancelled is absent from this list on purpose, and that absence is the
// idempotency guard: a second cancellation of an already-cancelled order is
// a transition FROM 'cancelled', so it fails this check and no stock is
// restored twice. Enforced identically in firestore.rules, so a stale screen,
// a double tap, or a second manager racing the first is refused by the
// backend and not merely by this component.
const CANCELLABLE_FROM = ['pending', 'processing'];

// Marks a transaction abort that carries a message worth showing the manager
// verbatim — a refused transition, not a fault. Throwing out of the
// transaction callback is what rolls the whole thing back, and Firestore
// does not retry a callback that threw for its own reasons.
const statusError = (message) => {
  const error = new Error(message);
  error.statusMessage = message;
  return error;
};

const canCancelFrom = (status) => CANCELLABLE_FROM.includes(status || 'pending');

// The forward progression an order moves through. 'cancelled' is
// deliberately absent: it is an exit from the sequence rather than a step
// in it, and it has its own guard above.
//
// The status sheet only ever offers the NEXT step. A picker that offered
// every status made skipping a step and mis-tapping backwards as easy as
// progress. The one correction that matters — a manager tapping "Mark as
// delivered" a step too early — is covered by the Undo on the toast that
// follows every move, which puts the order back where it was. A step back
// is still a legal write in firestore.rules (it has no inventory effect),
// and the activity log records both the move and its undo.
const STATUS_SEQUENCE = ['pending', 'processing', 'shipped', 'delivered'];
const nextStatusOf = (status) => {
  const i = STATUS_SEQUENCE.indexOf(status);
  return i > -1 && i < STATUS_SEQUENCE.length - 1 ? STATUS_SEQUENCE[i + 1] : null;
};

// Each status's pill (ink on tint) and its colour in the summary bar.
// Distinct hues so a manager triaging a queue tells "nothing started",
// "being worked" and "on its way" apart at a glance. Processing, the one
// being worked on, is Clay, as it is on the buyer's side (the approved
// orders-and-chat preview); it replaced a blue that wasn't in the palette.
const STATUS = {
  pending: { label: 'Pending', ink: '#8E640C', bg: '#F6ECD2', bar: '#C9A227' },
  processing: { label: 'Processing', ink: '#A94F2E', bg: '#F7E7DF', bar: Colors.light.tint },
  shipped: { label: 'Shipped', ink: '#6A4C7A', bg: '#EDE5F1', bar: '#A887B8' },
  delivered: { label: 'Delivered', ink: '#465A3B', bg: '#E3E9DC', bar: '#9DB38A' },
  cancelled: { label: 'Cancelled', ink: '#A33A2A', bg: '#F6E0DA', bar: '#D0705E' },
};
const STATUS_KEYS = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
const getStatusLabel = (status) => STATUS[status]?.label || 'Unknown';

const OLIVE_INK = '#2C3427';
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const AVATAR_TONES = ['#C4623E', '#5B6B4F', '#8A6A3E', '#6E5A7A', '#3D5A73', '#A94F2E'];

// The same customer gets the same tile colour on every visit.
const avatarTone = (email) => {
  let h = 0;
  for (let i = 0; i < email.length; i += 1) h = (h * 31 + email.charCodeAt(i)) % 997;
  return AVATAR_TONES[h % AVATAR_TONES.length];
};

// Manual thousands-grouping, as on the dashboard — Hermes builds aren't
// guaranteed to ship the Intl data toLocaleString would need.
const peso = (value) => {
  const [intPart, decPart] = (Number(value) || 0).toFixed(2).split('.');
  return `₱${intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decPart}`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatDateTime = (date) => {
  if (!date) return '';
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
};

const itemLine = (item) => [item.name, item.size].filter(Boolean).join(' · ');

const HOUR_MS = 60 * 60 * 1000;
const ATTENTION_THRESHOLD_HOURS = 24;
const TOAST_MS = 5000;

// Shaped like a real order card so the loading state previews the content
// that's about to arrive, instead of a spinner floating mid-screen.
function OrderCardSkeleton() {
  return (
    <Card variant="flat" style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ gap: 6 }}>
          <SkeletonBlock style={{ width: 96, height: 14, borderRadius: Radius.sm }} />
          <SkeletonBlock style={{ width: 60, height: 10, borderRadius: Radius.sm }} />
        </View>
        <SkeletonBlock style={{ width: 78, height: 24, borderRadius: Radius.pill }} />
      </View>
      <View style={styles.cardMid}>
        <SkeletonBlock style={{ width: 36, height: 36, borderRadius: 11 }} />
        <View style={{ flex: 1, gap: 6 }}>
          <SkeletonBlock style={{ width: '70%', height: 12, borderRadius: Radius.sm }} />
          <SkeletonBlock style={{ width: '50%', height: 10, borderRadius: Radius.sm }} />
        </View>
      </View>
      <SkeletonBlock style={{ width: '100%', height: 4, borderRadius: 2 }} />
    </Card>
  );
}

function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.pending;
  return (
    <View style={[styles.pill, { backgroundColor: s.bg }]}>
      <View style={[styles.pillDot, { backgroundColor: s.ink }]} />
      <Text style={[styles.pillText, { color: s.ink }]}>{s.label}</Text>
    </View>
  );
}

// Four segments, one per step; a cancelled order shows only the first, in
// Rust.
function Track({ status }) {
  const cancelled = status === 'cancelled';
  const idx = cancelled ? 0 : STATUS_SEQUENCE.indexOf(status);
  return (
    <View style={styles.track}>
      {STATUS_SEQUENCE.map((s, i) => (
        <View
          key={s}
          style={[
            styles.trackSeg,
            i <= idx && { backgroundColor: cancelled ? STATUS.cancelled.ink : Colors.light.success },
          ]}
        />
      ))}
    </View>
  );
}

// Revenue is DELIVERED orders only — the same definition the dashboard's
// "Delivered" figure uses. The old tile summed every non-cancelled order,
// which counted money for parcels still on the shelf; open orders now show
// as their own line underneath.
function Summary({ counts, deliveredValue, openValue, onFilter }) {
  const present = STATUS_KEYS.filter((k) => counts[k] > 0);
  return (
    <Reveal delay={20} style={styles.summary}>
      <View style={styles.summaryRing} pointerEvents="none" />
      <View style={styles.sumTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sumLabel}>DELIVERED REVENUE</Text>
          <Text style={styles.sumRev} numberOfLines={1} adjustsFontSizeToFit>
            {peso(deliveredValue)}
          </Text>
          <Text style={styles.sumSub}>
            <Text style={styles.sumSubStrong}>{peso(openValue)}</Text> in open orders
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.sumLabel}>ORDERS</Text>
          <Text style={styles.sumTotal}>{counts.all}</Text>
        </View>
      </View>
      {present.length > 0 && (
        <View style={styles.pipe}>
          {present.map((k) => (
            <Pressable
              key={k}
              onPress={() => onFilter(k)}
              style={[styles.pipeSeg, { flexGrow: counts[k], backgroundColor: STATUS[k].bar }]}
              accessibilityRole="button"
              accessibilityLabel={`${STATUS[k].label}: ${counts[k]}. Show these orders`}
            />
          ))}
        </View>
      )}
      <View style={styles.legend}>
        {STATUS_KEYS.map((k) => (
          <View key={k} style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: STATUS[k].bar }]} />
            <Text style={styles.legendText}>
              {STATUS[k].label} <Text style={styles.legendCount}>{counts[k]}</Text>
            </Text>
          </View>
        ))}
      </View>
    </Reveal>
  );
}

function OrderCard({ order, now, onPress }) {
  const ageHours = order.date ? (now - order.date.getTime()) / HOUR_MS : null;
  const needsAttention =
    order.status === 'pending' && ageHours !== null && ageHours >= ATTENTION_THRESHOLD_HOURS;
  const unread = hasUnread(order, 'store');
  const next = nextStatusOf(order.status);
  const first = order.items[0];
  const more = order.items.length > 1 ? ` +${order.items.length - 1} more` : '';
  const itemCount = order.items.length;

  return (
    <AnimatedPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.orderNumber}, ${getStatusLabel(order.status)}, ${peso(order.total)}${needsAttention ? ', waiting over a day' : ''}${unread ? ', new message from the buyer' : ''}`}
      accessibilityHint={next ? `Opens the status sheet to mark it as ${getStatusLabel(next).toLowerCase()}` : 'Opens the order'}
    >
      <Card variant="flat" style={styles.card}>
        <View style={styles.cardTop}>
          <View>
            <Text style={styles.oid}>
              <Text style={styles.oidHash}>#</Text>
              {order.orderNumber}
            </Text>
            <Text style={[styles.when, needsAttention && styles.whenLate]}>
              {formatRelativeTime(order.date, now)}
              {needsAttention ? ' · waiting' : ''}
            </Text>
          </View>
          <StatusPill status={order.status} />
        </View>

        <View style={styles.cardMid}>
          <View style={[styles.avatar, { backgroundColor: avatarTone(order.customerEmail) }]}>
            <Text style={styles.avatarText}>{order.customerEmail.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.itemName} numberOfLines={1}>
              {first ? itemLine(first) : 'No items'}
              {more}
            </Text>
            <Text style={styles.email} numberOfLines={1}>
              {order.customerEmail}
            </Text>
          </View>
          <Text style={styles.price}>{peso(order.total)}</Text>
        </View>

        <Track status={order.status} />

        <View style={styles.cardFoot}>
          <View style={styles.meta}>
            <View style={styles.payTag}>
              <Text style={styles.payTagText}>{getPaymentLabel(order.paymentMethod)}</Text>
            </View>
            <Text style={styles.metaText}>
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </Text>
            {unread && (
              <View style={styles.msg}>
                <View style={styles.msgDot} />
                <Text style={styles.msgText}>New message</Text>
              </View>
            )}
          </View>
          {next ? (
            <View style={styles.next}>
              <Text style={styles.nextText}>Mark as {getStatusLabel(next).toLowerCase()}</Text>
              <Ionicons name="arrow-forward" size={14} color={Colors.light.tint} />
            </View>
          ) : order.status === 'delivered' ? (
            <View style={styles.next}>
              <Ionicons name="checkmark" size={14} color={STATUS.delivered.ink} />
              <Text style={[styles.nextText, { color: STATUS.delivered.ink }]}>Complete</Text>
            </View>
          ) : (
            <Text style={[styles.nextText, { color: Colors.light.icon }]}>Closed</Text>
          )}
        </View>
      </Card>
    </AnimatedPressable>
  );
}

// Favors "2h ago" over an absolute date on the list card — a shift
// scanning dozens of orders reads recency faster than a calendar date.
// The status sheet still shows the precise date for the record.
function formatRelativeTime(date, now) {
  if (!date) return '';
  const diffHours = Math.max(0, (now - date.getTime()) / HOUR_MS);
  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
  const days = Math.floor(diffHours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

// The stepper in the status sheet: done steps ticked in Moss, the current
// one ringed, the next one dashed in Clay.
function Steps({ order }) {
  const cur = order.status;
  const idx = STATUS_SEQUENCE.indexOf(cur);
  return (
    <View>
      {STATUS_SEQUENCE.map((s, i) => {
        let state;
        if (cur === 'cancelled') state = i === 0 ? 'done' : 'todo';
        else if (i < idx || (i === idx && cur === 'delivered')) state = 'done';
        else if (i === idx) state = 'current';
        else if (i === idx + 1) state = 'next';
        else state = 'todo';
        const last = i === STATUS_SEQUENCE.length - 1;
        const note =
          i === 0 && order.date ? `Placed ${formatDateTime(order.date)}` : state === 'next' ? 'Next step' : '';
        return (
          <View key={s} style={[styles.step, last && { paddingBottom: 0 }]}>
            {!last && <View style={[styles.stepLine, state === 'done' && styles.stepLineDone]} />}
            <View
              style={[
                styles.stepDot,
                state === 'done' && styles.stepDotDone,
                state === 'current' && styles.stepDotCurrent,
                state === 'next' && styles.stepDotNext,
              ]}
            >
              {state === 'done' && <Ionicons name="checkmark" size={15} color="#fff" />}
              {state === 'current' && <View style={styles.stepDotInner} />}
            </View>
            <Text
              style={[
                styles.stepLabel,
                state === 'todo' && styles.stepLabelTodo,
                state === 'next' && styles.stepLabelNext,
              ]}
            >
              {STATUS[s].label}
              {note ? <Text style={styles.stepNote}>{`  ${note}`}</Text> : null}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function Toast({ toast, onUndo }) {
  const reduceMotion = useReducedMotion();
  const shown = useSharedValue(0);
  useEffect(() => {
    const to = toast ? 1 : 0;
    shown.value = reduceMotion ? to : withTiming(to, { duration: 300, easing: EASE_OUT_QUINT });
  }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * 80 }],
  }));
  return (
    <Animated.View
      style={[styles.toast, style]}
      pointerEvents={toast ? 'auto' : 'none'}
      accessibilityLiveRegion="polite"
    >
      <Ionicons name="checkmark" size={16} color="#C9A227" />
      <Text style={styles.toastText}>{toast?.message}</Text>
      {toast?.undo && (
        <Pressable onPress={onUndo} hitSlop={10} accessibilityRole="button" accessibilityLabel="Undo">
          <Text style={styles.toastUndo}>Undo</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}

export default function AdminOrdersScreen({ navigation, route }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ordersError, setOrdersError] = useState(false);
  const [updating, setUpdating] = useState(false);
  // Support's "Order #…" link arrives with the order number as `search`.
  const [searchQuery, setSearchQuery] = useState(route?.params?.search || '');
  const [activeTab, setActiveTab] = useState('all');
  // By id, and read out of the live list: the sheet then follows a change
  // another manager makes while it's open.
  const [openId, setOpenId] = useState(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  // Bumped by handleRetry() to force the listener below to tear down and
  // re-subscribe — same shape as StoreManagerDashboardScreen's retryToken, so a
  // permissions blip or bad connection at mount doesn't leave the list
  // silently stuck on an unrecoverable listener.
  const [retryToken, setRetryToken] = useState(0);
  const { isConnected } = useNetworkStatus();
  // The store this manager runs. Their order list is that store's orders
  // and nothing else — firestore.rules refuses any other order to them,
  // and refuses an unfiltered query outright.
  const { storeId } = useAdmin();
  const reduceMotion = useReducedMotion();

  // Ticks once a minute so "2h ago" style timestamps and the "needs
  // attention" aging check stay accurate through a long admin session,
  // without needing a re-render on every Firestore update to notice.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // A manager with no store has no orders to see, and the query below
    // would be refused anyway. Shown as its own empty state rather than
    // as a load error, because retrying cannot fix it.
    if (!storeId) {
      setOrders([]);
      setOrdersError(false);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setOrdersError(false);

    // collectionGroup reads the "orders" subcollection across every user
    // document at once (users/{uid}/orders), which is how a manager sees
    // orders placed by all customers instead of just one — filtered to
    // their own store. The filter is not optional: firestore.rules only
    // admits a query that cannot return another store's order.
    // Needs the (storeId, createdAt desc) collection-group index in
    // firestore.indexes.json.
    const ordersQuery = query(
      collectionGroup(db, 'orders'),
      where('storeId', '==', storeId),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      ordersQuery,
      (snapshot) => {
        const fetched = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const items = data.items || [];

          return {
            id: docSnap.id,
            ref: docSnap.ref, // needed to write status updates back to the correct document
            // Stored BARE, without the leading "#", because this field is
            // what the search box below filters against — and a customer
            // reading the number off a receipt or an email may or may not
            // include the hash when they quote it. The render sites add
            // it themselves.
            orderNumber: orderNumber(docSnap.id),
            customerEmail: data.customerEmail || 'Unknown customer',
            customerId: data.customerId || null,
            date: data.createdAt?.toDate ? data.createdAt.toDate() : null,
            total: data.total || 0,
            subtotal: data.subtotal || 0,
            shipping: data.shipping || 0,
            status: data.status || 'pending',
            paymentMethod: data.paymentMethod || null,
            paymentStatus: data.paymentStatus || null,
            paymentRef: data.paymentRef || null,
            paymentSandbox: data.paymentSandbox === true,
            paymentProvider: data.paymentProvider || null,
            items,
            // The order lives at users/{uid}/orders/{id}; the chat lives
            // under it, so the path is the customer's id to trust — not
            // the customerId field, which older orders may not carry.
            chatCustomerId: docSnap.ref.parent.parent.id,
            ...chatFields(data),
          };
        });
        setOrders(fetched);
        setOrdersError(false);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching orders:', error);
        setOrdersError(true);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [retryToken, storeId]);

  const handleRetry = () => setRetryToken((t) => t + 1);

  const filteredOrders = orders.filter((order) => {
    const q = searchQuery.trim().toLowerCase();
    // The order number is matched against a NORMALISED query, the email
    // against the raw one. They need different treatment: a customer
    // quotes their number as "#NOMDQMGO" because that is what every screen
    // and the receipt email show them, while the stored value is bare —
    // so a paste of the displayed form matched nothing and said nothing.
    // An email address, meanwhile, must keep its "@" and dots.
    //
    // Guarded on length so an empty search still matches everything:
    // "".includes("") is true, which is the behaviour an empty box should
    // have, but ''.includes() on the normalised side would make the first
    // clause true for every row regardless.
    const orderQuery = normalizeOrderNumberQuery(searchQuery).toLowerCase();
    const matchesSearch =
      (orderQuery.length > 0 && order.orderNumber.toLowerCase().includes(orderQuery)) ||
      order.customerEmail.toLowerCase().includes(q);

    if (activeTab === 'all') return matchesSearch;
    return matchesSearch && order.status === activeTab;
  });

  const counts = { all: orders.length };
  STATUS_KEYS.forEach((k) => {
    counts[k] = orders.filter((o) => o.status === k).length;
  });
  const deliveredValue = orders
    .filter((o) => o.status === 'delivered')
    .reduce((sum, o) => sum + Number(o.total || 0), 0);
  const openValue = orders
    .filter((o) => o.status !== 'delivered' && o.status !== 'cancelled')
    .reduce((sum, o) => sum + Number(o.total || 0), 0);

  const openOrder = orders.find((o) => o.id === openId) || null;
  // The sheet keeps showing the last order through its closing slide.
  const lastSheetOrder = useRef(null);
  if (openOrder) lastSheetOrder.current = openOrder;
  const sheetOrder = openOrder || lastSheetOrder.current;
  const sheetReceipt = getPaymongoReceipt(sheetOrder);

  const showToast = (next) => {
    clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  const selectFilter = (id) => {
    Haptics.selectionAsync();
    setActiveTab(id);
  };

  const openSheet = (order) => {
    Haptics.selectionAsync();
    setConfirmingCancel(false);
    setOpenId(order.id);
  };

  const closeSheet = () => {
    if (updating) return;
    setOpenId(null);
    setConfirmingCancel(false);
  };

  // The number a buyer quotes, copied to paste into an email or a note.
  const [copiedId, setCopiedId] = useState(null);
  const copiedTimer = useRef(null);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const handleCopyNumber = async (order) => {
    try {
      await Clipboard.setStringAsync(`#${order.orderNumber}`);
      Haptics.selectionAsync();
      setCopiedId(order.id);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedId(null), 1600);
    } catch (error) {
      console.error('Could not copy order number:', error);
    }
  };

  const handleOpenChat = (order) => {
    Haptics.selectionAsync();
    setOpenId(null);
    navigation.navigate('OrderChat', {
      customerId: order.chatCustomerId,
      orderId: order.id,
      side: 'store',
      title: order.customerEmail,
    });
  };

  // Moves one order to `newStatus` in a transaction and logs it. Returns
  // the status it moved FROM on success (for Undo), or null.
  const applyStatusUpdate = async (order, newStatus, { isUndo = false } = {}) => {
    if (!order?.ref || newStatus === order.status) return null;
    setUpdating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const orderRef = order.ref;
      // Read back out of the transaction rather than taken from the
      // rendered order: the log should record what the document actually
      // said at write time, not what this screen last rendered.
      let previousStatus = order.status;
      let restoredUnits = 0;

      await runTransaction(db, async (transaction) => {
        // Reset per attempt — runTransaction re-runs the whole callback on
        // contention, and a retry that restores nothing must not inherit a
        // count from the attempt that lost the race.
        restoredUnits = 0;

        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists()) {
          throw statusError('This order no longer exists.');
        }

        const orderData = orderSnap.data();
        const currentStatus = orderData.status || 'pending';
        previousStatus = currentStatus;

        // The screen's copy of the order came from a snapshot listener and
        // may be seconds stale. Everything below decides on currentStatus,
        // read inside the transaction, so a concurrent change by another
        // manager is seen rather than overwritten.
        if (currentStatus === newStatus) {
          throw statusError(
            `This order is already ${getStatusLabel(newStatus)}. Nothing was changed.`
          );
        }

        if (newStatus !== 'cancelled') {
          transaction.update(orderRef, { status: newStatus });
          return;
        }

        if (!canCancelFrom(currentStatus)) {
          throw statusError(
            `A ${getStatusLabel(currentStatus).toLowerCase()} order can't be cancelled — ` +
              'the items have already left the shop. Only pending and processing orders ' +
              'can be cancelled.'
          );
        }

        // Cancelling gives back exactly what checkout took: the same
        // per-product totals, computed the same way. Reads first — a
        // Firestore transaction allows no read after its first write.
        const quantityByProductId = totalQuantityByProductId(
          orderData.items,
          (item) => item.productId
        );
        const productIds = Array.from(quantityByProductId.keys());
        const productRefs = productIds.map((id) => doc(db, 'products', id));
        const productSnaps = await Promise.all(
          productRefs.map((ref) => transaction.get(ref))
        );

        productSnaps.forEach((snap, index) => {
          // A product deleted since the order was placed has nothing to
          // restore onto, and transaction.update() on a missing document
          // would fail the whole transaction — blocking the cancellation
          // over a product that no longer exists. Skipped instead, so the
          // order can still be cancelled.
          if (!snap.exists()) return;
          const restoreQty = quantityByProductId.get(productIds[index]);
          restoredUnits += restoreQty;
          // Written as a real number for the same reason checkout does:
          // firestore.rules requires a product to be left well-typed.
          transaction.update(productRefs[index], {
            stock: parseStock(snap.data().stock) + restoreQty,
          });
        });

        // Last, and in this same transaction — if any restore above fails,
        // the status never moves, and if the status write is refused, no
        // stock is restored. The two cannot come apart.
        transaction.update(orderRef, { status: newStatus });
      });

      // Records the transition, not just the new value — "who moved this
      // order to cancelled, and what was it before?" is the question the
      // SRS's audit clause exists to answer. The restored quantity rides
      // along on a cancellation, since that is the part with an inventory
      // consequence someone may later need to account for.
      const restoreNote =
        newStatus === 'cancelled' && restoredUnits > 0
          ? `, ${restoredUnits} item(s) returned to stock`
          : '';
      logStoreActivity({
        storeId,
        action: ACTIONS.ORDER_STATUS,
        targetId: order.id,
        targetLabel: `Order #${order.orderNumber || order.id}`,
        summary:
          `Order #${order.orderNumber || order.id} — status ` +
          `${getStatusLabel(previousStatus)} → ${getStatusLabel(newStatus)}${restoreNote}` +
          `${isUndo ? ' (undo)' : ''}`,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (newStatus === 'cancelled') {
        showToast({
          message: `#${order.orderNumber} cancelled${
            restoredUnits > 0 ? ` · ${restoredUnits} item${restoredUnits === 1 ? '' : 's'} back in stock` : ''
          }`,
        });
      } else if (isUndo) {
        showToast({ message: `#${order.orderNumber} is back to ${getStatusLabel(newStatus).toLowerCase()}` });
      } else {
        showToast({
          message: `#${order.orderNumber} marked as ${getStatusLabel(newStatus).toLowerCase()}`,
          undo: { order: { ...order, status: newStatus }, to: previousStatus },
        });
      }
      return previousStatus;
    } catch (error) {
      console.error('Error updating order status:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      const isNetworkError = !isConnected || error.code === 'unavailable';
      if (isNetworkError) {
        showAppAlert(
          'No Internet Connection',
          'Network connection lost. Please check your connection and try again.'
        );
        return null;
      }

      // A rejected transition is a normal outcome with a specific reason,
      // not a failure the manager should read as "try again" — say which
      // rule stopped it.
      if (error.statusMessage) {
        showAppAlert('Status Not Changed', error.statusMessage);
        return null;
      }

      showAppAlert('Error', 'Could not update order status. Please try again.');
      return null;
    } finally {
      setUpdating(false);
    }
  };

  const advance = async (order) => {
    const next = nextStatusOf(order.status);
    if (!next) return;
    if (await applyStatusUpdate(order, next)) setOpenId(null);
  };

  const cancelOrder = async (order) => {
    if (await applyStatusUpdate(order, 'cancelled')) {
      setOpenId(null);
      setConfirmingCancel(false);
    }
  };

  const undoLast = () => {
    const undo = toast?.undo;
    clearTimeout(toastTimer.current);
    setToast(null);
    if (undo) applyStatusUpdate(undo.order, undo.to, { isUndo: true });
  };

  const noResultsFromFilter = Boolean(searchQuery) || activeTab !== 'all';

  // The one action, pinned under the sheet. Messaging the buyer moved up
  // into the customer row, so this is the sheet's only filled button.
  const renderSheetActions = (order) => {
    const next = nextStatusOf(order.status);

    if (order.status === 'delivered' || order.status === 'cancelled') {
      const cancelled = order.status === 'cancelled';
      return (
        <>
          <View style={[styles.closedNote, cancelled && { backgroundColor: STATUS.cancelled.bg }]}>
            <Ionicons
              name={cancelled ? 'close' : 'checkmark'}
              size={16}
              color={cancelled ? STATUS.cancelled.ink : STATUS.delivered.ink}
            />
            <Text style={[styles.closedNoteText, cancelled && { color: STATUS.cancelled.ink }]}>
              {cancelled ? 'This order was cancelled.' : 'This order is complete. No further changes.'}
            </Text>
          </View>
        </>
      );
    }

    if (confirmingCancel) {
      const paidOnline = getPaymentStatus(order) === 'paid' && !isPayOnDelivery(order.paymentMethod);
      return (
        <View style={styles.confirm}>
          <Text style={styles.confirmText}>
            <Text style={{ fontWeight: '700' }}>Cancel order #{order.orderNumber}?</Text> The items go back to
            stock and the customer sees it as cancelled in My Orders. You can&apos;t undo this.
            {paidOnline ? ' It was paid online — no refund is sent automatically.' : ''}
          </Text>
          <View style={styles.confirmRow}>
            <Button
              variant="secondary"
              label="Keep order"
              fontSize={14}
              style={styles.confirmBtn}
              onPress={() => setConfirmingCancel(false)}
              disabled={updating}
            />
            <Button
              variant="danger"
              label="Cancel order"
              fontSize={14}
              style={styles.confirmBtn}
              onPress={() => cancelOrder(order)}
              loading={updating}
              disabled={!isConnected}
            />
          </View>
        </View>
      );
    }

    return (
      <>
        <Button
          label={!isConnected ? 'Offline' : `Mark as ${getStatusLabel(next).toLowerCase()}`}
          fontSize={15}
          onPress={() => advance(order)}
          loading={updating}
          disabled={!isConnected}
          fullWidth
        />
        <Text style={styles.actHint}>The buyer&apos;s order page updates right away.</Text>
        {canCancelFrom(order.status) && (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setConfirmingCancel(true);
            }}
            disabled={updating}
            style={({ pressed }) => [styles.ghost, pressed && { backgroundColor: STATUS.cancelled.bg }]}
            accessibilityRole="button"
          >
            <Text style={styles.ghostText}>Cancel order</Text>
          </Pressable>
        )}
      </>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <AnimatedPressable
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={Colors.light.text} />
        </AnimatedPressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} accessibilityRole="header">
            Orders
          </Text>
          <View style={styles.syncRow}>
            <View style={[styles.syncDot, !isConnected && styles.syncDotOff]} />
            <Text style={[styles.syncText, !isConnected && { color: Colors.light.danger }]}>
              {isConnected ? 'Live' : 'Offline · may be out of date'}
            </Text>
          </View>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Summary
          counts={counts}
          deliveredValue={deliveredValue}
          openValue={openValue}
          onFilter={selectFilter}
        />

        {/* Search */}
        <Reveal delay={80} style={styles.search}>
          <Ionicons name="search-outline" size={18} color={Colors.light.icon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Order # or customer email"
            placeholderTextColor={Colors.light.icon}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search orders by order number or customer email"
          />
          {searchQuery.length > 0 && (
            <Pressable
              onPress={() => setSearchQuery('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={18} color={Colors.light.icon} />
            </Pressable>
          )}
        </Reveal>

        {/* Status chips */}
        <Reveal delay={120}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsScroll}
            contentContainerStyle={styles.chips}
          >
            {['all', ...STATUS_KEYS].map((id) => {
              const isActive = activeTab === id;
              const label = id === 'all' ? 'All' : STATUS[id].label;
              return (
                <AnimatedPressable
                  key={id}
                  style={[styles.chip, isActive && styles.chipActive]}
                  onPress={() => selectFilter(id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={`${label}, ${counts[id]} orders`}
                >
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{label}</Text>
                  <View style={[styles.chipCount, isActive && styles.chipCountActive]}>
                    <Text style={[styles.chipCountText, isActive && styles.chipTextActive]}>{counts[id]}</Text>
                  </View>
                </AnimatedPressable>
              );
            })}
          </ScrollView>
        </Reveal>

        {/* Orders */}
        {loading ? (
          <View style={styles.list}>
            <OrderCardSkeleton />
            <OrderCardSkeleton />
            <OrderCardSkeleton />
          </View>
        ) : !storeId ? (
          <EmptyState
            icon="storefront-outline"
            title="No store assigned"
            subtitle="Your account isn't assigned to a store yet. Ask a Platform Admin to assign you one in Manage Users."
          />
        ) : ordersError ? (
          <View>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load orders"
              subtitle="Check your connection and try again."
            />
            <View style={styles.emptyStateAction}>
              <Button variant="outline" label="Retry" onPress={handleRetry} />
            </View>
          </View>
        ) : (
          <>
            <View style={styles.listHead}>
              <Text style={styles.listHeadText}>
                <Text style={styles.listHeadStrong}>{filteredOrders.length}</Text>{' '}
                {filteredOrders.length === 1 ? 'order' : 'orders'}
                {activeTab !== 'all' ? ` · ${STATUS[activeTab].label}` : ''}
              </Text>
              <Text style={styles.listHeadText}>Newest first</Text>
            </View>
            {filteredOrders.length > 0 ? (
              <View style={styles.list}>
                {filteredOrders.map((order, index) => (
                  <Animated.View
                    key={order.id}
                    entering={
                      reduceMotion
                        ? undefined
                        : FadeInDown.duration(240)
                            .delay(160 + Math.min(index, 8) * 40)
                            .easing(EASE_OUT_QUART)
                    }
                  >
                    <OrderCard order={order} now={now} onPress={() => openSheet(order)} />
                  </Animated.View>
                ))}
              </View>
            ) : (
              <View>
                <EmptyState
                  icon="receipt-outline"
                  title={
                    searchQuery
                      ? `No orders match "${searchQuery.trim()}"`
                      : `No ${activeTab === 'all' ? '' : `${STATUS[activeTab].label.toLowerCase()} `}orders`
                  }
                  subtitle={
                    searchQuery
                      ? 'Check the order number or email and try again.'
                      : activeTab !== 'all'
                        ? 'Orders show up here when they reach this status.'
                        : 'Orders will appear here once customers check out.'
                  }
                />
                {noResultsFromFilter && (
                  <View style={styles.emptyStateAction}>
                    <Button
                      variant="outline"
                      label="Clear filters"
                      onPress={() => {
                        setSearchQuery('');
                        setActiveTab('all');
                      }}
                    />
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Status sheet */}
      <Sheet
        visible={Boolean(openOrder)}
        onClose={closeSheet}
        locked={updating}
        footer={sheetOrder ? <View style={styles.actions}>{renderSheetActions(sheetOrder)}</View> : null}
      >
        {sheetOrder && (
          <View style={styles.sheet}>
            <View>
              <View style={styles.sheetHead}>
                <Text style={[styles.oid, styles.sheetOid]}>
                  <Text style={styles.oidHash}>#</Text>
                  {sheetOrder.orderNumber}
                </Text>
                <Pressable
                  onPress={() => handleCopyNumber(sheetOrder)}
                  hitSlop={10}
                  style={styles.copyBtn}
                  accessibilityRole="button"
                  accessibilityLabel={copiedId === sheetOrder.id ? 'Order number copied' : 'Copy order number'}
                >
                  <Ionicons
                    name={copiedId === sheetOrder.id ? 'checkmark' : 'copy-outline'}
                    size={15}
                    color={copiedId === sheetOrder.id ? Colors.light.success : Colors.light.icon}
                  />
                </Pressable>
                <View style={{ flex: 1 }} />
                <StatusPill status={sheetOrder.status} />
              </View>
              <Text style={styles.sheetSub} numberOfLines={1}>
                Placed {formatRelativeTime(sheetOrder.date, now).toLowerCase()}
                {sheetOrder.date ? ` · ${formatDateTime(sheetOrder.date)}` : ''}
              </Text>
            </View>

            {/* The buyer, and the way into the order's chat. */}
            <View style={styles.custRow}>
              <View style={[styles.custAvatar, { backgroundColor: avatarTone(sheetOrder.customerEmail) }]}>
                <Text style={styles.avatarText}>{sheetOrder.customerEmail.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.custEmail} numberOfLines={1}>
                  {sheetOrder.customerEmail}
                </Text>
                <Text style={styles.custMeta}>
                  Customer · {sheetOrder.items.length} {sheetOrder.items.length === 1 ? 'item' : 'items'}
                </Text>
              </View>
              <Pressable
                onPress={() => handleOpenChat(sheetOrder)}
                style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel={hasUnread(sheetOrder, 'store') ? 'Message buyer, new message' : 'Message buyer'}
              >
                <Ionicons name="chatbubble-outline" size={19} color={Colors.light.tint} />
                {hasUnread(sheetOrder, 'store') ? <View style={styles.chatBtnDot} /> : null}
              </Pressable>
            </View>

            <View style={styles.sheetSum}>
              {sheetOrder.items.map((item, i) => (
                <View key={i} style={styles.sheetItem}>
                  {item.image ? (
                    <ProductImage uri={item.image} style={styles.sheetItemImg} />
                  ) : (
                    <View style={[styles.sheetItemImg, styles.sheetItemImgEmpty]}>
                      <Ionicons name="shirt-outline" size={16} color={Colors.light.icon} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetItemName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.sheetItemMeta}>
                      {[item.size, item.color, `Qty ${item.quantity}`].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text style={styles.sheetItemPrice}>{peso(item.price)}</Text>
                </View>
              ))}
              <View style={styles.sumRow}>
                <Text style={styles.sumKey}>Payment</Text>
                <View style={styles.sumValRow}>
                  <Text style={styles.sumVal}>
                    {getPaymentLabel(sheetOrder.paymentMethod)} · {getPaymentStatusLabel(sheetOrder)}
                  </Text>
                  {sheetReceipt?.test ? <Text style={styles.testTag}>TEST</Text> : null}
                </View>
              </View>
              {/* The PayMongo payment id, to look the payment up in the
                  PayMongo dashboard. A test-mode payment is tagged above:
                  the Store Manager is the one who'd ship on a "Paid". */}
              {sheetReceipt ? (
                <View style={styles.gatewayRow}>
                  <Ionicons name="shield-checkmark-outline" size={13} color={Colors.light.success} />
                  <Text style={styles.gatewayText} numberOfLines={1}>
                    PayMongo{sheetReceipt.ref ? <Text style={styles.gatewayRef}>{`  ${sheetReceipt.ref}`}</Text> : null}
                  </Text>
                </View>
              ) : null}
              <View style={[styles.sumRow, styles.sumTotalRow]}>
                <Text style={styles.sumKey}>Total</Text>
                <Text style={styles.sumTotalVal}>{peso(sheetOrder.total)}</Text>
              </View>
            </View>

            <View>
              <Text style={styles.progressLabel}>PROGRESS</Text>
              <Steps order={sheetOrder} />
            </View>
          </View>
        )}
      </Sheet>

      <Toast toast={toast} onUndo={undoLast} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 10,
    marginTop: Platform.OS === 'ios' ? 0 : 30,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitleWrap: { alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  syncDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.light.success },
  syncDotOff: { backgroundColor: Colors.light.danger },
  syncText: { fontSize: 11, color: Colors.light.icon },
  scrollContent: { flexGrow: 1, paddingHorizontal: Spacing.md, paddingBottom: 96 },

  // Summary
  summary: {
    backgroundColor: OLIVE_INK,
    borderRadius: 22,
    padding: 16,
    paddingBottom: 14,
    gap: 12,
    overflow: 'hidden',
  },
  summaryRing: {
    position: 'absolute',
    right: -40,
    top: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 22,
    borderColor: 'rgba(201,162,39,0.08)',
  },
  sumTop: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  sumLabel: { fontSize: 10.5, letterSpacing: 1, color: '#B9B3A4', fontWeight: '500' },
  // The brand's bright gold: on this dark card it clears contrast, where
  // on Canvas it wouldn't (prices on light surfaces use highlight).
  sumRev: { fontSize: 28, fontWeight: '600', color: '#C9A227', fontVariant: ['tabular-nums'], marginTop: 2 },
  sumSub: { fontSize: 11.5, color: '#B9B3A4', marginTop: 2 },
  sumSubStrong: { color: '#EEE9DE', fontWeight: '500' },
  sumTotal: { fontSize: 22, fontWeight: '600', color: '#EEE9DE', fontVariant: ['tabular-nums'] },
  pipe: { flexDirection: 'row', height: 10, borderRadius: 6, overflow: 'hidden', gap: 2 },
  pipeSeg: { minWidth: 6 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 7, height: 7, borderRadius: 2 },
  legendText: { fontSize: 11, color: '#CFC9BB' },
  legendCount: { color: '#fff', fontWeight: '600' },

  // Search + chips
  search: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#FFFDF9',
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.light.text, paddingVertical: 0 },
  chipsScroll: { marginHorizontal: -Spacing.md },
  chips: { gap: 8, paddingTop: 12, paddingHorizontal: Spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 36,
    paddingLeft: 14,
    paddingRight: 8,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: '#FFFDF9',
  },
  chipActive: { backgroundColor: Colors.light.tint, borderColor: Colors.light.tint },
  chipText: { fontSize: 13, fontWeight: '500', color: '#4A433B' },
  chipTextActive: { color: '#fff' },
  chipCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: '#F1EBE1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipCountActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  chipCountText: { fontSize: 11, fontWeight: '600', color: '#4A433B', fontVariant: ['tabular-nums'] },

  // List
  listHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 10,
    marginHorizontal: 2,
  },
  listHeadText: { fontSize: 12, color: Colors.light.icon },
  listHeadStrong: { color: Colors.light.text, fontWeight: '600' },
  list: { gap: 10 },
  emptyStateAction: { marginTop: -Spacing.sm, paddingHorizontal: Spacing.xl },

  // Card
  card: { backgroundColor: '#FFFDF9', borderRadius: 18, padding: 14, gap: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  oid: { fontFamily: MONO, fontSize: 14, fontWeight: '600', color: Colors.light.text, letterSpacing: 0.3 },
  oidHash: { color: Colors.light.icon },
  when: { fontSize: 11.5, color: Colors.light.icon, marginTop: 1 },
  whenLate: { color: Colors.light.danger, fontWeight: '600' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 24,
    paddingHorizontal: 9,
    borderRadius: Radius.pill,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 11, fontWeight: '600' },
  cardMid: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  itemName: { fontSize: 13, fontWeight: '500', color: Colors.light.text },
  email: { fontSize: 11.5, color: Colors.light.icon },
  price: { fontSize: 16, fontWeight: '600', color: Colors.light.highlight, fontVariant: ['tabular-nums'] },
  track: { flexDirection: 'row', gap: 4 },
  trackSeg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: '#EDE6DA' },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  metaText: { fontSize: 11.5, color: Colors.light.icon },
  payTag: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.light.border,
    justifyContent: 'center',
  },
  payTagText: { fontSize: 10.5, fontWeight: '600', color: '#4A433B' },
  msg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: Radius.pill,
    backgroundColor: '#F5E3DA',
  },
  msgDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.light.tint },
  msgText: { fontSize: 10.5, fontWeight: '600', color: '#A94F2E' },
  next: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nextText: { fontSize: 12, fontWeight: '600', color: '#A94F2E' },

  // Sheet
  sheet: { gap: 16 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetOid: { fontSize: 19 },
  copyBtn: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sheetSub: { fontSize: 12, color: Colors.light.icon, marginTop: 2 },
  custRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: '#FFFDF9',
  },
  custAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  custEmail: { fontSize: 13.5, fontWeight: '600', color: Colors.light.text },
  custMeta: { fontSize: 11.5, color: Colors.light.icon, marginTop: 1 },
  // Clay-tinted, not filled: the sheet's one filled button is the status
  // move pinned below.
  chatBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FBF1EC',
    borderWidth: 1,
    borderColor: '#F7E7DF',
  },
  chatBtnDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.light.tint,
    borderWidth: 2,
    borderColor: Colors.light.background,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    color: Colors.light.icon,
    marginBottom: 10,
  },
  actHint: { fontSize: 11.5, color: Colors.light.icon, textAlign: 'center', marginTop: -2 },
  sheetSum: {
    backgroundColor: '#FFFDF9',
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  sheetItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetItemImg: { width: 40, height: 40, borderRadius: 10 },
  sheetItemImgEmpty: { backgroundColor: Colors.light.border, alignItems: 'center', justifyContent: 'center' },
  sheetItemName: { fontSize: 13, fontWeight: '500', color: Colors.light.text },
  sheetItemMeta: { fontSize: 11.5, color: Colors.light.icon, marginTop: 1 },
  sheetItemPrice: { fontSize: 13, fontWeight: '500', color: Colors.light.text, fontVariant: ['tabular-nums'] },
  sumRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  sumKey: { fontSize: 12.5, color: Colors.light.icon },
  sumVal: { flexShrink: 1, fontSize: 12.5, fontWeight: '500', color: Colors.light.text, textAlign: 'right' },
  sumValRow: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  testTag: {
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.4,
    color: Colors.light.icon,
    borderWidth: 1,
    borderColor: '#DCD2C3',
    borderRadius: 6,
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  sumTotalRow: {
    marginHorizontal: -14,
    marginBottom: -12,
    paddingHorizontal: 14,
    paddingBottom: 12,
    backgroundColor: Colors.light.background,
    borderBottomLeftRadius: 15,
    borderBottomRightRadius: 15,
  },
  sumTotalVal: { fontSize: 19, fontWeight: '600', color: Colors.light.highlight, fontVariant: ['tabular-nums'] },
  gatewayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginTop: -4 },
  gatewayText: { flexShrink: 1, fontSize: 11.5, fontWeight: '600', color: Colors.light.text },
  gatewayRef: { fontFamily: MONO, fontSize: 11, fontWeight: '400', color: Colors.light.icon },

  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 14 },
  stepLine: { position: 'absolute', left: 13, top: 26, bottom: 0, width: 2, backgroundColor: '#E4DCCE' },
  stepLineDone: { backgroundColor: Colors.light.success },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#DCD2C3',
    backgroundColor: Colors.light.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: Colors.light.success, borderColor: Colors.light.success },
  stepDotCurrent: { borderColor: Colors.light.success },
  stepDotNext: { borderColor: Colors.light.tint, borderStyle: 'dashed' },
  stepDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.light.success },
  stepLabel: { flex: 1, fontSize: 13.5, fontWeight: '600', lineHeight: 28, color: Colors.light.text },
  stepLabelTodo: { color: Colors.light.icon, fontWeight: '500' },
  stepLabelNext: { color: '#A94F2E' },
  stepNote: { fontSize: 11.5, fontWeight: '400', color: Colors.light.icon },

  actions: { gap: 8 },
  ghost: { height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 13.5, fontWeight: '600', color: STATUS.cancelled.ink },
  confirm: { backgroundColor: STATUS.cancelled.bg, borderRadius: 16, padding: 14, gap: 10 },
  confirmText: { fontSize: 13, lineHeight: 19, color: '#6B2A1F' },
  confirmRow: { flexDirection: 'row', gap: 8 },
  confirmBtn: { flex: 1, minHeight: 44, paddingVertical: 10, paddingHorizontal: 10 },
  closedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: STATUS.delivered.bg,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  closedNoteText: { flex: 1, fontSize: 12.5, fontWeight: '500', color: STATUS.delivered.ink },

  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 28,
    backgroundColor: OLIVE_INK,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toastText: { flex: 1, fontSize: 12.5, color: '#F1ECE2' },
  toastUndo: { fontSize: 13, fontWeight: '700', color: '#E9A283' },
});
