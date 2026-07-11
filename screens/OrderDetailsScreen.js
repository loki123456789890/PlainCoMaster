import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

export default function OrderDetailsScreen({ navigation, route }) {
  const { order } = route.params || {};
  const items = order?.items || [];

  const getStatusColor = (status) => {
    switch ((status || '').toLowerCase()) {
      case 'delivered': return '#34C759';
      case 'processing':
      case 'pending': return '#FF9500';
      case 'shipped': return '#007AFF';
      default: return '#666';
    }
  };

  const getStatusIcon = (status) => {
    switch ((status || '').toLowerCase()) {
      case 'delivered': return 'checkmark-circle-outline';
      case 'processing':
      case 'pending': return 'time-outline';
      case 'shipped': return 'car-outline';
      default: return 'ellipse-outline';
    }
  };

  if (!order) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Order Details</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Order not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const statusColor = getStatusColor(order.status);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Order Meta */}
        <View style={styles.metaCard}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Order ID</Text>
            <Text style={styles.metaValue}>{order.id}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Date placed</Text>
            <Text style={styles.metaValue}>{order.date}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Status</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
              <Ionicons name={getStatusIcon(order.status)} size={14} color={statusColor} />
              <Text style={[styles.statusText, { color: statusColor }]}>
                {(order.status || '').charAt(0).toUpperCase() + (order.status || '').slice(1)}
              </Text>
            </View>
          </View>
        </View>

        {/* Items */}
        <Text style={styles.sectionTitle}>Items ({items.length})</Text>
        {items.length === 0 ? (
          <Text style={styles.emptyItemsText}>No item details available for this order.</Text>
        ) : (
          items.map((item, index) => (
            <View key={index} style={styles.itemCard}>
              {item.image ? (
                <Image source={{ uri: item.image }} style={styles.itemImage} />
              ) : (
                <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                  <Ionicons name="shirt-outline" size={24} color="#ccc" />
                </View>
              )}
              <View style={styles.itemDetails}>
                <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                <Text style={styles.itemSpecs}>
                  {item.size ? `Size: ${item.size}` : ''}
                  {item.size && item.color ? '  ·  ' : ''}
                  {item.color ? `Color: ${item.color}` : ''}
                </Text>
                <Text style={styles.itemQty}>Qty: {item.quantity || 1}</Text>
              </View>
              <Text style={styles.itemPrice}>
                ₱{(Number(item.price) * (item.quantity || 1)).toFixed(2)}
              </Text>
            </View>
          ))
        )}

        {/* Order Summary */}
        <Text style={styles.sectionTitle}>Order Summary</Text>
        <View style={styles.summaryCard}>
          <View style={styles.row}>
            <Text style={styles.label}>Subtotal</Text>
            <Text style={styles.value}>₱{Number(order.subtotal || order.total).toFixed(2)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Shipping</Text>
            <Text style={styles.value}>
              {order.shipping ? `₱${Number(order.shipping).toFixed(2)}` : 'Free'}
            </Text>
          </View>
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>₱{Number(order.total).toFixed(2)}</Text>
          </View>
        </View>
      </ScrollView>
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
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#000' },
  content: { padding: 20 },
  metaCard: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  metaLabel: { fontSize: 13, color: '#666' },
  metaValue: { fontSize: 13, fontWeight: '600', color: '#000' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  statusText: { fontSize: 12, fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#000', marginBottom: 12 },
  emptyItemsText: { fontSize: 13, color: '#999', marginBottom: 20 },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  itemImage: { width: 60, height: 60, borderRadius: 8, backgroundColor: '#F2F2F7' },
  itemImagePlaceholder: { justifyContent: 'center', alignItems: 'center' },
  itemDetails: { flex: 1, marginLeft: 12 },
  itemName: { fontSize: 14, fontWeight: '600', color: '#000', marginBottom: 2 },
  itemSpecs: { fontSize: 12, color: '#666', marginBottom: 2 },
  itemQty: { fontSize: 12, color: '#666' },
  itemPrice: { fontSize: 14, fontWeight: '700', color: '#000' },
  summaryCard: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  totalRow: { borderTopWidth: 1, borderTopColor: '#eee', marginTop: 8, paddingTop: 12 },
  label: { fontSize: 14, color: '#666' },
  value: { fontSize: 14, fontWeight: '600', color: '#000' },
  totalLabel: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  totalValue: { fontSize: 16, fontWeight: 'bold', color: '#007AFF' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#666' },
});