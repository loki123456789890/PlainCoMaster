import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Modal,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { showAppAlert } from '../../utils/appAlert';
import Animated, { useReducedMotion, FadeIn, FadeInDown } from 'react-native-reanimated';
import { useProducts } from '../../context/ProductContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { Colors, Radius } from '../../constants/theme';
import { EASE_OUT_QUART } from '../../constants/motion';
import { stockLevel } from '../../utils/stock';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import AnimatedPressable from '../../components/ui/AnimatedPressable';
import SkeletonBlock from '../../components/ui/Skeleton';
import ProductImage from '../../components/ui/ProductImage';

// Shaped like a real product row so the loading state previews the content
// that's about to arrive, matching the skeleton treatment every other admin
// list screen (Orders, Users, Support) already uses.
function ProductCardSkeleton() {
  return (
    <Card variant="flat" style={styles.productCard}>
      <SkeletonBlock style={styles.productImageSkeleton} />
      <View style={styles.productInfo}>
        <SkeletonBlock style={{ width: '85%', height: 14, borderRadius: Radius.sm, marginBottom: 8 }} />
        <SkeletonBlock style={{ width: 54, height: 18, borderRadius: Radius.pill, marginBottom: 8 }} />
        <SkeletonBlock style={{ width: '40%', height: 11, borderRadius: Radius.sm }} />
      </View>
    </Card>
  );
}

export default function AdminProductsScreen({ navigation, route }) {
  const { products, loading, error, deleteProduct, refreshProducts, retryFetchProducts } = useProducts();
  const [searchQuery, setSearchQuery] = useState('');
  // Set when arriving from the dashboard's restocking card. Held in state
  // rather than read from route.params directly so it can be cleared
  // without a navigation call — the manager should be able to widen back
  // to the full list without leaving the screen and coming back.
  const [restockOnly, setRestockOnly] = useState(route.params?.filter === 'restock');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshProducts();
    setRefreshing(false);
  };

  // If the dashboard sends the same filter again while this screen is
  // already mounted, honour it — same reasoning as Shopscreen's handling
  // of route.params.filterType.
  useEffect(() => {
    if (route.params?.filter === 'restock') setRestockOnly(true);
  }, [route.params?.filter]);

  // Search and the restocking filter compose (AND) rather than replacing
  // each other, so searching inside a restock list narrows it instead of
  // silently dropping back to the whole catalog.
  const filteredProducts = products
    .filter((product) => {
      if (!restockOnly) return true;
      const level = stockLevel(product.stock);
      return level === 'out' || level === 'low';
    })
    .filter(product =>
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (product.type && product.type.toLowerCase().includes(searchQuery.toLowerCase()))
    );

  const handleDelete = (product) => {
    Haptics.selectionAsync();
    setSelectedProduct(product);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!selectedProduct || !selectedProduct.id) {
      showAppAlert('Error', 'No product selected for deletion');
      setShowDeleteModal(false);
      return;
    }

    setDeleting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await deleteProduct(selectedProduct.id);
    setDeleting(false);
    setShowDeleteModal(false);
    setSelectedProduct(null);

    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert('Success', 'Product deleted successfully');
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('Error', 'Failed to delete product: ' + result.error);
    }
  };

  const handleView = (product) => {
    Haptics.selectionAsync();
    setSelectedProduct(product);
    setShowViewModal(true);
  };

  const getTypeLabel = (type) => {
    return type === 'ukay-ukay' ? 'Ukay-Ukay' : 'Ready to Wear';
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <AnimatedPressable
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
        </AnimatedPressable>
        <Text style={styles.headerTitle} accessibilityRole="header">Manage Products</Text>
        <AnimatedPressable
          onPress={() => navigation.navigate('AdminAddProduct')}
          style={styles.addButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Add product"
        >
          <Ionicons name="add-circle-outline" size={24} color={Colors.light.tint} />
        </AnimatedPressable>
      </View>

      {!isConnected && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={Colors.light.danger} />
          <Text style={styles.offlineBannerText}>
            No internet connection — product data may be out of date.
          </Text>
        </View>
      )}

      {/* Search Bar */}
      <Animated.View
        style={styles.searchContainer}
        entering={reduceMotion ? undefined : FadeInDown.duration(240).easing(EASE_OUT_QUART)}
      >
        <Ionicons name="search-outline" size={20} color={Colors.light.icon} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search products..."
          placeholderTextColor={Colors.light.icon}
          value={searchQuery}
          onChangeText={setSearchQuery}
          accessibilityLabel="Search products by name or type"
        />
        {searchQuery.length > 0 && (
          <AnimatedPressable
            onPress={() => setSearchQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={20} color={Colors.light.icon} />
          </AnimatedPressable>
        )}
      </Animated.View>

      {/* An active filter must never be invisible: without this, arriving
          from the dashboard would look like most of the catalog had
          vanished. Clearable in place so widening back to everything
          doesn't mean leaving the screen and coming back. */}
      {restockOnly && (
        <Animated.View
          style={styles.filterChipRow}
          entering={reduceMotion ? undefined : FadeIn.duration(200)}
        >
          <AnimatedPressable
            style={styles.filterChip}
            onPress={() => {
              Haptics.selectionAsync();
              setRestockOnly(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Showing only items needing restock. Tap to show all products."
          >
            <Ionicons name="alert-circle-outline" size={14} color={Colors.light.tint} />
            <Text style={styles.filterChipText}>Needs restocking</Text>
            <Ionicons name="close" size={14} color={Colors.light.tint} />
          </AnimatedPressable>
        </Animated.View>
      )}

      {/* Stats Summary */}
      <Animated.View
        style={styles.statsContainer}
        entering={reduceMotion ? undefined : FadeIn.duration(220)}
      >
        <Card variant="flat" style={styles.statBox}>
          <Text style={styles.statNumber}>{products.length}</Text>
          <Text style={styles.statLabel}>Total Products</Text>
        </Card>
        <Card variant="flat" style={styles.statBox}>
          <Text style={styles.statNumber}>
            {products.filter(p => p.type === 'ready-to-wear').length}
          </Text>
          <Text style={styles.statLabel}>Ready to Wear</Text>
        </Card>
        <Card variant="flat" style={styles.statBox}>
          <Text style={styles.statNumber}>
            {products.filter(p => p.type === 'ukay-ukay').length}
          </Text>
          <Text style={styles.statLabel}>Ukay-Ukay</Text>
        </Card>
      </Animated.View>

      {/* Products List */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.productsContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {loading && !refreshing ? (
          <>
            <ProductCardSkeleton />
            <ProductCardSkeleton />
            <ProductCardSkeleton />
          </>
        ) : error ? (
          <View style={styles.emptyStateWrap}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load products"
              subtitle="Check your connection and try again."
            />
            <View style={styles.emptyStateAction}>
              <Button variant="outline" label="Retry" onPress={retryFetchProducts} />
            </View>
          </View>
        ) : filteredProducts.length > 0 ? (
          filteredProducts.map((product, index) => (
            <Animated.View
              key={product.id}
              entering={
                reduceMotion
                  ? undefined
                  : FadeInDown.duration(240)
                      .delay(Math.min(index, 8) * 40)
                      .easing(EASE_OUT_QUART)
              }
            >
              <AnimatedPressable
                onPress={() => handleView(product)}
                accessibilityRole="button"
                accessibilityLabel={`${product.name}, ${getTypeLabel(product.type)}, ₱${parseFloat(product.price).toFixed(2)}`}
                accessibilityHint="Opens product details"
              >
                <Card variant="flat" style={styles.productCard}>
                  <ProductImage uri={product.imageUrl || product.image} style={styles.productImage} />
                  <View style={styles.productInfo}>
                    <Text style={styles.productName} numberOfLines={2}>
                      {product.name}
                    </Text>
                    <View style={styles.productMeta}>
                      <Badge
                        label={getTypeLabel(product.type)}
                        color={product.type === 'ukay-ukay' ? Colors.light.secondary : Colors.light.tint}
                      />
                      <Text style={styles.productPrice}>₱{parseFloat(product.price).toFixed(2)}</Text>
                    </View>
                    <Text style={styles.productStock}>Stock: {product.stock} pcs</Text>
                  </View>
                  <View style={styles.productActions}>
                    <AnimatedPressable
                      style={styles.actionButton}
                      onPress={() => navigation.navigate('AdminEditProduct', { product })}
                      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${product.name}`}
                    >
                      <Ionicons name="create-outline" size={20} color={Colors.light.tint} />
                    </AnimatedPressable>
                    <AnimatedPressable
                      style={styles.actionButton}
                      onPress={() => handleDelete(product)}
                      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${product.name}`}
                    >
                      <Ionicons name="trash-outline" size={20} color={Colors.light.danger} />
                    </AnimatedPressable>
                  </View>
                </Card>
              </AnimatedPressable>
            </Animated.View>
          ))
        ) : (
          <View style={styles.emptyStateWrap}>
            <EmptyState
              icon="cube-outline"
              title="No products found"
              subtitle={
                restockOnly
                  ? 'Nothing is running low right now.'
                  : searchQuery
                    ? 'Try a different search term'
                    : 'Tap + to add your first product'
              }
            />
            {Boolean(searchQuery) && (
              <View style={styles.emptyStateAction}>
                <Button variant="outline" label="Clear search" onPress={() => setSearchQuery('')} />
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* View Product Modal */}
      <Modal
        visible={showViewModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setShowViewModal(false);
          setSelectedProduct(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Product Details</Text>
              <AnimatedPressable
                onPress={() => {
                  setShowViewModal(false);
                  setSelectedProduct(null);
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </AnimatedPressable>
            </View>

            {selectedProduct && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <ProductImage uri={selectedProduct.imageUrl || selectedProduct.image} style={styles.modalImage} />
                <Text style={styles.modalProductName}>{selectedProduct.name}</Text>
                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Price:</Text>
                  <Text style={styles.modalInfoValue}>₱{parseFloat(selectedProduct.price).toFixed(2)}</Text>
                </View>
                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Type:</Text>
                  <Badge
                    label={getTypeLabel(selectedProduct.type)}
                    color={selectedProduct.type === 'ukay-ukay' ? Colors.light.secondary : Colors.light.tint}
                  />
                </View>
                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Stock:</Text>
                  <Text style={styles.modalInfoValue}>{selectedProduct.stock} pcs</Text>
                </View>
                <View style={styles.modalInfoRow}>
                  <Text style={styles.modalInfoLabel}>Description:</Text>
                  <Text style={styles.modalInfoValue}>{selectedProduct.description || 'No description'}</Text>
                </View>

                <View style={styles.modalButtons}>
                  <View style={styles.modalButtonHalf}>
                    <Button
                      variant="primary"
                      label="Edit Product"
                      onPress={() => {
                        setShowViewModal(false);
                        navigation.navigate('AdminEditProduct', { product: selectedProduct });
                      }}
                    />
                  </View>
                  <View style={styles.modalButtonHalf}>
                    <Button
                      variant="danger"
                      label="Delete"
                      onPress={() => {
                        setShowViewModal(false);
                        handleDelete(selectedProduct);
                      }}
                    />
                  </View>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setShowDeleteModal(false);
          setSelectedProduct(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModalContent}>
            <Text style={styles.modalTitle}>Delete Product</Text>
            <Text style={styles.modalMessage}>
              Are you sure you want to delete &quot;{selectedProduct?.name}&quot;? This action cannot be undone.
            </Text>
            <View style={styles.modalButtons}>
              <View style={styles.modalButtonHalf}>
                <Button
                  variant="secondary"
                  label="Cancel"
                  onPress={() => {
                    setShowDeleteModal(false);
                    setSelectedProduct(null);
                  }}
                  disabled={deleting}
                />
              </View>
              <View style={styles.modalButtonHalf}>
                <Button
                  variant="danger"
                  label="Delete"
                  onPress={confirmDelete}
                  loading={deleting}
                  disabled={deleting}
                />
              </View>
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
    backgroundColor: Colors.light.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    marginTop: Platform.OS === 'ios' ? 0 : 30,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.light.text,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.light.danger + '15',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.danger + '40',
  },
  offlineBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.light.danger },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.background,
    margin: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: Colors.light.text,
  },
  filterChipRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.light.tint,
    backgroundColor: Colors.light.tint + '12',
  },
  filterChipText: { fontSize: 12, fontWeight: '600', color: Colors.light.tint },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.light.tint,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.light.icon,
    marginTop: 4,
  },
  productsContainer: {
    padding: 16,
    paddingTop: 0,
    paddingBottom: 30,
  },
  emptyStateWrap: { paddingHorizontal: 16 },
  emptyStateAction: { marginTop: -8, marginBottom: 16, paddingHorizontal: 32 },
  productCard: {
    flexDirection: 'row',
    padding: 12,
    marginBottom: 12,
  },
  productImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: Colors.light.border,
  },
  productImageSkeleton: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  productInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  productName: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
    marginBottom: 6,
  },
  productMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  productPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.light.highlight,
  },
  productStock: {
    fontSize: 12,
    color: Colors.light.icon,
  },
  productActions: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  actionButton: {
    padding: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: Colors.light.background,
    borderRadius: 20,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
  },
  deleteModalContent: {
    backgroundColor: Colors.light.background,
    borderRadius: 20,
    padding: 20,
    width: '90%',
    alignItems: 'center',
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
    color: Colors.light.text,
  },
  modalImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 16,
  },
  modalProductName: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.light.text,
    marginBottom: 16,
  },
  modalInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  modalInfoLabel: {
    fontSize: 14,
    color: Colors.light.icon,
    fontWeight: '500',
  },
  modalInfoValue: {
    fontSize: 14,
    color: Colors.light.text,
    flex: 1,
    textAlign: 'right',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  modalButtonHalf: { flex: 1 },
  modalMessage: {
    fontSize: 14,
    color: Colors.light.icon,
    textAlign: 'center',
    marginBottom: 20,
  },
});
