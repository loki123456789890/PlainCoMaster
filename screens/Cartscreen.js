import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
  ActivityIndicator,
  FlatList
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { auth } from '../firebaseConfig';
import { useProducts } from '../context/ProductContext';
import { useCart } from '../context/CartContext';

// Handles price as "₱450.00", "450", or a plain number 450
const parsePrice = (price) => {
  if (typeof price === 'number') return price;
  if (typeof price === 'string') {
    const cleaned = price.replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
  }
  return 0;
};

export default function CartScreen({ navigation }) {
  const { cartItems, loading, removeFromCart } = useCart();
  // Live products list, used only to check whether a cart item's original
  // product still exists — the cart item itself keeps its own saved price/name
  // regardless (see note on handleCheckout below).
  const { products } = useProducts();

  useEffect(() => {
    if (!auth.currentUser) {
      // Cart is a customer-only screen and shouldn't render at all if
      // nobody's signed in. CartContext already resolves loading=false
      // for guests, so this just handles the redirect.
      navigation.replace('Login');
    }
  }, []);

  const removeItem = async (itemId) => {
    const result = await removeFromCart(itemId);
    if (!result.success) {
      console.error('Error removing item:', result.error);
    }
  };

  const isAvailable = (item) => products.some((p) => p.id === item.productId);

  const availableCartItems = cartItems.filter(isAvailable);
  const hasUnavailableItems = cartItems.length > availableCartItems.length;

  const calculateTotal = () => {
    // Only sum items whose product still exists — an unavailable item
    // can't be checked out, so it shouldn't count toward the total either.
    return availableCartItems.reduce((total, item) => {
      return total + (parsePrice(item.price) * (item.quantity || 1));
    }, 0).toFixed(2);
  };

  const handleCheckout = () => {
    navigation.navigate('Checkout', { orderItems: availableCartItems });
  };

  const renderCartItem = ({ item }) => {
    const available = isAvailable(item);

    return (
      <View style={[styles.cartItemCard, !available && styles.cartItemCardUnavailable]}>
        <Image source={{ uri: item.image }} style={[styles.itemImage, !available && styles.itemImageUnavailable]} />
        <View style={styles.itemDetails}>
          <Text style={[styles.itemName, !available && styles.itemNameUnavailable]}>{item.name}</Text>
          <Text style={styles.itemSpecs}>Size: {item.size} | Color: {item.color}</Text>
          {available ? (
            <Text style={styles.itemPrice}>
              ₱{parsePrice(item.price).toFixed(2)} x {item.quantity || 1}
            </Text>
          ) : (
            <View style={styles.unavailableBadge}>
              <Ionicons name="alert-circle-outline" size={14} color="#FF3B30" />
              <Text style={styles.unavailableText}>No longer available</Text>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={() => removeItem(item.id)} style={styles.deleteButton}>
          <Ionicons name="trash-outline" size={22} color="#FF3B30" />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Shopping Cart</Text>
        <View style={{ width: 40 }} /> 
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#8B6F47" />
        </View>
      ) : cartItems.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="cart-outline" size={80} color="#ccc" />
          <Text style={styles.emptyText}>Your cart is empty</Text>
          <TouchableOpacity 
            style={[styles.continueButton, { marginTop: 20, width: 200 }]} 
            onPress={() => navigation.navigate('Shop')}
          >
            <Text style={styles.continueButtonText}>Shop Now</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <FlatList
            data={cartItems}
            renderItem={renderCartItem}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
          />
          <View style={styles.footer}>
            {hasUnavailableItems && (
              <Text style={styles.unavailableFooterNote}>
                Some items are no longer available and won't be included in checkout.
              </Text>
            )}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalPrice}>₱{calculateTotal()}</Text>
            </View>
            <TouchableOpacity
              style={[styles.continueButton, availableCartItems.length === 0 && styles.continueButtonDisabled]}
              onPress={handleCheckout}
              disabled={availableCartItems.length === 0}
            >
              <Text style={styles.continueButtonText}>Checkout</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
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
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#000', textAlign: 'center', flex: 1 },
  backButton: { width: 40 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  listContent: { padding: 20 },
  cartItemCard: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 12,
    marginBottom: 15, borderWidth: 1, borderColor: '#eee', alignItems: 'center'
  },
  cartItemCardUnavailable: {
    backgroundColor: '#FAFAFA',
    borderColor: '#F0F0F0',
  },
  itemImage: { width: 70, height: 70, borderRadius: 8, backgroundColor: '#f9f9f9' },
  itemImageUnavailable: {
    opacity: 0.4,
  },
  itemDetails: { flex: 1, marginLeft: 15 },
  itemName: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  itemNameUnavailable: {
    color: '#999',
  },
  itemSpecs: { fontSize: 12, color: '#666', marginTop: 4 },
  itemPrice: { fontSize: 14, fontWeight: '600', color: '#8B6F47', marginTop: 4 },
  unavailableBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  unavailableText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF3B30',
  },
  deleteButton: { padding: 5 },
  footer: { padding: 20, borderTopWidth: 1, borderTopColor: '#eee', backgroundColor: '#fff' },
  unavailableFooterNote: {
    fontSize: 12,
    color: '#FF3B30',
    marginBottom: 10,
    textAlign: 'center',
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15, alignItems: 'center' },
  totalLabel: { fontSize: 18, color: '#666' },
  totalPrice: { fontSize: 22, fontWeight: 'bold', color: '#000' },
  continueButton: { backgroundColor: '#8B6F47', paddingVertical: 16, borderRadius: 10, alignItems: 'center' },
  continueButtonDisabled: {
    backgroundColor: '#ccc',
  },
  continueButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#000', marginTop: 20 },
});