import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { auth, db } from '../firebaseConfig';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';

export default function OrdersScreen({ navigation }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all'); // all, processing, shipped, delivered

  useEffect(() => {
    if (!auth.currentUser) {
      // Orders is account-tied data, same as Cart/Profile — a guest
      // shouldn't see a hollow "No orders found" screen that implies
      // they have an account with zero orders. Redirect to Login instead,
      // matching how Cart/Profile handle the same guest-access case.
      setLoading(false);
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
          date: data.createdAt?.toDate
            ? data.createdAt.toDate().toLocaleDateString()
            : '',
          total: data.total || 0,
          subtotal: data.subtotal || 0,
          shipping: data.shipping || 0,
          status: data.status || 'processing',
          itemCount: items.length,
          items: items,
          image: firstItem.image || firstItem.imageUrl || null,
        };
      });
      setOrders(fetchedOrders);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching orders: ", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const getStatusColor = (status) => {
    switch (status.toLowerCase()) {
      case 'delivered': return '#34C759';
      case 'processing':
      case 'pending': return '#FF9500';
      case 'shipped': return '#007AFF';
      default: return '#666';
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
      {order.image ? (
        <Image source={{ uri: order.image }} style={styles.orderImage} />
      ) : (
        <View style={[styles.orderImage, styles.orderImagePlaceholder]}>
          <Ionicons name="shirt-outline" size={28} color="#ccc" />
        </View>
      )}
      <View style={styles.orderInfo}>
        <Text style={styles.orderNumber} numberOfLines={1}>{order.displayName}</Text>
        <Text style={styles.orderDate}>{order.date}</Text>
        <Text style={styles.orderItems}>{order.itemCount} item(s)</Text>
        <Text style={styles.orderTotal}>₱{Number(order.total).toFixed(2)}</Text>
      </View>
      <View style={styles.orderStatusContainer}>
        <View style={[styles.orderStatus, { backgroundColor: getStatusColor(order.status) + '20' }]}>
          <Ionicons name={getStatusIcon(order.status)} size={14} color={getStatusColor(order.status)} />
          <Text style={[styles.orderStatusText, { color: getStatusColor(order.status) }]}>
            {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#999" />
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
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
            <Text
              style={[styles.tabText, activeTab === tab && styles.activeTabText]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Orders List */}
      {loading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      ) : (
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
      )}
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
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 2,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: '#007AFF',
  },
  tabText: {
    fontSize: 13,
    color: '#666',
    fontWeight: '500',
    textAlign: 'center',
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