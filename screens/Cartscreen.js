import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Image,
  ActivityIndicator,
  FlatList
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { auth, db } from '../firebaseConfig'; 
import { collection, query, onSnapshot, doc, deleteDoc } from 'firebase/firestore';

export default function CartScreen({ navigation }) {
  const [cartItems, setCartItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.currentUser) return;

    const cartRef = collection(db, "users", auth.currentUser.uid, "cart");
    const q = query(cartRef);

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const items = [];
      querySnapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() });
      });
      setCartItems(items);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const removeItem = async (itemId) => {
    try {
      await deleteDoc(doc(db, "users", auth.currentUser.uid, "cart", itemId));
    } catch (error) {
      console.error("Error removing item: ", error);
    }
  };

  const calculateTotal = () => {
    return cartItems.reduce((total, item) => {
      const price = parseFloat(item.price.replace('$', ''));
      return total + (price * item.quantity);
    }, 0).toFixed(2);
  };

  const renderCartItem = ({ item }) => (
    <View style={styles.cartItemCard}>
      <Image source={{ uri: item.image }} style={styles.itemImage} />
      <View style={styles.itemDetails}>
        <Text style={styles.itemName}>{item.name}</Text>
        <Text style={styles.itemSpecs}>Size: {item.size} | Color: {item.color}</Text>
        <Text style={styles.itemPrice}>{item.price} x {item.quantity}</Text>
      </View>
      <TouchableOpacity onPress={() => removeItem(item.id)} style={styles.deleteButton}>
        <Ionicons name="trash-outline" size={22} color="#FF3B30" />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.statusBar}>
        <Text style={styles.time}>8:34</Text>
        <View style={styles.statusIcons}>
          <View style={styles.signal} />
          <View style={styles.wifi} />
          <View style={styles.battery} />
        </View>
      </View>

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
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalPrice}>${calculateTotal()}</Text>
            </View>
            <TouchableOpacity
              style={styles.continueButton}
              onPress={() => navigation.navigate('Checkout', { total: calculateTotal() })}
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
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 10 : 30,
    paddingBottom: 10,
  },
  time: { fontSize: 17, fontWeight: '600', color: '#000' },
  statusIcons: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  signal: { width: 18, height: 12, backgroundColor: '#000', borderRadius: 2 },
  wifi: { width: 16, height: 12, backgroundColor: '#000', borderRadius: 2 },
  battery: { width: 24, height: 12, backgroundColor: '#000', borderRadius: 3 },
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
  itemImage: { width: 70, height: 70, borderRadius: 8, backgroundColor: '#f9f9f9' },
  itemDetails: { flex: 1, marginLeft: 15 },
  itemName: { fontSize: 16, fontWeight: 'bold', color: '#000' },
  itemSpecs: { fontSize: 12, color: '#666', marginTop: 4 },
  itemPrice: { fontSize: 14, fontWeight: '600', color: '#8B6F47', marginTop: 4 },
  deleteButton: { padding: 5 },
  footer: { padding: 20, borderTopWidth: 1, borderTopColor: '#eee', backgroundColor: '#fff' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15, alignItems: 'center' },
  totalLabel: { fontSize: 18, color: '#666' },
  totalPrice: { fontSize: 22, fontWeight: 'bold', color: '#000' },
  continueButton: { backgroundColor: '#8B6F47', paddingVertical: 16, borderRadius: 10, alignItems: 'center' },
  continueButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#000', marginTop: 20 },
});
