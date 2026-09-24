// screens/OrdersScreen.js
//
// My Orders, in the approved payment/orders/account preview's design:
// status tabs with counts, orders grouped by month, and a card per order
// with its status, number and date, thumbnails, store and payment, the
// total, and a Processing → Shipped → Delivered line. A delivered order
// offers "Write a review". Everything it did before it still does: the
// live list, the store's unread-message line, retry, and the guest
// redirect.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ScrollView } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { auth, db } from '../firebaseConfig';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { Colors } from '../constants/theme';
import { EASE_OUT_QUART } from '../constants/motion';
import { getPaymentLabel, getPaymentStatus, isPayOnDelivery } from '../constants/payment';
import SkeletonBlock from '../components/ui/Skeleton';
import ProductImage from '../components/ui/ProductImage';
import { TopBar, BigEmpty, OfflineNotice } from '../components/shop/TabScreen';
import { chatFields, hasUnread } from '../utils/orderChat';
import { formatOrderNumber } from '../utils/orderNumber';
import { isOrderReviewable } from '../utils/reviews';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const PRICE = '#8C6D0C';

// "Pending" and "processing" share one status (pill, tab, step) — an
// order is "processing" the moment it's placed, and orders are created
// with status 'pending'. Without this grouping a brand-new order — the one
// a customer is most anxious to track — would show under "All" but vanish
// from every specific tab.
const STATUS = {
  processing: { label: 'Processing', icon: 'time-outline', bg: '#F6EFE3', fg: '#6B5A2E', step: 0 },
  shipped: { label: 'Shipped', icon: 'car-outline', bg: '#E6ECF3', fg: '#2F4B6B', step: 1 },
  delivered: { label: 'Delivered', icon: 'checkmark', bg: '#EEF0EA', fg: '#37412F', step: 2 },
  cancelled: { label: 'Cancelled', icon: 'close-circle-outline', bg: '#F1EBE3', fg: '#6B635C', step: null },
};
const statusKey = (status = '') => {
  const s = status.toLowerCase();
  return s === 'pending' ? 'processing' : s;
};
const statusMeta = (status) =>
  STATUS[statusKey(status)] || {
    label: status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Processing',
    icon: 'ellipse-outline',
    bg: '#F1EBE3',
    fg: '#6B635C',
    step: null,
  };

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'processing', label: 'Processing' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

const EMPTY = {
  processing: ['Nothing processing', 'New orders show here while the store prepares them.'],
  shipped: ['Nothing on the way', 'Shipped orders show here until they arrive.'],
  delivered: ['No deliveries yet', 'Delivered orders show here. You can review items from them.'],
  cancelled: ['No cancelled orders', 'Orders cancelled by a store show here.'],
};

// Card thumbnails sit on a warm tint while the photo loads, or instead of
// one when an item has none.
const TINTS = ['#EFE6DA', '#E6E9E1', '#F3E3DA', '#EDE7D4', '#E9E4DE', '#E4E7E6'];

// "Jul 15, 2026", and "July 2026" for the month headings — spelled out
// rather than the device locale's format, so they read the same anywhere.
const formatOrderDate = (date) =>
  date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const formatMonth = (date) => (date ? date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '');

// "GCash · Paid" for a paid online order; the method alone otherwise
// (Cash on Delivery is paid to the rider, so it carries no status here).
const paymentLine = (order) => {
  if (!order.paymentMethod) return null;
  const label = getPaymentLabel(order.paymentMethod);
  if (isPayOnDelivery(order.paymentMethod)) return label;
  return getPaymentStatus(order) === 'paid' ? `${label} · Paid` : label;
};

// Loading placeholder shaped like the real cards, so nothing jumps when the
// orders arrive.
function OrdersSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.card}>
          <SkeletonBlock style={{ width: 96, height: 24, borderRadius: 12, marginBottom: 12 }} />
          <View style={styles.cardBody}>
            <SkeletonBlock style={{ width: 64, height: 72, borderRadius: 14 }} />
            <View style={{ flex: 1, gap: 8 }}>
              <SkeletonBlock style={{ height: 13, width: '70%', borderRadius: 6 }} />
              <SkeletonBlock style={{ height: 11, width: '50%', borderRadius: 6 }} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

function Thumbs({ items, seed }) {
  const shown = items.slice(0, 2);
  if (!shown.length) shown.push({});
  return (
    <View style={styles.thumbs}>
      {/* The second item peeks out behind the first, tilted. */}
      {shown
        .map((item, i) => ({ item, i }))
        .reverse()
        .map(({ item, i }) => {
          const uri = item.image || item.imageUrl || null;
          return (
            <View
              key={i}
              style={[styles.thumb, { backgroundColor: TINTS[(seed + i) % TINTS.length] }, i === 1 && styles.thumbBack]}
            >
              {uri ? (
                <ProductImage uri={uri} style={StyleSheet.absoluteFill} />
              ) : (
                <Ionicons name="shirt-outline" size={30} color="rgba(43,38,34,0.55)" />
              )}
            </View>
          );
        })}
    </View>
  );
}

// Processing ─── Shipped ─── Delivered, with the current step ringed in
// Clay and the steps behind it in Moss.
function Track({ step }) {
  const dot = (i) => [styles.dot, i < step && styles.dotDone, i === step && (step === 2 ? styles.dotDone : styles.dotNow)];
  const labels = ['Processing', 'Shipped', 'Delivered'];
  return (
    <View accessible accessibilityLabel={`Progress: ${labels[step]}`}>
      <View style={styles.track}>
        <View style={dot(0)} />
        <View style={[styles.rule, step >= 1 && styles.ruleDone]} />
        <View style={dot(1)} />
        <View style={[styles.rule, step >= 2 && styles.ruleDone]} />
        <View style={dot(2)} />
      </View>
      <View style={styles.trackLabels}>
        {labels.map((label, i) => (
          <Text
            key={label}
            style={[
              styles.trackLabel,
              i === 1 && { textAlign: 'center' },
              i === 2 && { textAlign: 'right' },
              i === step && styles.trackLabelNow,
            ]}
          >
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

// A top-level component, so each card's entrance keeps a stable identity
// across re-renders and tab changes.
function OrderCard({ order, index, onOpen, onReview }) {
  const reduceMotion = useReducedMotion();
  const meta = statusMeta(order.status);
  const unread = hasUnread(order, 'customer');
  const itemsLabel = `${order.itemCount} item${order.itemCount === 1 ? '' : 's'}` + (order.storeName ? ` · ${order.storeName}` : '');
  const pay = paymentLine(order);
  const number = order.id ? formatOrderNumber(order.id) : '';
  const total = `₱${Number(order.total).toFixed(2)}`;
  const reviewable = isOrderReviewable(order) && order.reviewableItems.length > 0;

  return (
    <Animated.View entering={reduceMotion ? undefined : FadeInDown.delay(Math.min(index, 8) * 55).duration(450).easing(EASE_OUT_QUART)}>
      <Pressable
        onPress={onOpen}
        style={({ pressed }) => [styles.card, pressed && { transform: [{ scale: 0.98 }] }]}
        accessibilityRole="button"
        accessibilityLabel={`${order.displayName}, ${itemsLabel}, ${total}, ${meta.label}, order ${number}, ${order.date}.${unread ? ' New message from the store.' : ''} Opens the order.`}
      >
        <View style={styles.cardHead}>
          <View style={[styles.pill, { backgroundColor: meta.bg }]}>
            <Ionicons name={meta.icon} size={13} color={meta.fg} />
            <Text style={[styles.pillText, { color: meta.fg }]}>{meta.label}</Text>
          </View>
          <Text style={styles.headMeta} numberOfLines={1}>
            {[number, order.date].filter(Boolean).join(' · ')}
          </Text>
        </View>

        <View style={styles.cardBody}>
          <Thumbs items={order.items} seed={index} />
          <View style={styles.cardText}>
            <Text style={styles.title} numberOfLines={2}>
              {order.displayName}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {itemsLabel}
            </Text>
            {pay ? <Text style={styles.meta}>{pay}</Text> : null}
            {unread ? (
              <View style={styles.unread}>
                <View style={styles.unreadDot} />
                <Text style={styles.unreadText}>New message</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.price}>{total}</Text>
        </View>

        {meta.step !== null ? (
          <Track step={meta.step} />
        ) : statusKey(order.status) === 'cancelled' ? (
          <Text style={styles.cancelled}>Cancelled by the store.</Text>
        ) : null}

        {reviewable ? (
          <View style={styles.actions}>
            <Pressable
              onPress={onReview}
              style={({ pressed }) => [styles.action, styles.actionPrimary, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
            >
              <Text style={[styles.actionText, { color: '#fff' }]}>Write a review</Text>
            </Pressable>
            <Pressable
              onPress={onOpen}
              style={({ pressed }) => [styles.action, pressed && { backgroundColor: '#F7F2EB' }]}
              accessibilityRole="button"
            >
              <Text style={styles.actionText}>View details</Text>
            </Pressable>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export default function OrdersScreen({ navigation }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [retryKey, setRetryKey] = useState(0);
  const { isConnected } = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const tabsRef = useRef(null);
  const tabX = useRef({});

  useEffect(() => {
    if (!auth.currentUser) {
      // Orders is account-tied data, same as Cart/Profile/Favorites — a
      // guest shouldn't see a hollow "No orders" screen that implies they
      // have an account with zero orders. Redirect to Login instead,
      // leaving `loading` true so the skeleton is what briefly shows.
      navigation.replace('Login');
      return;
    }

    const ordersRef = collection(db, 'users', auth.currentUser.uid, 'orders');
    const q = query(ordersRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        const fetchedOrders = querySnapshot.docs.map((doc) => {
          const data = doc.data();
          const items = data.items || [];
          const firstItem = items[0] || {};
          const created = data.createdAt?.toDate ? data.createdAt.toDate() : null;
          const productIds = data.productIds || [];

          // Single item shows its name; several show the first + "+N more".
          const displayName =
            items.length > 1 ? `${firstItem.name || 'Item'} +${items.length - 1} more` : firstItem.name || 'Order';

          return {
            id: doc.id,
            displayName,
            date: formatOrderDate(created),
            month: formatMonth(created),
            total: data.total || 0,
            subtotal: data.subtotal || 0,
            shipping: data.shipping || 0,
            status: data.status || 'processing',
            itemCount: items.length,
            items,
            // Carried through to OrderDetailsScreen so it can offer "Write a
            // review" on exactly the lines firestore.rules will accept one
            // for — the review rule tests membership of this same list. An
            // order placed before the field existed maps to [], and its lines
            // get no button rather than a button that fails on submit.
            productIds,
            // The lines "Write a review" on the card can open.
            reviewableItems: items.filter((item) => item.productId && productIds.includes(item.productId)),
            image: firstItem.image || firstItem.imageUrl || null,
            // Which store is shipping it. Absent on orders from before
            // stores existed and not yet migrated, which just show no name.
            storeName: data.storeName || null,
            // Passed on to a review, which must name the store that sold the
            // item — the rules check it against this order.
            storeId: data.storeId || null,
            shippingAddress: data.shippingAddress || null,
            paymentMethod: data.paymentMethod || null,
            paymentStatus: data.paymentStatus || null,
            // For OrderDetails' PayMongo receipt line (getPaymongoReceipt).
            paymentRef: data.paymentRef || null,
            paymentSandbox: data.paymentSandbox === true,
            paymentProvider: data.paymentProvider || null,
            // For the "New message" line here and the chat button on
            // OrderDetails — as millis, since Timestamps don't survive
            // navigation params.
            ...chatFields(data),
          };
        });
        setOrders(fetchedOrders);
        setLoading(false);
        setLoadError(false);
      },
      (error) => {
        console.error('Error fetching orders: ', error);
        setLoading(false);
        setLoadError(true);
      }
    );

    return () => unsubscribe();
  }, [retryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = () => {
    Haptics.selectionAsync();
    setLoading(true);
    setLoadError(false);
    setRetryKey((key) => key + 1);
  };

  const handleSelectTab = (tabKey) => {
    if (tabKey === activeTab) return;
    Haptics.selectionAsync();
    setActiveTab(tabKey);
    // Brings a tab scrolled partly out of view back to the middle.
    const x = tabX.current[tabKey];
    if (x !== undefined) tabsRef.current?.scrollTo({ x: Math.max(0, x - 120), animated: true });
  };

  const countFor = (key) => (key === 'all' ? orders.length : orders.filter((o) => statusKey(o.status) === key).length);
  const filtered = orders.filter((o) => activeTab === 'all' || statusKey(o.status) === activeTab);

  // Month headings between the cards.
  const rows = [];
  let month = null;
  filtered.forEach((order, index) => {
    if (order.month !== month) {
      month = order.month;
      if (month) rows.push({ type: 'month', key: `m-${month}`, label: month });
    }
    rows.push({ type: 'order', key: order.id, order, index });
  });

  const openOrder = (order) => navigation.navigate('OrderDetails', { order });
  // Straight to the review when the order has one item to review; the
  // order's own page, where each line has its button, when it has several.
  const reviewOrder = (order) => {
    Haptics.selectionAsync();
    if (order.reviewableItems.length === 1) {
      navigation.navigate('WriteReview', { orderId: order.id, item: order.reviewableItems[0], storeId: order.storeId });
    } else {
      openOrder(order);
    }
  };

  const renderRow = ({ item }) =>
    item.type === 'month' ? (
      <Text style={styles.month} accessibilityRole="header">
        {item.label}
      </Text>
    ) : (
      <OrderCard
        order={item.order}
        index={item.index}
        onOpen={() => openOrder(item.order)}
        onReview={() => reviewOrder(item.order)}
      />
    );

  const helpButton = (
    <Pressable
      onPress={() => navigation.navigate('Help')}
      style={({ pressed }) => [styles.help, pressed && { backgroundColor: 'rgba(43,38,34,0.06)' }]}
      accessibilityRole="button"
      accessibilityLabel="Get help with your orders"
    >
      <Ionicons name="help-circle-outline" size={23} color={INK} />
    </Pressable>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <TopBar title="My Orders" onBack={() => navigation.goBack()} right={helpButton} />

      {!isConnected && <OfflineNotice>No internet connection — orders may be outdated.</OfflineNotice>}

      <View style={styles.tabsWrap}>
        <ScrollView ref={tabsRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {TABS.map((tab) => {
            const on = activeTab === tab.key;
            const count = countFor(tab.key);
            return (
              <Pressable
                key={tab.key}
                onPress={() => handleSelectTab(tab.key)}
                onLayout={(e) => {
                  tabX.current[tab.key] = e.nativeEvent.layout.x;
                }}
                style={[styles.tab, on && styles.tabOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${tab.label}, ${count} order${count === 1 ? '' : 's'}`}
              >
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{tab.label}</Text>
                <View style={[styles.count, on && styles.countOn]}>
                  <Text style={[styles.countText, on && styles.countTextOn]}>{count}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <OrdersSkeleton />
      ) : loadError ? (
        <BigEmpty
          icon="cloud-offline-outline"
          title="Couldn't load your orders"
          text="Check your connection and try again."
          actionLabel="Retry"
          onAction={handleRetry}
        />
      ) : (
        <FlatList
          data={rows}
          renderItem={renderRow}
          keyExtractor={(row) => row.key}
          contentContainerStyle={[styles.list, { paddingBottom: Math.max(insets.bottom, 16) + 14 }]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            orders.length === 0 ? (
              <BigEmpty
                icon="receipt-outline"
                title="No orders yet"
                text="When you place an order, you'll be able to track it here."
                actionLabel="Start shopping"
                onAction={() => navigation.navigate('Shop')}
              />
            ) : (
              <BigEmpty
                icon="receipt-outline"
                title={EMPTY[activeTab]?.[0] || 'No orders here'}
                text={EMPTY[activeTab]?.[1]}
                actionLabel="View all orders"
                onAction={() => handleSelectTab('all')}
              />
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  help: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },

  tabsWrap: { paddingBottom: 10 },
  tabs: { paddingHorizontal: 20, gap: 6 },
  tab: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabOn: { backgroundColor: INK, borderColor: INK },
  tabText: { fontSize: 13, fontWeight: '500', color: MUTED },
  tabTextOn: { color: Colors.light.background },
  count: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: '#F1EBE3', alignItems: 'center', justifyContent: 'center' },
  countOn: { backgroundColor: 'rgba(250,247,242,0.18)' },
  countText: { fontSize: 11, color: MUTED },
  countTextOn: { color: Colors.light.background },

  list: { paddingHorizontal: 16, flexGrow: 1 },
  month: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: MUTED,
    marginTop: 14,
    marginBottom: 8,
    marginHorizontal: 6,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEE7DD',
    borderRadius: 20,
    padding: 14,
    marginBottom: 10,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  pillText: { fontSize: 12, fontWeight: '600' },
  headMeta: { flexShrink: 1, fontSize: 11.5, color: MUTED },
  cardBody: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumbs: { width: 64, height: 72 },
  thumb: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbBack: { opacity: 0.9, transform: [{ translateX: 8 }, { translateY: -6 }, { rotate: '6deg' }] },
  cardText: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '600', lineHeight: 18, color: INK },
  meta: { fontSize: 12, color: MUTED, marginTop: 2 },
  price: { alignSelf: 'flex-start', fontSize: 15, fontWeight: '600', color: PRICE },
  unread: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.light.tint },
  unreadText: { fontSize: 12, fontWeight: '600', color: Colors.light.tint },

  track: { flexDirection: 'row', alignItems: 'center', marginTop: 14, marginHorizontal: 2 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#E4DCD1' },
  dotDone: { backgroundColor: Colors.light.secondary },
  dotNow: { backgroundColor: Colors.light.tint, borderWidth: 3, borderColor: 'rgba(196,98,62,0.25)', width: 13, height: 13, borderRadius: 7, marginHorizontal: -2 },
  rule: { flex: 1, height: 2, marginHorizontal: 4, backgroundColor: '#E4DCD1' },
  ruleDone: { backgroundColor: Colors.light.secondary },
  trackLabels: { flexDirection: 'row', marginTop: 6 },
  trackLabel: { flex: 1, fontSize: 10.5, color: MUTED },
  trackLabelNow: { color: INK, fontWeight: '600' },
  cancelled: { fontSize: 10.5, color: MUTED, marginTop: 12 },

  actions: { flexDirection: 'row', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F1EBE3' },
  action: {
    flex: 1,
    height: 38,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimary: { backgroundColor: Colors.light.tint, borderColor: Colors.light.tint },
  actionText: { fontSize: 12.5, fontWeight: '600', color: INK },
});
