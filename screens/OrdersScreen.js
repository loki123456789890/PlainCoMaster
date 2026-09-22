import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  FlatList,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  useReducedMotion,
  FadeIn,
  FadeInDown,
  LinearTransition,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { auth, db } from '../firebaseConfig';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import useNetworkStatus from '../hooks/useNetworkStatus';
import { Colors, Spacing, Radius } from '../constants/theme';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import SkeletonBlock from '../components/ui/Skeleton';
import ProductImage from '../components/ui/ProductImage';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

// "Pending" and "processing" share one visual status (color/icon/tab) —
// an order is "processing" the moment it's placed, and CheckoutScreen
// always creates orders with status: 'pending'. Without this grouping a
// brand-new order — the one a customer is most anxious to track — would
// show up under "All" but vanish from every specific status tab.
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'processing', label: 'Processing', icon: 'time-outline', matches: ['processing', 'pending'] },
  { key: 'shipped', label: 'Shipped', icon: 'car-outline' },
  { key: 'delivered', label: 'Delivered', icon: 'checkmark-circle-outline' },
];

const getStatusColor = (status) => {
  switch (status.toLowerCase()) {
    case 'delivered': return Colors.light.success;
    case 'processing':
    case 'pending': return Colors.light.highlight;
    case 'shipped': return Colors.light.tint;
    default: return Colors.light.icon;
  }
};

const getStatusIcon = (status) => {
  switch (status.toLowerCase()) {
    case 'delivered': return 'checkmark-circle-outline';
    case 'processing':
    case 'pending': return 'time-outline';
    case 'shipped': return 'car-outline';
    default: return 'ellipse-outline';
  }
};

// "Jul 15, 2026" instead of the raw, locale-dependent toLocaleDateString()
// output — reads as plainspoken and unambiguous regardless of device locale.
const formatOrderDate = (date) => {
  if (!date) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// Loading placeholder shaped like real order rows, so there's no layout
// shift once live orders swap in — same reasoning as CartSkeleton.
function OrdersSkeleton() {
  return (
    <View style={styles.ordersContainer}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.skeletonRow}>
          <SkeletonBlock style={styles.orderImage} />
          <View style={styles.orderInfo}>
            <SkeletonBlock style={styles.skeletonLine} />
            <SkeletonBlock style={[styles.skeletonLine, styles.skeletonLineShort]} />
            <SkeletonBlock style={[styles.skeletonLine, styles.skeletonLineTiny]} />
          </View>
          <SkeletonBlock style={styles.skeletonBadge} />
        </View>
      ))}
    </View>
  );
}

// One order row: thumbnail, name/date/total, and a status pill. A
// top-level component (not defined inside OrdersScreen) so each row's
// press-feedback and entrance animation gets a stable identity across
// re-renders and re-filters — same reasoning as Cartscreen's CartRow.
function OrderCard({ order, index, onPress }) {
  const reduceMotion = useReducedMotion();
  const statusColor = getStatusColor(order.status);
  const statusLabel = order.status.charAt(0).toUpperCase() + order.status.slice(1);
  const itemsLabel = `${order.itemCount} item${order.itemCount === 1 ? '' : 's'}` +
    (order.storeName ? ` · ${order.storeName}` : '');

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.delay(Math.min(index, 8) * 40).duration(220).easing(EASE_OUT_QUART)}
      layout={reduceMotion ? undefined : LinearTransition.duration(220).easing(EASE_OUT_QUART)}
    >
      <AnimatedPressable
        onPress={onPress}
        rippleColor={Colors.light.border}
        accessibilityRole="button"
        accessibilityLabel={`${order.displayName}, ${itemsLabel}, ₱${Number(order.total).toFixed(2)}, status ${statusLabel}. Tap to view details.`}
      >
        <Card variant="flat" style={styles.orderCard}>
          {order.image ? (
            <ProductImage uri={order.image} style={styles.orderImage} />
          ) : (
            <View style={[styles.orderImage, styles.orderImagePlaceholder]}>
              <Ionicons name="shirt-outline" size={28} color={Colors.light.icon} />
            </View>
          )}
          <View style={styles.orderInfo}>
            <Text style={styles.orderNumber} numberOfLines={1}>{order.displayName}</Text>
            <Text style={styles.orderDate}>{order.date}</Text>
            <Text style={styles.orderItems} numberOfLines={1}>{itemsLabel}</Text>
            <Text style={styles.orderTotal}>₱{Number(order.total).toFixed(2)}</Text>
          </View>
          <View style={styles.orderStatusContainer}>
            <View style={styles.statusRow}>
              <Ionicons name={getStatusIcon(order.status)} size={13} color={statusColor} />
              <Badge label={statusLabel} color={statusColor} />
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.light.icon} />
          </View>
        </Card>
      </AnimatedPressable>
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
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!auth.currentUser) {
      // Orders is account-tied data, same as Cart/Profile/Favorites — a
      // guest shouldn't see a hollow "No orders found" screen that implies
      // they have an account with zero orders. Redirect to Login instead,
      // leaving `loading` true so the skeleton (not an empty state) is
      // whatever briefly shows while the redirect completes.
      navigation.replace('Login');
      return;
    }

    const ordersRef = collection(db, "users", auth.currentUser.uid, "orders");
    const q = query(ordersRef, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const fetchedOrders = querySnapshot.docs.map((doc) => {
        const data = doc.data();
        const items = data.items || [];
        const firstItem = items[0] || {};

        // Build a readable title: single item shows its name,
        // multiple items shows the first item name + a "+N more" suffix
        const displayName =
          items.length > 1
            ? `${firstItem.name || 'Item'} +${items.length - 1} more`
            : firstItem.name || 'Order';

        return {
          id: doc.id,
          displayName,
          date: data.createdAt?.toDate ? formatOrderDate(data.createdAt.toDate()) : '',
          total: data.total || 0,
          subtotal: data.subtotal || 0,
          shipping: data.shipping || 0,
          status: data.status || 'processing',
          itemCount: items.length,
          items: items,
          // Carried through to OrderDetailsScreen so it can offer "Write a
          // review" on exactly the lines firestore.rules will accept one
          // for — the review rule tests membership of this same list. An
          // order placed before the field existed maps to [], and its lines
          // get no button rather than a button that fails on submit.
          productIds: data.productIds || [],
          image: firstItem.image || firstItem.imageUrl || null,
          // Which store is shipping it. Absent on orders from before
          // stores existed and not yet migrated, which just show no name.
          storeName: data.storeName || null,
          shippingAddress: data.shippingAddress || null,
          paymentMethod: data.paymentMethod || null,
        };
      });
      setOrders(fetchedOrders);
      setLoading(false);
      setLoadError(false);
    }, (error) => {
      console.error("Error fetching orders: ", error);
      setLoading(false);
      setLoadError(true);
    });

    return () => unsubscribe();
  }, [retryKey]);

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
  };

  const activeTabMeta = TABS.find((tab) => tab.key === activeTab);

  const filteredOrders = orders.filter((order) => {
    if (activeTab === 'all') return true;
    const matches = activeTabMeta?.matches || [activeTab];
    return matches.includes(order.status.toLowerCase());
  });

  const renderOrderCard = ({ item, index }) => (
    <OrderCard
      order={item}
      index={index}
      onPress={() => navigation.navigate('OrderDetails', { order: item })}
    />
  );

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
        <Text style={styles.headerTitle}>My Orders</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('Help')}
          style={styles.headerAction}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Get help with your orders"
        >
          <Ionicons name="help-circle-outline" size={24} color={Colors.light.tint} />
        </TouchableOpacity>
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            No internet connection — orders may be outdated.
          </Text>
        </View>
      )}

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.activeTab]}
            onPress={() => handleSelectTab(tab.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: activeTab === tab.key }}
            accessibilityLabel={`Filter by ${tab.label}`}
          >
            <Text
              style={[styles.tabText, activeTab === tab.key && styles.activeTabText]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Orders List */}
      {loading ? (
        <OrdersSkeleton />
      ) : loadError ? (
        <Animated.View
          style={styles.centerContainer}
          entering={reduceMotion ? undefined : FadeIn.duration(220)}
        >
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load your orders"
            subtitle="Check your connection and try again."
          />
          <View style={styles.emptyActionWrap}>
            <Button variant="secondary" label="Retry" onPress={handleRetry} />
          </View>
        </Animated.View>
      ) : (
        <FlatList
          data={filteredOrders}
          renderItem={renderOrderCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.ordersContainer}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Animated.View
              style={styles.emptyState}
              entering={reduceMotion ? undefined : FadeIn.duration(220)}
            >
              {orders.length === 0 ? (
                <>
                  <EmptyState
                    icon="receipt-outline"
                    title="No orders yet"
                    subtitle="When you place an order, you'll be able to track it here."
                  />
                  <View style={styles.emptyActionWrap}>
                    <Button variant="primary" label="Start Shopping" onPress={() => navigation.navigate('Shop')} />
                  </View>
                </>
              ) : (
                <>
                  <EmptyState
                    icon={activeTabMeta?.icon || 'file-tray-outline'}
                    title={`No ${activeTabMeta?.label.toLowerCase()} orders`}
                    subtitle="Orders you've placed will show up here once they reach this stage."
                  />
                  <View style={styles.emptyActionWrap}>
                    <Button variant="secondary" label="View All Orders" onPress={() => handleSelectTab('all')} />
                  </View>
                </>
              )}
            </Animated.View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.light.text,
  },
  headerAction: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
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
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 2,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.light.tint,
  },
  tabText: {
    fontSize: 13,
    color: Colors.light.icon,
    fontWeight: '500',
    textAlign: 'center',
  },
  activeTabText: {
    color: Colors.light.tint,
    fontWeight: '600',
  },
  ordersContainer: {
    padding: 16,
    flexGrow: 1,
  },
  orderCard: {
    flexDirection: 'row',
    padding: 12,
    marginBottom: 12,
  },
  orderImage: {
    width: 70,
    height: 70,
    borderRadius: Radius.sm,
    backgroundColor: Colors.light.border,
  },
  orderImagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  orderInfo: {
    flex: 1,
    marginLeft: 12,
  },
  orderNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 4,
  },
  orderDate: {
    fontSize: 11,
    color: Colors.light.icon,
    marginBottom: 2,
  },
  orderItems: {
    fontSize: 11,
    color: Colors.light.icon,
    marginBottom: 2,
  },
  orderTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.highlight,
    marginTop: 4,
  },
  orderStatusContainer: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  // Loading skeleton — shaped like a real order row so there's no layout
  // shift once live orders swap in.
  skeletonRow: {
    flexDirection: 'row',
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: 12,
  },
  skeletonLine: { height: 12, borderRadius: 4, marginTop: 6 },
  skeletonLineShort: { width: '60%' },
  skeletonLineTiny: { width: '40%' },
  skeletonBadge: { width: 70, height: 22, borderRadius: Radius.pill, alignSelf: 'flex-start' },

  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyState: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 40, paddingHorizontal: 40 },
  emptyActionWrap: { marginTop: Spacing.md, width: 200, alignSelf: 'center' },
});
