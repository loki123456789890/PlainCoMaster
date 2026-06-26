import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

export default function CheckoutScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content}>
        <Text style={styles.sectionTitle}>Order Summary</Text>
        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>Subtotal:</Text>
            <Text style={styles.value}>$0.00</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Shipping:</Text>
            <Text style={styles.value}>Free</Text>
          </View>
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total:</Text>
            <Text style={styles.totalValue}>$0.00</Text>
          </View>
        </View>
      </ScrollView>

      <TouchableOpacity
        style={styles.placeButton}
        onPress={() => alert('Order placed successfully!')}
      >
        <Text style={styles.placeButtonText}>Place Order</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#000' },
  content: { flex: 1, paddingHorizontal: 20, paddingVertical: 20 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#000', marginBottom: 15 },
  section: { borderWidth: 1, borderColor: '#eee', borderRadius: 8, padding: 15 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  totalRow: { borderTopWidth: 1, borderTopColor: '#eee', marginTop: 10 },
  label: { fontSize: 14, color: '#666' },
  value: { fontSize: 14, fontWeight: '600', color: '#000' },
  totalLabel: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  totalValue: { fontSize: 16, fontWeight: 'bold', color: '#00BFFF' },
  placeButton: {
    backgroundColor: '#8B6F47',
    paddingVertical: 14,
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 8,
    alignItems: 'center',
  },
  placeButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
