import React, { useState } from 'react';
import {
View,
Text,
StyleSheet,
ScrollView,
TouchableOpacity,
SafeAreaView,
FlatList,
Platform,
Image,
ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useProducts } from '../context/ProductContext'; // Add this import

// Function to get label styles based on product type
const getProductTypeLabel = (type) => {
  if (type === 'ukay-ukay') {
    return {
      label: 'Ukay-Ukay',
      style: styles.ukayLabel,
      textStyle: styles.ukayLabelText,
    };
  } else {
    return {
      label: 'Ready to Wear',
      style: styles.rtwLabel,
      textStyle: styles.rtwLabelText,
    };
  }
};

const menuItems = [
{ icon: 'ticket-outline', label: 'Voucher', color: '#34C759' },
{ icon: 'gift-outline', label: 'Bonus', color: '#007AFF' },
{ icon: 'location-outline', label: 'Location', color: '#FF9500' },
{ icon: 'card-outline', label: 'Payment', color: '#AF52DE' },
{ icon: 'help-circle-outline', label: 'Help', color: '#FF3B30' },
];

export default function ShopScreen({ navigation }) {
  const { products, loading } = useProducts(); // Get products from context

  const renderProduct = ({ item }) => {
    const productType = getProductTypeLabel(item.type);
    
    return (
      <TouchableOpacity
        style={styles.productCard}
        onPress={() => navigation.navigate('Product', { product: item })}
      >
        <View style={styles.productImage}>
          <Image
            source={{ uri: item.imageUrl }}
            style={styles.image}
            resizeMode="cover"
            onError={(e) => console.log('Image load error:', item.imageUrl)}
          />
          {/* Product Type Label Badge */}
          <View style={[styles.productTypeBadge, productType.style]}>
            <Ionicons name={item.type === 'ukay-ukay' ? "recycle-outline" : "shirt-outline"} size={12} color={productType.textStyle.color} />
            <Text style={[styles.productTypeText, productType.textStyle]}>
              {productType.label}
            </Text>
          </View>
        </View>
        <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.productPrice}>${item.price}</Text>
        
      </TouchableOpacity>
    );
  };

  if (loading) {
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
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Shop</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Cart')}>
            <Ionicons name="cart-outline" size={24} color="#000" />
          </TouchableOpacity>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading products...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Status Bar */}
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
        <Text style={styles.headerTitle}>Shop</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Cart')}>
          <Ionicons name="cart-outline" size={24} color="#000" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Menu Items */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.menuScroll}
          contentContainerStyle={styles.menuScrollContent}
        >
          {menuItems.map((item, index) => (
            <TouchableOpacity
              key={index}
              style={styles.menuItem}
              onPress={() => navigation.navigate(item.label)}
            >
              <View style={[styles.menuIcon, { backgroundColor: item.color + '20' }]}>
                <Ionicons name={item.icon} size={20} color={item.color} />
              </View>
              <Text style={styles.menuLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Products Grid */}
        {products.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="cube-outline" size={80} color="#ccc" />
            <Text style={styles.emptyText}>No products available</Text>
          </View>
        ) : (
          <FlatList
            data={products}
            renderItem={renderProduct}
            keyExtractor={(item) => item.id}
            numColumns={2}
            scrollEnabled={false}
            contentContainerStyle={styles.productsGrid}
          />
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
    paddingBottom: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
    marginTop: 16,
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 50 : 30,
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
  signal: { width: 18, height: 12, backgroundColor: '#000', borderRadius: 2 },
  wifi: { width: 16, height: 12, backgroundColor: '#000', borderRadius: 2 },
  battery: { width: 24, height: 12, backgroundColor: '#000', borderRadius: 3 },
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
  menuScroll: {
    paddingVertical: 16,
    maxHeight: 120,
  },
  menuScrollContent: {
    paddingHorizontal: 20,
  },
  menuItem: {
    alignItems: 'center',
    marginRight: 25,
  },
  menuIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  menuLabel: {
    fontSize: 12,
    color: '#000',
    fontWeight: '500',
  },
  productsGrid: {
    paddingHorizontal: 10,
    paddingBottom: 20,
  },
  productCard: {
    flex: 1,
    margin: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  productImage: {
    width: '100%',
    height: 160,
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
    marginBottom: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  productTypeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  ukayLabel: {
    backgroundColor: '#FF6B6B',
  },
  ukayLabelText: {
    color: '#FFFFFF',
  },
  rtwLabel: {
    backgroundColor: '#4CAF50',
  },
  rtwLabelText: {
    color: '#FFFFFF',
  },
  productTypeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  productName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
    //height: 36,
  },
  productPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
});