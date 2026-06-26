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
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

// Sample orders data
const sampleOrders = [
  {
    id: '1',
    orderNumber: 'ORD-12345',
    customerName: 'John Doe',
    customerEmail: 'john@example.com',
    date: '2024-07-15',
    total: 43.99,
    status: 'pending',
    items: [
      { name: 'White T-shirt', quantity: 1, price: 43.99, image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=100&q=80' }
    ],
    shippingAddress: '123 Main St, Makati City, Metro Manila, 1200',
    paymentMethod: 'Credit Card',
  },
  {
    id: '2',
    orderNumber: 'ORD-12346',
    customerName: 'Jane Smith',
    customerEmail: 'jane@example.com',
    date: '2024-07-14',
    total: 6.99,
    status: 'processing',
    items: [
      { name: 'Blouson Jacket', quantity: 1, price: 6.99, image: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=100&q=80' }
    ],
    shippingAddress: '456 Ayala Ave, Makati City, Metro Manila, 1227',
    paymentMethod: 'GCash',
  },
  {
    id: '3',
    orderNumber: 'ORD-12347',
    customerName: 'Mike Johnson',
    customerEmail: 'mike@example.com',
    date: '2024-07-13',
    total: 45.99,
    status: 'shipped',
    items: [
      { name: 'Sandals', quantity: 1, price: 45.99, image: 'https://plus.unsplash.com/premium_photo-1676234844384-82e1830af724?w=100&q=80' }
    ],
    shippingAddress: '789 BGC, Taguig City, Metro Manila, 1630',
    paymentMethod: 'PayMaya',
  },
  {
    id: '4',
    orderNumber: 'ORD-12348',
    customerName: 'Sarah Williams',
    customerEmail: 'sarah@example.com',
    date: '2024-07-12',
    total: 35.99,
    status: 'delivered',
    items: [
      { name: 'Converse Shoes', quantity: 1, price: 35.99, image: 'https://images.unsplash.com/photo-1680204101574-dea570724119?w=100&q=80' }
    ],
    shippingAddress: '321 BGC, Taguig City, Metro Manila, 1630',
    paymentMethod: 'Credit Card',
  },
  {
    id: '5',
    orderNumber: 'ORD-12349',
    customerName: 'Alex Brown',
    customerEmail: 'alex@example.com',
    date: '2024-07-11',
    total: 55.99,
    status: 'cancelled',
    items: [
      { name: 'White Dress', quantity: 1, price: 55.99, image: 'https://plus.unsplash.com/premium_photo-1676236306466-25ba882070b3?w=100&q=80' }
    ],
    shippingAddress: '555 Pasay Road, Pasay City, Metro Manila, 1300',
    paymentMethod: 'GCash',
  },
];

export default function AdminOrdersScreen({ navigation }) {
  const [orders, setOrders] = useState(sampleOrders);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState('');

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

  const getStatusLabel = (status) => {
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = 
      order.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.customerEmail.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (activeTab === 'all') return matchesSearch;
    return matchesSearch && order.status === activeTab;
  });

  const stats = {
    total: orders.length,
    pending: orders.filter(o => o.status === 'pending').length,
    processing: orders.filter(o => o.status === 'processing').length,
    shipped: orders.filter(o => o.status === 'shipped').length,
    delivered: orders.filter(o => o.status === 'delivered').length,
    cancelled: orders.filter(o => o.status === 'cancelled').length,
    totalRevenue: orders
      .filter(o => o.status !== 'cancelled')
      .reduce((sum, o) => sum + o.total, 0),
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

  const confirmStatusUpdate = () => {
    const updatedOrders = orders.map(order => 
      order.id === selectedOrder.id 
        ? { ...order, status: newStatus }
        : order
    );
    setOrders(updatedOrders);
    setShowStatusModal(false);
    Alert.alert('Success', `Order status updated to ${getStatusLabel(newStatus)}`);
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
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

      <ScrollView 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Stats Cards - Wrapped in View to prevent cutting */}
        <View style={styles.statsWrapper}>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.statsContainer}
          >
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
            placeholder="Search by order #, customer name or email..."
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

        {/* Tabs - Wrapped in View to prevent cutting */}
        <View style={styles.tabsWrapper}>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsContainer}
          >
            {tabs.map((tab) => (
              <TouchableOpacity
                key={tab.id}
                style={[
                  styles.tab,
                  activeTab === tab.id && styles.activeTab,
                ]}
                onPress={() => setActiveTab(tab.id)}
              >
                <Text style={[
                  styles.tabText,
                  activeTab === tab.id && styles.activeTabText
                ]}>
                  {tab.label}
                </Text>
                {tab.id !== 'all' && (
                  <View style={[
                    styles.tabBadge,
                    { backgroundColor: tab.color + '20' }
                  ]}>
                    <Text style={[styles.tabBadgeText, { color: tab.color }]}>
                      {tab.count}
                    </Text>
                  </View>
                )}
                {tab.id === 'all' && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>
                      {tab.count}
                    </Text>
                  </View>
                )}
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
              <TouchableOpacity
                key={order.id}
                style={styles.orderCard}
                onPress={() => handleViewOrder(order)}
              >
                <View style={styles.orderHeader}>
                  <View>
                    <Text style={styles.orderNumber}>{order.orderNumber}</Text>
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
                  <Text style={styles.orderCustomerName}>{order.customerName}</Text>
                </View>

                <View style={styles.orderDetails}>
                  <View style={styles.orderItems}>
                    <Ionicons name="cube-outline" size={14} color="#666" />
                    <Text style={styles.orderItemsText}>{order.items.length} item(s)</Text>
                  </View>
                  <Text style={styles.orderTotal}>₱{order.total.toFixed(2)}</Text>
                </View>

                <View style={styles.orderFooter}>
                  <TouchableOpacity 
                    style={styles.viewButton}
                    onPress={() => handleViewOrder(order)}
                  >
                    <Text style={styles.viewButtonText}>View Details</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.updateButton}
                    onPress={() => handleUpdateStatus(order)}
                  >
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
              {searchQuery ? 'Try a different search term' : 'Orders will appear here'}
            </Text>
          </View>
        )}
        
        {/* Bottom padding */}
        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* Order Details Modal */}
      <Modal
        visible={showOrderModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowOrderModal(false)}
      >
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
                {/* Order Info */}
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Order Information</Text>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Order Number:</Text>
                    <Text style={styles.infoValue}>{selectedOrder.orderNumber}</Text>
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
                </View>

                {/* Customer Info */}
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Customer Information</Text>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Name:</Text>
                    <Text style={styles.infoValue}>{selectedOrder.customerName}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Email:</Text>
                    <Text style={styles.infoValue}>{selectedOrder.customerEmail}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Payment:</Text>
                    <Text style={styles.infoValue}>{selectedOrder.paymentMethod}</Text>
                  </View>
                </View>

                {/* Shipping Info */}
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Shipping Address</Text>
                  <Text style={styles.shippingAddress}>{selectedOrder.shippingAddress}</Text>
                </View>

                {/* Items */}
                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Items</Text>
                  {selectedOrder.items.map((item, index) => (
                    <View key={index} style={styles.itemRow}>
                      <Image source={{ uri: item.image }} style={styles.itemImage} />
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemName}>{item.name}</Text>
                        <Text style={styles.itemQuantity}>Qty: {item.quantity}</Text>
                      </View>
                      <Text style={styles.itemPrice}>₱{item.price.toFixed(2)}</Text>
                    </View>
                  ))}
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Total:</Text>
                    <Text style={styles.totalValue}>₱{selectedOrder.total.toFixed(2)}</Text>
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
      <Modal
        visible={showStatusModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowStatusModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.statusModalContent}>
            <Text style={styles.modalTitle}>Update Order Status</Text>
            <Text style={styles.modalSubtitle}>Order #{selectedOrder?.orderNumber}</Text>

            {['pending', 'processing', 'shipped', 'delivered', 'cancelled'].map((status) => (
              <TouchableOpacity
                key={status}
                style={[
                  styles.statusOption,
                  newStatus === status && styles.statusOptionActive,
                  { borderColor: getStatusColor(status) }
                ]}
                onPress={() => setNewStatus(status)}
              >
                <View style={[styles.statusDot, { backgroundColor: getStatusColor(status) }]} />
                <Text style={[
                  styles.statusOptionText,
                  newStatus === status && styles.statusOptionTextActive
                ]}>
                  {getStatusLabel(status)}
                </Text>
                {newStatus === status && (
                  <Ionicons name="checkmark-circle" size={20} color={getStatusColor(status)} />
                )}
              </TouchableOpacity>
            ))}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => setShowStatusModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={confirmStatusUpdate}
              >
                <Text style={styles.confirmButtonText}>Update</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
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
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  scrollContent: {
    flexGrow: 1,
  },
  statsWrapper: {
    marginTop: 16,
  },
  statsContainer: {
    paddingHorizontal: 16,
    gap: 12,
  },
  statCard: {
    backgroundColor: '#F9F9FB',
    borderRadius: 12,
    padding: 16,
    minWidth: 100,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
  },
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
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: '#000',
  },
  tabsWrapper: {
    marginBottom: 16,
  },
  tabsContainer: {
    paddingHorizontal: 16,
    gap: 10,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#F9F9FB',
    gap: 8,
  },
  activeTab: {
    backgroundColor: '#007AFF',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#fff',
  },
  tabBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    backgroundColor: '#E5E5EA',
  },
  tabBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#666',
  },
  ordersContainer: {
    paddingHorizontal: 16,
  },
  loader: {
    marginTop: 40,
  },
  orderCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  orderNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  orderDate: {
    fontSize: 11,
    color: '#999',
    marginTop: 2,
  },
  orderStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  orderStatusText: {
    fontSize: 10,
    fontWeight: '600',
  },
  orderCustomer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  orderCustomerName: {
    fontSize: 14,
    color: '#000',
  },
  orderDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  orderItems: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  orderItemsText: {
    fontSize: 12,
    color: '#666',
  },
  orderTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: '#007AFF',
  },
  orderFooter: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
  },
  viewButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#F9F9FB',
  },
  viewButtonText: {
    fontSize: 12,
    color: '#666',
  },
  updateButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#007AFF',
  },
  updateButtonText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginTop: 16,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
  },
  bottomPadding: {
    height: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    width: '90%',
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalSection: {
    marginBottom: 20,
  },
  modalSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  infoLabel: {
    fontSize: 14,
    color: '#666',
  },
  infoValue: {
    fontSize: 14,
    color: '#000',
  },
  shippingAddress: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  itemImage: {
    width: 50,
    height: 50,
    borderRadius: 8,
    marginRight: 12,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
  },
  itemQuantity: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    marginTop: 8,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#007AFF',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  updateStatusButton: {
    backgroundColor: '#007AFF',
  },
  updateStatusButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  cancelButton: {
    backgroundColor: '#F2F2F7',
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
  },
  confirmButton: {
    backgroundColor: '#007AFF',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  statusModalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    width: '85%',
  },
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
  statusOptionActive: {
    backgroundColor: '#F9F9FB',
    borderWidth: 2,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  statusOptionText: {
    flex: 1,
    fontSize: 14,
    color: '#000',
  },
  statusOptionTextActive: {
    fontWeight: '600',
  },
});