import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  TextInput,
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { showAppAlert } from '../../utils/appAlert';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  useReducedMotion,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { db } from '../../firebaseConfig';
import {
  collectionGroup,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
} from 'firebase/firestore';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { Colors, Spacing, Radius } from '../../constants/theme';
import Card from '../../components/ui/Card';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import AnimatedPressable from '../../components/ui/AnimatedPressable';
import SkeletonBlock from '../../components/ui/Skeleton';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../../constants/motion';
import { logStoreActivity, ACTIONS } from '../../utils/activityLog';

const STATUS_OPTIONS = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];

const HOUR_MS = 60 * 60 * 1000;
const ATTENTION_THRESHOLD_HOURS = 24;

// Pending and processing intentionally stay visually distinct here even
// though the customer-facing OrdersScreen/OrderDetailsScreen collapse both
// to Gold — an admin triaging a queue needs to tell "nothing started yet"
// from "already being worked" at a glance, which the customer view doesn't
// need to. Processing uses Ash rather than Clay specifically so Clay stays
// reserved for actions/selection only, per DESIGN.md's One Accent Rule.
const getStatusColor = (status) => {
  switch (status) {
    case 'pending': return Colors.light.highlight;
    case 'processing': return Colors.light.icon;
    case 'shipped': return Colors.light.success;
    case 'delivered': return Colors.light.success;
    case 'cancelled': return Colors.light.danger;
    default: return Colors.light.icon;
  }
};

const getStatusIcon = (status) => {
  switch (status) {
    case 'pending': return 'time-outline';
    case 'processing': return 'sync-outline';
    case 'shipped': return 'car-outline';
    case 'delivered': return 'checkmark-circle-outline';
    case 'cancelled': return 'close-circle-outline';
    default: return 'ellipse-outline';
  }
};

const getStatusLabel = (status) => (status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown');

// Mirrors CheckoutScreen's paymentOptions list. Orders placed before this
// field existed won't have paymentMethod set at all — that's expected for
// historical data, not a bug, so both helpers fall back gracefully instead
// of guessing a method that was never actually selected.
const PAYMENT_METHOD_LABELS = {
  gcash: 'GCash',
  maya: 'Maya',
  card: 'Card',
  cod: 'Cash on Delivery',
};

const PAYMENT_METHOD_ICONS = {
  gcash: 'cash-outline',
  maya: 'wallet-outline',
  card: 'card-outline',
  cod: 'cube-outline',
};

const getPaymentLabel = (method) => PAYMENT_METHOD_LABELS[method] || 'Not specified';
const getPaymentIcon = (method) => PAYMENT_METHOD_ICONS[method] || 'help-circle-outline';

// Shaped like a real order card so the loading state previews the content
// that's about to arrive, instead of a spinner floating mid-screen.
function OrderCardSkeleton() {
  return (
    <Card variant="flat" style={styles.orderCard}>
      <View style={styles.orderHeader}>
        <View style={{ gap: 6 }}>
          <SkeletonBlock style={{ width: 90, height: 14, borderRadius: Radius.sm }} />
          <SkeletonBlock style={{ width: 60, height: 10, borderRadius: Radius.sm }} />
        </View>
        <SkeletonBlock style={{ width: 78, height: 22, borderRadius: Radius.pill }} />
      </View>
      <SkeletonBlock style={{ width: '55%', height: 12, borderRadius: Radius.sm, marginBottom: Spacing.sm }} />
      <SkeletonBlock style={{ width: '40%', height: 12, borderRadius: Radius.sm, marginBottom: Spacing.md }} />
      <SkeletonBlock style={{ width: '100%', height: 38, borderRadius: Radius.sm }} />
    </Card>
  );
}

export default function AdminOrdersScreen({ navigation }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ordersError, setOrdersError] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  // Bumped by handleRetry() to force the listener below to tear down and
  // re-subscribe — same shape as AdminDashboardScreen's retryToken, so a
  // permissions blip or bad connection at mount doesn't leave the list
  // silently stuck on an unrecoverable listener.
  const [retryToken, setRetryToken] = useState(0);
  const { isConnected } = useNetworkStatus();
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
    setLoading(true);
    setOrdersError(false);

    // collectionGroup reads the "orders" subcollection across every user
    // document at once (users/{uid}/orders), which is how the admin sees
    // orders placed by all customers instead of just one.
    // NOTE: this requires a Firestore index on the "orders" collection group,
    // and Firestore security rules that allow the admin account to read
    // across all users' order subcollections — regular per-user rules will
    // block this query for anyone who isn't authorized as an admin.
    const ordersQuery = query(collectionGroup(db, 'orders'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(
      ordersQuery,
      (snapshot) => {
        const fetched = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const items = data.items || [];

          return {
            id: docSnap.id,
            ref: docSnap.ref, // needed to write status updates back to the correct document
            orderNumber: docSnap.id.slice(0, 8).toUpperCase(),
            customerEmail: data.customerEmail || 'Unknown customer',
            customerId: data.customerId || null,
            date: data.createdAt?.toDate ? data.createdAt.toDate() : null,
            total: data.total || 0,
            subtotal: data.subtotal || 0,
            shipping: data.shipping || 0,
            status: data.status || 'pending',
            paymentMethod: data.paymentMethod || null,
            items,
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
  }, [retryToken]);

  const handleRetry = () => setRetryToken((t) => t + 1);

  const filteredOrders = orders.filter((order) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      order.orderNumber.toLowerCase().includes(q) ||
      order.customerEmail.toLowerCase().includes(q);

    if (activeTab === 'all') return matchesSearch;
    return matchesSearch && order.status === activeTab;
  });

  const stats = {
    total: orders.length,
    pending: orders.filter((o) => o.status === 'pending').length,
    processing: orders.filter((o) => o.status === 'processing').length,
    shipped: orders.filter((o) => o.status === 'shipped').length,
    delivered: orders.filter((o) => o.status === 'delivered').length,
    cancelled: orders.filter((o) => o.status === 'cancelled').length,
    totalRevenue: orders
      .filter((o) => o.status !== 'cancelled')
      .reduce((sum, o) => sum + Number(o.total || 0), 0),
  };

  const handleViewOrder = (order) => {
    Haptics.selectionAsync();
    setSelectedOrder(order);
    setShowOrderModal(true);
  };

  const handleUpdateStatus = (order) => {
    Haptics.selectionAsync();
    setSelectedOrder(order);
    setNewStatus(order.status);
    setShowStatusModal(true);
  };

  const confirmStatusUpdate = async () => {
    if (!selectedOrder?.ref || newStatus === selectedOrder.status) return;
    setUpdating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const previousStatus = selectedOrder.status;
      await updateDoc(selectedOrder.ref, { status: newStatus });
      // Records the transition, not just the new value — "who moved this
      // order to cancelled, and what was it before?" is the question the
      // SRS's audit clause exists to answer.
      logStoreActivity({
        action: ACTIONS.ORDER_STATUS,
        targetId: selectedOrder.id,
        targetLabel: `Order #${selectedOrder.orderNumber || selectedOrder.id}`,
        summary:
          `Order #${selectedOrder.orderNumber || selectedOrder.id} — status ` +
          `${getStatusLabel(previousStatus)} → ${getStatusLabel(newStatus)}`,
      });
      setShowStatusModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert('Success', `Order status updated to ${getStatusLabel(newStatus)}`);
    } catch (error) {
      console.error('Error updating order status:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

      const isNetworkError = !isConnected || error.code === 'unavailable';
      if (isNetworkError) {
        showAppAlert(
          'No Internet Connection',
          'Network connection lost. Please check your connection and try again.'
        );
        return;
      }

      showAppAlert('Error', 'Could not update order status. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  const formatDate = (date) => {
    if (!date) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Favors "2h ago" over an absolute date on the list card — a shift
  // scanning dozens of orders reads recency faster than a calendar date.
  // The order details modal still shows the precise date for the record.
  const formatRelativeTime = (date) => {
    if (!date) return '';
    const diffHours = Math.max(0, (now - date.getTime()) / HOUR_MS);
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${Math.floor(diffHours)}h ago`;
    const days = Math.floor(diffHours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
  };

  const tabs = [
    { id: 'all', label: 'All', count: stats.total },
    { id: 'pending', label: 'Pending', count: stats.pending, color: Colors.light.highlight },
    { id: 'processing', label: 'Processing', count: stats.processing, color: Colors.light.icon },
    { id: 'shipped', label: 'Shipped', count: stats.shipped, color: Colors.light.success },
    { id: 'delivered', label: 'Delivered', count: stats.delivered, color: Colors.light.success },
    { id: 'cancelled', label: 'Cancelled', count: stats.cancelled, color: Colors.light.danger },
  ];

  const noResultsFromFilter = Boolean(searchQuery) || activeTab !== 'all';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <AnimatedPressable
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
        </AnimatedPressable>
        <Text style={styles.headerTitle} accessibilityRole="header">Manage Orders</Text>
        <View style={{ width: 40 }} />
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            No internet connection — order data may be out of date.
          </Text>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Stats Cards */}
        <Animated.View
          style={styles.statsWrapper}
          entering={reduceMotion ? undefined : FadeIn.duration(220)}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsContainer}>
            <Card variant="flat" style={styles.statCard}>
              <Text style={styles.statValue}>{stats.total}</Text>
              <Text style={styles.statLabel}>Total Orders</Text>
            </Card>
            <Card variant="flat" style={[styles.statCard, { backgroundColor: Colors.light.highlight + '15' }]}>
              <Text style={[styles.statValue, { color: Colors.light.highlight }]}>{stats.pending}</Text>
              <Text style={styles.statLabel}>Pending</Text>
            </Card>
            <Card variant="flat" style={[styles.statCard, { backgroundColor: Colors.light.border + '60' }]}>
              <Text style={styles.statValue}>{stats.processing}</Text>
              <Text style={styles.statLabel}>Processing</Text>
            </Card>
            <Card variant="flat" style={[styles.statCard, { backgroundColor: Colors.light.success + '15' }]}>
              <Text style={[styles.statValue, { color: Colors.light.success }]}>{stats.shipped + stats.delivered}</Text>
              <Text style={styles.statLabel}>Completed</Text>
            </Card>
            <Card variant="flat" style={[styles.statCard, { backgroundColor: Colors.light.danger + '15' }]}>
              <Text style={[styles.statValue, { color: Colors.light.danger }]}>{stats.cancelled}</Text>
              <Text style={styles.statLabel}>Cancelled</Text>
            </Card>
            <Card variant="flat" style={styles.statCard}>
              <Text style={styles.statValue}>₱{stats.totalRevenue.toFixed(2)}</Text>
              <Text style={styles.statLabel}>Revenue</Text>
            </Card>
          </ScrollView>
        </Animated.View>

        {/* Search Bar */}
        <Animated.View
          style={styles.searchContainer}
          entering={reduceMotion ? undefined : FadeInDown.duration(240).delay(40).easing(EASE_OUT_QUART)}
        >
          <Ionicons name="search-outline" size={20} color={Colors.light.icon} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by order # or customer email..."
            placeholderTextColor={Colors.light.icon}
            value={searchQuery}
            onChangeText={setSearchQuery}
            accessibilityLabel="Search orders by order number or customer email"
          />
          {searchQuery.length > 0 && (
            <Pressable
              onPress={() => setSearchQuery('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={20} color={Colors.light.icon} />
            </Pressable>
          )}
        </Animated.View>

        {/* Tabs */}
        <Animated.View
          style={styles.tabsWrapper}
          entering={reduceMotion ? undefined : FadeInDown.duration(240).delay(80).easing(EASE_OUT_QUART)}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContainer}>
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <AnimatedPressable
                  key={tab.id}
                  style={[styles.tab, isActive && styles.activeTab]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setActiveTab(tab.id);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={`${tab.label}, ${tab.count} orders`}
                >
                  <Text style={[styles.tabText, isActive && styles.activeTabText]}>
                    {tab.label}
                  </Text>
                  <View style={[styles.tabBadge, tab.color ? { backgroundColor: tab.color + '20' } : null]}>
                    <Text style={[styles.tabBadgeText, tab.color ? { color: tab.color } : null]}>
                      {tab.count}
                    </Text>
                  </View>
                </AnimatedPressable>
              );
            })}
          </ScrollView>
        </Animated.View>

        {/* Orders List */}
        {loading ? (
          <View style={styles.ordersContainer}>
            <OrderCardSkeleton />
            <OrderCardSkeleton />
            <OrderCardSkeleton />
          </View>
        ) : ordersError ? (
          <View style={styles.emptyStateWrap}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load orders"
              subtitle="Check your connection and try again."
            />
            <View style={styles.emptyStateAction}>
              <Button variant="outline" label="Retry" onPress={handleRetry} />
            </View>
          </View>
        ) : filteredOrders.length > 0 ? (
          <View style={styles.ordersContainer}>
            {filteredOrders.map((order, index) => {
              const ageHours = order.date ? (now - order.date.getTime()) / HOUR_MS : null;
              const needsAttention =
                order.status === 'pending' && ageHours !== null && ageHours >= ATTENTION_THRESHOLD_HOURS;

              return (
                <Animated.View
                  key={order.id}
                  entering={
                    reduceMotion
                      ? undefined
                      : FadeInDown.duration(240)
                          .delay(120 + Math.min(index, 8) * 40)
                          .easing(EASE_OUT_QUART)
                  }
                >
                  <AnimatedPressable
                    onPress={() => handleViewOrder(order)}
                    accessibilityRole="button"
                    accessibilityLabel={`Order ${order.orderNumber}, ${getStatusLabel(order.status)}, ₱${Number(order.total).toFixed(2)}${needsAttention ? ', needs attention' : ''}`}
                    accessibilityHint="Opens order details"
                  >
                    <Card variant="flat" style={styles.orderCard}>
                      <View style={styles.orderHeader}>
                        <View>
                          <Text style={styles.orderNumber}>#{order.orderNumber}</Text>
                          <Text style={styles.orderDate}>{formatRelativeTime(order.date)}</Text>
                        </View>
                        <View style={styles.orderHeaderRight}>
                          {needsAttention && (
                            <View style={styles.attentionBadge}>
                              <Ionicons name="alert-circle" size={11} color={Colors.light.danger} />
                              <Text style={styles.attentionBadgeText}>Attention</Text>
                            </View>
                          )}
                          <View style={[styles.orderStatus, { backgroundColor: getStatusColor(order.status) + '20' }]}>
                            <Ionicons name={getStatusIcon(order.status)} size={12} color={getStatusColor(order.status)} />
                            <Text style={[styles.orderStatusText, { color: getStatusColor(order.status) }]}>
                              {getStatusLabel(order.status)}
                            </Text>
                          </View>
                        </View>
                      </View>

                      <View style={styles.orderCustomer}>
                        <Ionicons name="person-outline" size={14} color={Colors.light.icon} />
                        <Text style={styles.orderCustomerName} numberOfLines={1} ellipsizeMode="tail">
                          {order.customerEmail}
                        </Text>
                      </View>

                      <View style={styles.orderPayment}>
                        <Ionicons name={getPaymentIcon(order.paymentMethod)} size={14} color={Colors.light.icon} />
                        <Text style={styles.orderPaymentText}>{getPaymentLabel(order.paymentMethod)}</Text>
                      </View>

                      <View style={styles.orderDetails}>
                        <View style={styles.orderItems}>
                          <Ionicons name="cube-outline" size={14} color={Colors.light.icon} />
                          <Text style={styles.orderItemsText}>{order.items.length} item(s)</Text>
                        </View>
                        <Text style={styles.orderTotal}>₱{Number(order.total).toFixed(2)}</Text>
                      </View>

                      <View style={styles.orderFooter}>
                        <AnimatedPressable
                          style={styles.updateButton}
                          onPress={() => handleUpdateStatus(order)}
                          accessibilityRole="button"
                          accessibilityLabel={`Update status for order ${order.orderNumber}`}
                        >
                          <Ionicons name="create-outline" size={14} color="#fff" />
                          <Text style={styles.updateButtonText}>Update Status</Text>
                        </AnimatedPressable>
                      </View>
                    </Card>
                  </AnimatedPressable>
                </Animated.View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyStateWrap}>
            <EmptyState
              icon="cart-outline"
              title="No orders found"
              subtitle={
                searchQuery
                  ? 'Try a different search term'
                  : activeTab !== 'all'
                  ? `No ${getStatusLabel(activeTab).toLowerCase()} orders right now`
                  : 'Orders will appear here once customers check out'
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

        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* Order Details Modal */}
      <Modal visible={showOrderModal} transparent animationType="slide" onRequestClose={() => setShowOrderModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Order Details</Text>
              <Pressable
                onPress={() => setShowOrderModal(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>

            {selectedOrder && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Order Information</Text>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Order Number:</Text>
                    <Text style={styles.infoValue}>#{selectedOrder.orderNumber}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Date:</Text>
                    <Text style={styles.infoValue}>{formatDate(selectedOrder.date)}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Status:</Text>
                    <View style={[styles.orderStatus, { backgroundColor: getStatusColor(selectedOrder.status) + '20' }]}>
                      <Text style={[styles.orderStatusText, { color: getStatusColor(selectedOrder.status) }]}>
                        {getStatusLabel(selectedOrder.status)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Payment Method:</Text>
                    <View style={styles.paymentMethodBadge}>
                      <Ionicons name={getPaymentIcon(selectedOrder.paymentMethod)} size={14} color={Colors.light.tint} />
                      <Text style={styles.paymentMethodBadgeText}>{getPaymentLabel(selectedOrder.paymentMethod)}</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Customer Information</Text>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Email:</Text>
                    <Text style={styles.infoValue}>{selectedOrder.customerEmail}</Text>
                  </View>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Items</Text>
                  {selectedOrder.items.map((item, index) => (
                    <View key={index} style={styles.itemRow}>
                      {item.image ? (
                        <Image source={{ uri: item.image }} style={styles.itemImage} />
                      ) : (
                        <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                          <Ionicons name="shirt-outline" size={20} color={Colors.light.icon} />
                        </View>
                      )}
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                        <Text style={styles.itemQuantity}>
                          {[item.size, item.color].filter(Boolean).join(' · ')}
                          {item.size || item.color ? ' · ' : ''}Qty: {item.quantity}
                        </Text>
                      </View>
                      <Text style={styles.itemPrice}>₱{Number(item.price).toFixed(2)}</Text>
                    </View>
                  ))}
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Total:</Text>
                    <Text style={styles.totalValue}>₱{Number(selectedOrder.total).toFixed(2)}</Text>
                  </View>
                </View>

                <View style={styles.modalButtons}>
                  <Button
                    variant="primary"
                    label={!isConnected ? 'No Internet Connection' : 'Update Status'}
                    onPress={() => {
                      setShowOrderModal(false);
                      handleUpdateStatus(selectedOrder);
                    }}
                    disabled={!isConnected}
                  />
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Update Status Modal */}
      <Modal visible={showStatusModal} transparent animationType="fade" onRequestClose={() => setShowStatusModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.statusModalContent}>
            <Text style={styles.modalTitle}>Update Order Status</Text>
            <Text style={styles.modalSubtitle}>Order #{selectedOrder?.orderNumber}</Text>

            {STATUS_OPTIONS.map((status) => {
              const isSelected = newStatus === status;
              return (
                <AnimatedPressable
                  key={status}
                  style={[
                    styles.statusOption,
                    isSelected && styles.statusOptionActive,
                    { borderColor: getStatusColor(status) },
                  ]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setNewStatus(status);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={getStatusLabel(status)}
                >
                  <View style={[styles.statusDot, { backgroundColor: getStatusColor(status) }]} />
                  <Text style={[styles.statusOptionText, isSelected && styles.statusOptionTextActive]}>
                    {getStatusLabel(status)}
                  </Text>
                  {isSelected && <Ionicons name="checkmark-circle" size={20} color={getStatusColor(status)} />}
                </AnimatedPressable>
              );
            })}

            <View style={styles.modalButtons}>
              <View style={styles.modalButtonHalf}>
                <Button
                  variant="secondary"
                  label="Cancel"
                  onPress={() => setShowStatusModal(false)}
                  disabled={updating}
                />
              </View>
              <View style={styles.modalButtonHalf}>
                <Button
                  variant="primary"
                  label={!isConnected ? 'Offline' : 'Update'}
                  onPress={confirmStatusUpdate}
                  loading={updating}
                  disabled={updating || !isConnected || newStatus === selectedOrder?.status}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
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
    marginTop: Platform.OS === 'ios' ? 0 : 30,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.light.danger + '15',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.danger + '40',
  },
  offlineBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.light.danger },
  scrollContent: { flexGrow: 1 },
  statsWrapper: { marginTop: 16 },
  statsContainer: { paddingHorizontal: 16, gap: 12 },
  statCard: {
    minWidth: 100,
    alignItems: 'center',
  },
  statValue: { fontSize: 24, fontWeight: '700', color: Colors.light.text, marginBottom: 4 },
  statLabel: { fontSize: 12, color: Colors.light.icon },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
    margin: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, height: 44, fontSize: 14, color: Colors.light.text },
  tabsWrapper: { marginBottom: 16 },
  tabsContainer: { paddingHorizontal: 16, gap: 10 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.light.border + '40',
    gap: 8,
  },
  activeTab: { backgroundColor: Colors.light.tint },
  tabText: { fontSize: 14, color: Colors.light.icon, fontWeight: '500' },
  activeTabText: { color: '#fff' },
  tabBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 12, backgroundColor: Colors.light.border },
  tabBadgeText: { fontSize: 10, fontWeight: '600', color: Colors.light.icon },
  ordersContainer: { paddingHorizontal: 16 },
  emptyStateWrap: { paddingHorizontal: Spacing.md },
  emptyStateAction: { marginTop: -Spacing.sm, marginBottom: Spacing.md, paddingHorizontal: Spacing.xl },
  orderCard: {
    marginBottom: 12,
  },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  orderHeaderRight: { alignItems: 'flex-end', gap: 4 },
  orderNumber: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  orderDate: { fontSize: 11, color: Colors.light.icon, marginTop: 2 },
  orderStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  orderStatusText: { fontSize: 10, fontWeight: '600' },
  attentionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.light.danger + '15',
  },
  attentionBadgeText: { fontSize: 9, fontWeight: '700', color: Colors.light.danger, letterSpacing: 0.2 },
  orderCustomer: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  orderCustomerName: { fontSize: 14, color: Colors.light.text, flexShrink: 1 },
  orderPayment: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  orderPaymentText: { fontSize: 12, color: Colors.light.icon },
  orderDetails: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  orderItems: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  orderItemsText: { fontSize: 12, color: Colors.light.icon },
  orderTotal: { fontSize: 16, fontWeight: '700', color: Colors.light.highlight },
  orderFooter: { flexDirection: 'row', gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.light.border },
  updateButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.light.tint,
  },
  updateButtonText: { fontSize: 12, color: '#fff', fontWeight: '600' },
  bottomPadding: { height: 40 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: Colors.light.background, borderRadius: 20, padding: 20, width: '90%', maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '600', color: Colors.light.text },
  modalSubtitle: { fontSize: 14, color: Colors.light.icon, marginBottom: 20 },
  modalSection: { marginBottom: 20 },
  modalSectionTitle: { fontSize: 16, fontWeight: '600', color: Colors.light.text, marginBottom: 12 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  infoLabel: { fontSize: 14, color: Colors.light.icon },
  infoValue: { fontSize: 14, color: Colors.light.text },
  paymentMethodBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: Colors.light.tint + '20',
  },
  paymentMethodBadgeText: { fontSize: 12, fontWeight: '600', color: Colors.light.tint },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  itemImage: { width: 50, height: 50, borderRadius: 8, marginRight: 12 },
  itemImagePlaceholder: { justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.light.border },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 14, fontWeight: '500', color: Colors.light.text },
  itemQuantity: { fontSize: 12, color: Colors.light.icon, marginTop: 2 },
  itemPrice: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, marginTop: 8 },
  totalLabel: { fontSize: 16, fontWeight: '600', color: Colors.light.text },
  totalValue: { fontSize: 18, fontWeight: '700', color: Colors.light.highlight },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalButtonHalf: { flex: 1 },
  statusModalContent: { backgroundColor: Colors.light.background, borderRadius: 20, padding: 20, width: '85%' },
  statusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    marginBottom: 10,
    gap: 12,
  },
  statusOptionActive: { backgroundColor: Colors.light.border + '40', borderWidth: 2 },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusOptionText: { flex: 1, fontSize: 14, color: Colors.light.text },
  statusOptionTextActive: { fontWeight: '600' },
});
