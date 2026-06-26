import React, { useState } from 'react';
import {
View,
Text,
StyleSheet,
TouchableOpacity,
Platform,
ScrollView,
Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';  // <- Changed import
import { Ionicons } from '@expo/vector-icons';

// Sample orders data
const sampleOrders = [
  {
    id: '1',
    orderNumber: 'ORD-12345',
    date: '2024-07-15',
    total: 43.99,
    status: 'Delivered',
    items: 2,
    image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=100&q=80',
  },
  {
    id: '2',
    orderNumber: 'ORD-12346',
    date: '2024-07-10',
    total: 6.99,
    status: 'Processing',
    items: 1,
    image: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=100&q=80',
  },
  {
    id: '3',
    orderNumber: 'ORD-12347',
    date: '2024-07-05',
    total: 45.99,
    status: 'Shipped',
    items: 3,
    image: 'https://plus.unsplash.com/premium_photo-1676234844384-82e1830af724?w=100&q=80',
  },
];

export default function OrdersScreen({ navigation }) {
  const [orders, setOrders] = useState(sampleOrders);
  const [activeTab, setActiveTab] = useState('all'); // all, processing, shipped, delivered

  const getStatusColor = (status) => {
    switch (status) {
      case 'Delivered': return '#34C759';
      case 'Processing': return '#FF9500';
      case 'Shipped': return '#007AFF';
      default: return '#666';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'Delivered': return 'checkmark-circle-outline';
      case 'Processing': return 'time-outline';
      case 'Shipped': return 'car-outline';
      default: return 'ellipse-outline';
    }
  };

  const filteredOrders = orders.filter(order => {
    if (activeTab === 'all') return true;
    return order.status.toLowerCase() === activeTab;
  });

  const renderOrderCard = (order) => (
    <TouchableOpacity 
      key={order.id} 
      style={styles.orderCard}
      onPress={() => navigation.navigate('OrderDetails', { order })}
    >
      <Image source={{ uri: order.image }} style={styles.orderImage} />
      <View style={styles.orderInfo}>
        <Text style={styles.orderNumber}>{order.orderNumber}</Text>
        <Text style={styles.orderDate}>{order.date}</Text>
        <Text style={styles.orderItems}>{order.items} item(s)</Text>
        <Text style={styles.orderTotal}>₱{order.total.toFixed(2)}</Text>
      </View>
      <View style={styles.orderStatusContainer}>
        <View style={[styles.orderStatus, { backgroundColor: getStatusColor(order.status) + '20' }]}>
          <Ionicons name={getStatusIcon(order.status)} size={14} color={getStatusColor(order.status)} />
          <Text style={[styles.orderStatusText, { color: getStatusColor(order.status) }]}>
            {order.status}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#999" />
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Status Bar - Now handled by SafeAreaView */}
      <View style={styles.statusBar}>
        <Text style={styles.time}>8:34</Text>
        <View style={styles.statusIcons}>
          <View style={styles.signal} />
          <View style={styles.wifi} />
          <View style={styles.battery} />
        </View>
      </View>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Orders</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Help')}>
          <Ionicons name="help-circle-outline" size={24} color="#007AFF" />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        {['all', 'processing', 'shipped', 'delivered'].map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Orders List */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.ordersContainer}>
        {filteredOrders.length > 0 ? (
          filteredOrders.map(order => renderOrderCard(order))
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="cart-outline" size={80} color="#ccc" />
            <Text style={styles.emptyText}>No orders found</Text>
            <TouchableOpacity 
              style={styles.shopButton}
              onPress={() => navigation.navigate('Shop')}
            >
              <Text style={styles.shopButtonText}>Start Shopping</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,  // Reduced significantly since SafeAreaView handles the safe area
    paddingBottom: 10,
  },
  time: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  statusIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  signal: {
    width: 18,
    height: 12,
    backgroundColor: '#000',
    borderRadius: 2,
  },
  wifi: {
    width: 16,
    height: 12,
    backgroundColor: '#000',
    borderRadius: 2,
  },
  battery: {
    width: 24,
    height: 12,
    backgroundColor: '#000',
    borderRadius: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
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
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#007AFF',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  activeTabText: {
    color: '#007AFF',
    fontWeight: '600',
  },
  ordersContainer: {
    padding: 16,
  },
  orderCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  orderImage: {
    width: 70,
    height: 70,
    borderRadius: 8,
    backgroundColor: '#F2F2F7',
  },
  orderInfo: {
    flex: 1,
    marginLeft: 12,
  },
  orderNumber: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  orderDate: {
    fontSize: 11,
    color: '#999',
    marginBottom: 2,
  },
  orderItems: {
    fontSize: 11,
    color: '#666',
    marginBottom: 2,
  },
  orderTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#007AFF',
    marginTop: 4,
  },
  orderStatusContainer: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  orderStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
    marginBottom: 8,
  },
  orderStatusText: {
    fontSize: 10,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginTop: 16,
    marginBottom: 20,
  },
  shopButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  shopButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});