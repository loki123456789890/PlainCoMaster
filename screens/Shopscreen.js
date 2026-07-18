import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  Platform,
  Image,
  ActivityIndicator,
  TextInput
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useProducts } from '../context/ProductContext';
import { useCart } from '../context/CartContext';

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
  { icon: 'location-outline', label: 'Location', color: '#FF9500' },
  { icon: 'help-circle-outline', label: 'Help', color: '#FF3B30' },
];

const filterTabs = [
  { key: 'all', label: 'All' },
  { key: 'ready-to-wear', label: 'Ready-to-Wear' },
  { key: 'ukay-ukay', label: 'Ukay-Ukay' },
];

export default function ShopScreen({ navigation, route }) {
  const { products, loading } = useProducts();
  const { cartCount } = useCart();
  const [activeFilter, setActiveFilter] = useState(route.params?.filterType || 'all');
  const [searchQuery, setSearchQuery] = useState('');

  // If Home navigates here again with a different filterType while this screen
  // is already mounted (rather than freshly pushed), keep activeFilter synced.
  useEffect(() => {
    if (route.params?.filterType) {
      setActiveFilter(route.params.filterType);
    }
  }, [route.params?.filterType]);

  // Category tab and search compose together (AND), not either/or — typing
  // a search term never resets or bypasses whichever tab is currently
  // selected. Filters over the already-fetched in-memory `products` list
  // from ProductContext, same as AdminUsersScreen filters its own
  // already-fetched `users` array — no new Firestore query.
  const query = searchQuery.trim().toLowerCase();
  const filteredProducts = products
    .filter((p) => activeFilter === 'all' || p.type === activeFilter)
    .filter((p) => {
      if (!query) return true;
      return (
        p.name?.toLowerCase().includes(query) ||
        p.type?.toLowerCase().includes(query)
      );
    });

  const renderCartIcon = () => (
    <View style={styles.cartIconWrapper}>
      <Ionicons name="cart-outline" size={24} color="#000" />
      {cartCount > 0 && (
        <View style={styles.cartBadge}>
          <Text style={styles.cartBadgeText}>{cartCount > 99 ? '99+' : cartCount}</Text>
        </View>
      )}
    </View>
  );

  const renderProduct = ({ item }) => {
    const productType = getProductTypeLabel(item.type);
    const isUkay = item.type === 'ukay-ukay';

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
          <View style={[styles.productTypeBadge, productType.style]}>
            {isUkay ? (
              <MaterialCommunityIcons name="recycle" size={12} color={productType.textStyle.color} />
            ) : (
              <Ionicons name="shirt-outline" size={12} color={productType.textStyle.color} />
            )}
            <Text style={[styles.productTypeText, productType.textStyle]}>
              {productType.label}
            </Text>
          </View>
        </View>
        <Text style={styles.productName} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.productPrice}>₱{item.price}</Text>
      </TouchableOpacity>
    );
  };

  const renderMenuRow = () => (
    <View style={styles.menuRow}>
      {menuItems.map((item, index) => (
        <TouchableOpacity
          key={index}
          style={styles.menuButton}
          onPress={() => navigation.navigate(item.label)}
        >
          <Ionicons name={item.icon} size={16} color={item.color} />
          <Text style={styles.menuButtonLabel}>{item.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderSearchBar = () => (
    <View style={styles.searchContainer}>
      <Ionicons name="search-outline" size={20} color="#999" style={styles.searchIcon} />
      <TextInput
        style={styles.searchInput}
        placeholder="Search products..."
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
  );

  const renderFilterTabs = () => (
    <View style={styles.filterRow}>
      {filterTabs.map((tab) => {
        const isActive = activeFilter === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.filterChip, isActive && styles.filterChipActive]}
            onPress={() => setActiveFilter(tab.key)}
          >
            <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Shop</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Cart')}>
            {renderCartIcon()}
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Shop</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Cart')}>
          {renderCartIcon()}
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {renderMenuRow()}

        {renderSearchBar()}

        {renderFilterTabs()}

        {filteredProducts.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="cube-outline" size={80} color="#ccc" />
            <Text style={styles.emptyText}>
              {query
                ? 'No products found'
                : activeFilter === 'all'
                ? 'No products available'
                : 'No products in this category yet'}
            </Text>
            {query ? (
              <Text style={styles.emptySubtext}>Try a different search term</Text>
            ) : null}
          </View>
        ) : (
          <FlatList
            data={filteredProducts}
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
  container: { flex: 1, backgroundColor: '#fff' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 100 },
  loadingText: { marginTop: 12, fontSize: 14, color: '#666' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 100, paddingBottom: 40 },
  emptyText: { fontSize: 16, color: '#999', marginTop: 16 },
  emptySubtext: { fontSize: 14, color: '#999', marginTop: 8, textAlign: 'center' },
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
  cartIconWrapper: { position: 'relative' },
  cartBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    backgroundColor: '#FF3B30',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cartBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  menuRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 10,
  },
  menuButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F2F2F7',
  },
  menuButtonLabel: { fontSize: 13, fontWeight: '600', color: '#000' },
  // Same search bar pattern as AdminUsersScreen.js.
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F9FB',
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 8,
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
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: 4,
    marginBottom: 8,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F2F2F7',
  },
  filterChipActive: {
    backgroundColor: '#8B6F47',
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  productsGrid: { paddingHorizontal: 10, paddingBottom: 20 },
  productCard: {
    flex: 1, margin: 8, backgroundColor: '#fff', borderRadius: 12, padding: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  productImage: { width: '100%', height: 160, backgroundColor: '#F2F2F7', borderRadius: 8, marginBottom: 12, overflow: 'hidden', position: 'relative' },
  image: { width: '100%', height: '100%', resizeMode: 'cover' },
  productTypeBadge: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, gap: 4 },
  ukayLabel: { backgroundColor: '#FF6B6B' },
  ukayLabelText: { color: '#FFFFFF' },
  rtwLabel: { backgroundColor: '#4CAF50' },
  rtwLabelText: { color: '#FFFFFF' },
  productTypeText: { fontSize: 10, fontWeight: '600' },
  productName: { fontSize: 14, fontWeight: '600', color: '#000', marginBottom: 4, lineHeight: 18, height: 36 },
  productPrice: { fontSize: 16, fontWeight: '700', color: '#000' },
});