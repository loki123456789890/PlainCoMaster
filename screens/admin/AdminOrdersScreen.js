import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Image,
  Alert,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { db } from '../../firebaseConfig';
import {
  collectionGroup,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
} from 'firebase/firestore';

const STATUS_OPTIONS = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];

const getStatusColor = (status) => {
  switch (status) {
    case 'pending': return '#FF9500';
    case 'processing': return '#007AFF';
    case 'shipped': return '#34C759';
    case 'delivered': return '#34C759';
    case 'cancelled': return '#FF3B30';
    default: return '#666';
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

export default function AdminOrdersScreen({ navigation }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState('');

  useEffect(() => {
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
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching orders:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

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
    setSelectedOrder(order);
    setShowOrderModal(true);
  };

  const handleUpdateStatus = (order) => {
    setSelectedOrder(order);
    setNewStatus(order.status);
    setShowStatusModal(true);
  };

  const confirmStatusUpdate = async () => {
    if (!selectedOrder?.ref) return;
    setUpdating(true);
    try {
      await updateDoc(selectedOrder.ref, { status: newStatus });
      setShowStatusModal(false);
      Alert.alert('Success', `Order status updated to ${getStatusLabel(newStatus)}`);
    } catch (error) {
      console.error('Error updating order status:', error);
      Alert.alert('Error', 'Could not update order status. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  const formatDate = (date) => {
    if (!date) return '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const tabs = [
    { id: 'all', label: 'All', count: stats.total },
    { id: 'pending', label: 'Pending', count: stats.pending, color: '#FF9500' },
    { id: 'processing', label: 'Processing', count: stats.processing, color: '#007AFF' },
    { id: 'shipped', label: 'Shipped', count: stats.shipped, color: '#34C759' },
    { id: 'delivered', label: 'Delivered', count: stats.delivered, color: '#34C759' },
    { id: 'cancelled', label: 'Cancelled', count: stats.cancelled, color: '#FF3B30' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Orders</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Stats Cards */}
        <View style={styles.statsWrapper}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsContainer}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.total}</Text>
              <Text style={styles.statLabel}>Total Orders</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#FFF3E0' }]}>
              <Text style={[styles.statValue, { color: '#FF9500' }]}>{stats.pending}</Text>
              <Text style={styles.statLabel}>Pending</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#E3F2FF' }]}>
              <Text style={[styles.statValue, { color: '#007AFF' }]}>{stats.processing}</Text>
              <Text style={styles.statLabel}>Processing</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#E8F5E9' }]}>
              <Text style={[styles.statValue, { color: '#34C759' }]}>{stats.shipped + stats.delivered}</Text>
              <Text style={styles.statLabel}>Completed</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: '#FFEBEE' }]}>
              <Text style={[styles.statValue, { color: '#FF3B30' }]}>{stats.cancelled}</Text>
              <Text style={styles.statLabel}>Cancelled</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>₱{stats.totalRevenue.toFixed(2)}</Text>
              <Text style={styles.statLabel}>Revenue</Text>
            </View>
          </ScrollView>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={20} color="#999" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by order # or customer email..."
            placeholderTextColor="#999"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color="#999" />
            </TouchableOpacity>
          )}
        </View>

        {/* Tabs */}
        <View style={styles.tabsWrapper}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsContainer}>
            {tabs.map((tab) => (
              <TouchableOpacity
                key={tab.id}
                style={[styles.tab, activeTab === tab.id && styles.activeTab]}
                onPress={() => setActiveTab(tab.id)}
              >
                <Text style={[styles.tabText, activeTab === tab.id && styles.activeTabText]}>
                  {tab.label}
                </Text>
                <View style={[styles.tabBadge, tab.color ? { backgroundColor: tab.color + '20' } : null]}>
                  <Text style={[styles.tabBadgeText, tab.color ? { color: tab.color } : null]}>
                    {tab.count}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Orders List */}
        {loading ? (
          <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
        ) : filteredOrders.length > 0 ? (
          <View style={styles.ordersContainer}>
            {filteredOrders.map((order) => (
              <TouchableOpacity key={order.id} style={styles.orderCard} onPress={() => handleViewOrder(order)}>
                <View style={styles.orderHeader}>
                  <View>
                    <Text style={styles.orderNumber}>#{order.orderNumber}</Text>
                    <Text style={styles.orderDate}>{formatDate(order.date)}</Text>
                  </View>
                  <View style={[styles.orderStatus, { backgroundColor: getStatusColor(order.status) + '20' }]}>
                    <Ionicons name={getStatusIcon(order.status)} size={12} color={getStatusColor(order.status)} />
                    <Text style={[styles.orderStatusText, { color: getStatusColor(order.status) }]}>
                      {getStatusLabel(order.status)}
                    </Text>
                  </View>
                </View>

                <View style={styles.orderCustomer}>
                  <Ionicons name="person-outline" size={14} color="#666" />
                  <Text style={styles.orderCustomerName}>{order.customerEmail}</Text>
                </View>

                <View style={styles.orderPayment}>
                  <Ionicons name={getPaymentIcon(order.paymentMethod)} size={14} color="#666" />
                  <Text style={styles.orderPaymentText}>{getPaymentLabel(order.paymentMethod)}</Text>
                </View>

                <View style={styles.orderDetails}>
                  <View style={styles.orderItems}>
                    <Ionicons name="cube-outline" size={14} color="#666" />
                    <Text style={styles.orderItemsText}>{order.items.length} item(s)</Text>
                  </View>
                  <Text style={styles.orderTotal}>₱{Number(order.total).toFixed(2)}</Text>
                </View>

                <View style={styles.orderFooter}>
                  <TouchableOpacity style={styles.viewButton} onPress={() => handleViewOrder(order)}>
                    <Text style={styles.viewButtonText}>View Details</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.updateButton} onPress={() => handleUpdateStatus(order)}>
                    <Text style={styles.updateButtonText}>Update Status</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="cart-outline" size={64} color="#ccc" />
            <Text style={styles.emptyStateText}>No orders found</Text>
            <Text style={styles.emptyStateSubtext}>
              {searchQuery ? 'Try a different search term' : 'Orders will appear here once customers check out'}
            </Text>
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
              <TouchableOpacity onPress={() => setShowOrderModal(false)}>
                <Ionicons name="close" size={24} color="#000" />
              </TouchableOpacity>
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
                      <Ionicons name={getPaymentIcon(selectedOrder.paymentMethod)} size={14} color="#8B6F47" />
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
                          <Ionicons name="shirt-outline" size={20} color="#ccc" />
                        </View>
                      )}
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemName}>{item.name}</Text>
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
                  <TouchableOpacity
                    style={[styles.modalButton, styles.updateStatusButton]}
                    onPress={() => {
                      setShowOrderModal(false);
                      handleUpdateStatus(selectedOrder);
                    }}
                  >
                    <Text style={styles.updateStatusButtonText}>Update Status</Text>
                  </TouchableOpacity>
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

            {STATUS_OPTIONS.map((status) => (
              <TouchableOpacity
                key={status}
                style={[
                  styles.statusOption,
                  newStatus === status && styles.statusOptionActive,
                  { borderColor: getStatusColor(status) },
                ]}
                onPress={() => setNewStatus(status)}
              >
                <View style={[styles.statusDot, { backgroundColor: getStatusColor(status) }]} />
                <Text style={[styles.statusOptionText, newStatus === status && styles.statusOptionTextActive]}>
                  {getStatusLabel(status)}
                </Text>
                {newStatus === status && <Ionicons name="checkmark-circle" size={20} color={getStatusColor(status)} />}
              </TouchableOpacity>
            ))}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowStatusModal(false)}
                disabled={updating}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton, updating && { opacity: 0.7 }]}
                onPress={confirmStatusUpdate}
                disabled={updating}
              >
                {updating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmButtonText}>Update</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
    marginTop: Platform.OS === 'ios' ? 0 : 30,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#000' },
  scrollContent: { flexGrow: 1 },
  statsWrapper: { marginTop: 16 },
  statsContainer: { paddingHorizontal: 16, gap: 12 },
  statCard: {
    backgroundColor: '#F9F9FB',
    borderRadius: 12,
    padding: 16,
    minWidth: 100,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  statValue: { fontSize: 24, fontWeight: '700', color: '#000', marginBottom: 4 },
  statLabel: { fontSize: 12, color: '#666' },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F9FB',
    margin: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, height: 44, fontSize: 14, color: '#000' },
  tabsWrapper: { marginBottom: 16 },
  tabsContainer: { paddingHorizontal: 16, gap: 10 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#F9F9FB',
    gap: 8,
  },
  activeTab: { backgroundColor: '#007AFF' },
  tabText: { fontSize: 14, color: '#666', fontWeight: '500' },
  activeTabText: { color: '#fff' },
  tabBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 12, backgroundColor: '#E5E5EA' },
  tabBadgeText: { fontSize: 10, fontWeight: '600', color: '#666' },
  ordersContainer: { paddingHorizontal: 16 },
  loader: { marginTop: 40 },
  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  orderNumber: { fontSize: 14, fontWeight: '600', color: '#000' },
  orderDate: { fontSize: 11, color: '#999', marginTop: 2 },
  orderStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  orderStatusText: { fontSize: 10, fontWeight: '600' },
  orderCustomer: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  orderCustomerName: { fontSize: 14, color: '#000' },
  orderPayment: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  orderPaymentText: { fontSize: 12, color: '#666' },
  orderDetails: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  orderItems: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  orderItemsText: { fontSize: 12, color: '#666' },
  orderTotal: { fontSize: 16, fontWeight: '700', color: '#007AFF' },
  orderFooter: { flexDirection: 'row', gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F2F2F7' },
  viewButton: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: '#F9F9FB' },
  viewButtonText: { fontSize: 12, color: '#666' },
  updateButton: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center', backgroundColor: '#007AFF' },
  updateButtonText: { fontSize: 12, color: '#fff', fontWeight: '500' },
  emptyState: { alignItems: 'center', paddingVertical: 60 },
  emptyStateText: { fontSize: 16, fontWeight: '600', color: '#666', marginTop: 16 },
  emptyStateSubtext: { fontSize: 14, color: '#999', marginTop: 8, textAlign: 'center', paddingHorizontal: 40 },
  bottomPadding: { height: 40 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#fff', borderRadius: 20, padding: 20, width: '90%', maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: '600', color: '#000' },
  modalSubtitle: { fontSize: 14, color: '#666', marginBottom: 20, textAlign: 'center' },
  modalSection: { marginBottom: 20 },
  modalSectionTitle: { fontSize: 16, fontWeight: '600', color: '#000', marginBottom: 12 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  infoLabel: { fontSize: 14, color: '#666' },
  infoValue: { fontSize: 14, color: '#000' },
  paymentMethodBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#8B6F4720',
  },
  paymentMethodBadgeText: { fontSize: 12, fontWeight: '600', color: '#8B6F47' },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  itemImage: { width: 50, height: 50, borderRadius: 8, marginRight: 12 },
  itemImagePlaceholder: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#F2F2F7' },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 14, fontWeight: '500', color: '#000' },
  itemQuantity: { fontSize: 12, color: '#666', marginTop: 2 },
  itemPrice: { fontSize: 14, fontWeight: '600', color: '#007AFF' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, marginTop: 8 },
  totalLabel: { fontSize: 16, fontWeight: '600', color: '#000' },
  totalValue: { fontSize: 18, fontWeight: '700', color: '#007AFF' },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalButton: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  updateStatusButton: { backgroundColor: '#007AFF' },
  updateStatusButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  cancelButton: { backgroundColor: '#F2F2F7' },
  cancelButtonText: { color: '#666', fontSize: 14, fontWeight: '600' },
  confirmButton: { backgroundColor: '#007AFF' },
  confirmButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  statusModalContent: { backgroundColor: '#fff', borderRadius: 20, padding: 20, width: '85%' },
  statusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    marginBottom: 10,
    gap: 12,
  },
  statusOptionActive: { backgroundColor: '#F9F9FB', borderWidth: 2 },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusOptionText: { flex: 1, fontSize: 14, color: '#000' },
  statusOptionTextActive: { fontWeight: '600' },
});