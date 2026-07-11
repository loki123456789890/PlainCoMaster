import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { db, auth } from '../firebaseConfig';
import { collection, doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';

// Handles "$450.00", "450", or 450 — always returns a clean number
const parsePrice = (price) => {
  if (typeof price === 'number') return price;
  if (typeof price === 'string') {
    const cleaned = price.replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
  }
  return 0;
};

// UI-only, matching the SRS's "payment options are included in the UI
// design only, not yet integrated" constraint — no card entry, no real
// processing. Selection is just stored on the order for admin visibility.
// COD included alongside the SRS-named options since it's the dominant
// method in Philippine e-commerce and fits ukay-ukay's inspect-before-you-
// pay nature.
const paymentOptions = [
  { id: 'gcash', label: 'GCash', icon: 'cash-outline' },
  { id: 'maya', label: 'Maya', icon: 'wallet-outline' },
  { id: 'card', label: 'Card', icon: 'card-outline' },
  { id: 'cod', label: 'Cash on Delivery', icon: 'cube-outline' },
];

export default function CheckoutScreen({ navigation, route }) {
  const orderItems = route.params?.orderItems || [];
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [shippingAddress, setShippingAddress] = useState(null);
  const [loadingAddress, setLoadingAddress] = useState(true);

  // Refetch on every focus, not just on mount — this is how we pick up a
  // freshly saved/edited address when the user comes back from LocationScreen.
  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      const loadAddress = async () => {
        if (!auth.currentUser) {
          setLoadingAddress(false);
          return;
        }
        try {
          const userDocRef = doc(db, 'users', auth.currentUser.uid);
          const userDocSnap = await getDoc(userDocRef);
          if (isActive) {
            setShippingAddress(
              userDocSnap.exists() ? userDocSnap.data().shippingAddress || null : null
            );
          }
        } catch (error) {
          console.error('Error loading shipping address:', error);
        } finally {
          if (isActive) setLoadingAddress(false);
        }
      };

      loadAddress();
      return () => {
        isActive = false;
      };
    }, [])
  );

  const subtotal = orderItems.reduce((sum, item) => {
    const price = parsePrice(item.price);
    const qty = item.quantity || 1;
    return sum + price * qty;
  }, 0);

  const shipping = 0; // Free shipping
  const total = subtotal + shipping;

  const handlePlaceOrder = async () => {
    if (!auth.currentUser) {
      Alert.alert('Login Required', 'Please sign in to place an order.', [
        { text: 'Login', onPress: () => navigation.navigate('Login') },
        { text: 'Cancel' },
      ]);
      return;
    }

    if (orderItems.length === 0) {
      Alert.alert('Empty Order', 'There are no items to check out.');
      return;
    }

    if (!shippingAddress) {
      Alert.alert(
        'Delivery Address Required',
        'Please add a delivery address before placing your order.',
        [
          { text: 'Add Address', onPress: () => navigation.navigate('Location') },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    if (!selectedPayment) {
      Alert.alert('Payment Method Required', 'Please select a payment method.');
      return;
    }

    try {
      // Batched write: creating the order and clearing the purchased items
      // out of the cart happen as one atomic unit — either both succeed or
      // neither does, so we can never end up with an order placed but the
      // cart still showing the same items (which would let it be
      // accidentally checked out a second time).
      const batch = writeBatch(db);

      const userOrdersRef = collection(db, 'users', auth.currentUser.uid, 'orders');
      // doc() with no id generates a ref with an auto-id without writing
      // anything yet — addDoc() can't be used here since it writes
      // immediately and can't be grouped into a batch.
      const newOrderRef = doc(userOrdersRef);

      const orderData = {
        // customerId/customerEmail let the admin dashboard identify who placed
        // this order — the order doc itself lives under users/{uid}/orders,
        // so the uid is implicit in the path, but the admin's collectionGroup
        // query reads many users' orders flattened together, where that
        // context is lost unless we store it directly on the document.
        customerId: auth.currentUser.uid,
        customerEmail: auth.currentUser.email || 'unknown',
        items: orderItems.map((item) => ({
          productId: item.id || item.productId || 'unknown',
          name: item.name,
          price: parsePrice(item.price),
          quantity: item.quantity || 1,
          size: item.selectedSize || item.size || null,
          color: item.selectedColor || item.color || null,
          image: item.image || item.imageUrl || null,
        })),
        subtotal,
        shipping,
        total,
        paymentMethod: selectedPayment,
        shippingAddress: {
          fullName: shippingAddress.fullName || '',
          phone: shippingAddress.phone || '',
          address: shippingAddress.address || '',
          city: shippingAddress.city || '',
          province: shippingAddress.province || '',
          zipCode: shippingAddress.zipCode || '',
        },
        status: 'pending',
        createdAt: serverTimestamp(),
      };

      batch.set(newOrderRef, orderData);

      // Only items that came from an actual cart document carry a
      // `productId` field distinct from their own `id` (CartContext's
      // addToCart writes it explicitly). Buy Now items are a raw spread
      // of the product object and never had this field, so they're
      // correctly skipped here — there's no cart entry to clear.
      orderItems
        .filter((item) => item.productId && item.id)
        .forEach((item) => {
          const cartItemRef = doc(db, 'users', auth.currentUser.uid, 'cart', item.id);
          batch.delete(cartItemRef);
        });

      await batch.commit();

      Alert.alert('Order Placed', 'Your order has been placed successfully!', [
        { text: 'OK', onPress: () => navigation.navigate('Home') },
      ]);
    } catch (error) {
      console.error('Error placing order:', error);
      Alert.alert('Error', 'Could not place your order. Please try again.');
    }
  };

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
        {/* Item List */}
        <Text style={styles.sectionTitle}>Items</Text>
        {orderItems.map((item, index) => (
          <View key={index} style={styles.itemRow}>
            {(item.image || item.imageUrl) ? (
              <Image source={{ uri: item.image || item.imageUrl }} style={styles.itemImage} />
            ) : null}
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemMeta}>
                {item.selectedSize || item.size} · {item.selectedColor || item.color} · Qty {item.quantity || 1}
              </Text>
            </View>
            <Text style={styles.itemPrice}>
              ₱{(parsePrice(item.price) * (item.quantity || 1)).toFixed(2)}
            </Text>
          </View>
        ))}

        {/* Delivery Address */}
        <Text style={styles.sectionTitle}>Delivery Address</Text>
        {loadingAddress ? (
          <View style={styles.addressCard}>
            <Text style={styles.addressPlaceholder}>Loading address...</Text>
          </View>
        ) : shippingAddress ? (
          <TouchableOpacity
            style={styles.addressCard}
            onPress={() => navigation.navigate('Location')}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.addressName}>
                {shippingAddress.fullName} · {shippingAddress.phone}
              </Text>
              <Text style={styles.addressDetail}>
                {shippingAddress.address}, {shippingAddress.city}, {shippingAddress.province} {shippingAddress.zipCode}
              </Text>
            </View>
            <Text style={styles.changeText}>Change</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.addAddressCard}
            onPress={() => navigation.navigate('Location')}
          >
            <Ionicons name="add-circle-outline" size={20} color="#8B6F47" />
            <Text style={styles.addAddressText}>Add a delivery address</Text>
          </TouchableOpacity>
        )}

        {/* Order Summary */}
        <Text style={styles.sectionTitle}>Order Summary</Text>
        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>Subtotal:</Text>
            <Text style={styles.value}>₱{subtotal.toFixed(2)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Shipping:</Text>
            <Text style={styles.value}>Free</Text>
          </View>
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total:</Text>
            <Text style={styles.totalValue}>₱{total.toFixed(2)}</Text>
          </View>
        </View>

        {/* Payment Method */}
        <Text style={styles.sectionTitle}>Payment Method</Text>
        <View style={styles.paymentRow}>
          {paymentOptions.map((option) => {
            const isSelected = selectedPayment === option.id;
            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.paymentOption, isSelected && styles.paymentOptionActive]}
                onPress={() => setSelectedPayment(option.id)}
              >
                <Ionicons
                  name={option.icon}
                  size={22}
                  color={isSelected ? '#fff' : '#8B6F47'}
                />
                <Text style={[styles.paymentOptionText, isSelected && styles.paymentOptionTextActive]} numberOfLines={1}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <TouchableOpacity style={styles.placeButton} onPress={handlePlaceOrder}>
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
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#000', marginBottom: 15, marginTop: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  itemImage: { width: 50, height: 50, borderRadius: 8, backgroundColor: '#F2F2F7' },
  itemName: { fontSize: 14, fontWeight: '600', color: '#000' },
  itemMeta: { fontSize: 12, color: '#666', marginTop: 2 },
  itemPrice: { fontSize: 14, fontWeight: '600', color: '#000' },
  addressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
  },
  addressPlaceholder: { fontSize: 13, color: '#999' },
  addressName: { fontSize: 14, fontWeight: '600', color: '#000', marginBottom: 4 },
  addressDetail: { fontSize: 12, color: '#666', lineHeight: 18 },
  changeText: { fontSize: 13, color: '#8B6F47', fontWeight: '600', marginLeft: 10 },
  addAddressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#8B6F47',
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 15,
    marginBottom: 10,
  },
  addAddressText: { fontSize: 14, color: '#8B6F47', fontWeight: '600' },
  section: { borderWidth: 1, borderColor: '#eee', borderRadius: 8, padding: 15 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  totalRow: { borderTopWidth: 1, borderTopColor: '#eee', marginTop: 10 },
  label: { fontSize: 14, color: '#666' },
  value: { fontSize: 14, fontWeight: '600', color: '#000' },
  totalLabel: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  totalValue: { fontSize: 16, fontWeight: 'bold', color: '#00BFFF' },
  paymentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  paymentOption: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#fff',
  },
  paymentOptionActive: {
    backgroundColor: '#8B6F47',
    borderColor: '#8B6F47',
  },
  paymentOptionText: { fontSize: 13, fontWeight: '600', color: '#8B6F47' },
  paymentOptionTextActive: { color: '#fff' },
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