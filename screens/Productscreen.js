import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Image,
  Alert,
  ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { useFavorites } from '../context/FavoritesContext';
import { useCart } from '../context/CartContext';
import { COLOR_PALETTE, DEFAULT_COLORS, DEFAULT_SIZES } from '../constants/productOptions';

// Falls back to a neutral gray swatch instead of crashing if a stored
// color name doesn't match anything in COLOR_PALETTE (e.g. the palette
// changes later and an older product still references a retired name).
const getColorHex = (colorName) => {
  const found = COLOR_PALETTE.find((c) => c.name === colorName);
  return found ? found.hex : '#808080';
};

// Handles price as "₱450.00", "450", or a plain number 450
const parsePrice = (price) => {
  if (typeof price === 'number') return price;
  if (typeof price === 'string') {
    const cleaned = price.replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
  }
  return 0;
};

export default function ProductScreen({ navigation, route }) {
  const { product } = route.params || {};
  const { toggleFavorite, isFavorite } = useFavorites();
  const { addToCart, cartCount } = useCart();

  // Legacy fallback: products saved before per-product colors/sizes
  // existed have no such array on their doc (or an admin left it empty),
  // so fall back to the old defaults rather than rendering zero options.
  const productColors =
    product?.colors && product.colors.length > 0 ? product.colors : DEFAULT_COLORS;
  const productSizes =
    product?.sizes && product.sizes.length > 0 ? product.sizes : DEFAULT_SIZES;

  // Auto-select the first available option on mount — for a single-color
  // product this is the only swatch rendered, and tapping it just
  // re-selects the same one, so there's no way to land on (or deselect
  // into) an option the product doesn't actually offer.
  const [selectedColor, setSelectedColor] = useState(productColors[0]);
  const [selectedSize, setSelectedSize] = useState(productSizes[0]);
  const [quantity, setQuantity] = useState(1);
  const [isFavoriteState, setIsFavoriteState] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  const productName = product?.name || 'Product Details';
  const productPrice = product?.price || '0.00';
  const formattedPrice = `₱${parsePrice(productPrice).toFixed(2)}`;
  const productImage = product?.imageUrl || product?.image || 'https://via.placeholder.com/400';
  const productId = product?.id || 'unknown';
  const productType = product?.type || 'ready-to-wear';
  const productStock = product?.stock || '0';

  // Separate from `productStock` above (which defaults a missing stock
  // field to '0' purely for the quantity stepper's cap). For the
  // Out-of-Stock gate specifically, a missing/non-numeric stock value must
  // NOT be treated the same as a confirmed zero (SRS 2.2/5a only fires on
  // an actual 0) — parseInt(undefined) is NaN, not 0, so this stays
  // distinct on purpose.
  const parsedStockValue = parseInt(product?.stock, 10);
  const hasKnownStock = !Number.isNaN(parsedStockValue);
  const isOutOfStock = hasKnownStock && parsedStockValue === 0;

  // Older products may predate this field, or an admin may have left it
  // blank — render nothing at all in either case rather than an empty
  // heading with no body text under it.
  const hasDescription = Boolean(product?.description && product.description.trim().length > 0);

  useEffect(() => {
    if (product?.id) {
      setIsFavoriteState(isFavorite(product.id));
    }
  }, [product, isFavorite]);

  const handleToggleFavorite = async () => {
    if (!product) return;
    const result = await toggleFavorite(product);
    if (result.success) {
      setIsFavoriteState(result.isFavorite);
    } else if (result.error === 'not-authenticated') {
      // Same Login-prompt pattern as handleAddToCart below, so both
      // guest-blocked actions on this screen behave identically.
      Alert.alert(
        "Login Required",
        "Please sign in to save favorites.",
        [{ text: "Login", onPress: () => navigation.navigate('Login') }, { text: "Cancel" }]
      );
    } else {
      Alert.alert('Error', 'Failed to update favorites');
    }
  };

  const handleAddToCart = async () => {
    setIsAdding(true);

    const cartItem = {
      productId: productId,
      name: productName,
      price: productPrice,
      image: productImage,
      color: selectedColor,
      size: selectedSize,
      quantity: quantity,
    };

    const result = await addToCart(cartItem);

    setIsAdding(false);

    if (result.success) {
      Alert.alert(
        "Added to Cart",
        `${productName} (${selectedSize}) has been added.`,
        [
          { text: "View Cart", onPress: () => navigation.navigate('Cart') },
          { text: "Continue Shopping", style: "cancel" }
        ]
      );
    } else if (result.error === 'not-authenticated') {
      Alert.alert(
        "Login Required",
        "Please sign in to add items to your cart.",
        [{ text: "Login", onPress: () => navigation.navigate('Login') }, { text: "Cancel" }]
      );
    } else {
      console.error("Error adding to cart:", result.error);
      Alert.alert("Error", "Could not save item to cart. Please try again.");
    }
  };

  const handleBuyNow = () => {
    navigation.navigate('Checkout', {
      orderItems: [{ ...product, selectedColor, selectedSize, quantity, image: productImage }]
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Details</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.iconButton} onPress={handleToggleFavorite}>
            <Ionicons 
              name={isFavoriteState ? "heart" : "heart-outline"} 
              size={24} 
              color={isFavoriteState ? "#FF3B30" : "#000"} 
            />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate('Cart')}>
            <View style={styles.cartIconWrapper}>
              <Ionicons name="cart-outline" size={24} color="#000" />
              {cartCount > 0 && (
                <View style={styles.cartBadge}>
                  <Text style={styles.cartBadgeText}>{cartCount > 99 ? '99+' : cartCount}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Product Image */}
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: productImage }}
            style={styles.productImage}
            resizeMode="cover"
            onError={(e) => console.log('Image load error:', productImage)}
          />
        </View>

        {/* Product Info */}
        <View style={styles.productInfo}>
          <Text style={styles.productName}>{productName}</Text>
          <Text style={styles.productPrice}>{formattedPrice}</Text>

          {/* Product Type Badge */}
          <View style={[styles.typeBadge, productType === 'ukay-ukay' ? styles.ukayBadge : styles.rtwBadge]}>
            {productType === 'ukay-ukay' ? (
              <MaterialCommunityIcons name="recycle" size={14} color="#FFFFFF" />
            ) : (
              <Ionicons name="shirt-outline" size={14} color="#FFFFFF" />
            )}
            <Text style={styles.typeBadgeText}>
              {productType === 'ukay-ukay' ? 'Ukay-Ukay' : 'Ready to Wear'}
            </Text>
          </View>

          {/* Stock Status */}
          {isOutOfStock ? (
            <Text style={styles.outOfStockText}>Out of Stock</Text>
          ) : (
            parseInt(productStock) < 10 && parseInt(productStock) > 0 && (
              <Text style={styles.lowStockText}>Only {productStock} left in stock!</Text>
            )
          )}

          {/* Description */}
          {hasDescription && (
            <>
              <Text style={styles.sectionTitle}>Description</Text>
              <Text style={styles.descriptionText}>{product.description}</Text>
            </>
          )}

          {/* Color Selection */}
          <Text style={styles.sectionTitle}>Color</Text>
          <View style={styles.optionsRow}>
            {productColors.map((color) => (
              <TouchableOpacity
                key={color}
                style={[
                  styles.colorOption,
                  { backgroundColor: getColorHex(color), borderColor: color === 'White' ? '#ddd' : '#000' },
                  selectedColor === color && styles.selectedColor
                ]}
                onPress={() => setSelectedColor(color)}
              />
            ))}
          </View>

          {/* Size Selection */}
          <Text style={styles.sectionTitle}>Size</Text>
          <View style={styles.optionsRow}>
            {productSizes.map((size) => (
              <TouchableOpacity
                key={size}
                style={[styles.sizeOption, { backgroundColor: selectedSize === size ? '#8B6F47' : '#F2F2F7' }]}
                onPress={() => setSelectedSize(size)}
              >
                <Text style={[styles.sizeText, { color: selectedSize === size ? '#fff' : '#000' }]}>
                  {size}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Quantity */}
          <Text style={styles.sectionTitle}>Quantity</Text>
          <View style={styles.quantityContainer}>
            <TouchableOpacity style={styles.quantityButton} onPress={() => setQuantity(Math.max(1, quantity - 1))}>
              <Text style={styles.quantityButtonText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.quantityText}>{quantity}</Text>
            <TouchableOpacity
              style={styles.quantityButton}
              onPress={() => setQuantity(Math.min(parseInt(productStock) || 999, quantity + 1))}
              disabled={quantity >= parseInt(productStock)}
            >
              <Text style={[styles.quantityButtonText, quantity >= parseInt(productStock) && { opacity: 0.3 }]}>+</Text>
            </TouchableOpacity>
          </View>
          {quantity >= parseInt(productStock) && parseInt(productStock) > 0 && (
            <Text style={styles.maxStockText}>Max stock reached</Text>
          )}
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.actionContainer}>
        <TouchableOpacity
          style={[
            styles.addToCartButton,
            isOutOfStock && styles.disabledButton,
            isAdding && { opacity: 0.7 },
          ]}
          onPress={handleAddToCart}
          disabled={isAdding || isOutOfStock}
        >
          {isAdding ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.addToCartText}>Add to Cart</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.buyNowButton, isOutOfStock && styles.disabledButton]}
          onPress={handleBuyNow}
          disabled={isOutOfStock}
        >
          <Text style={styles.buyNowText}>Buy Now {formattedPrice}</Text>
        </TouchableOpacity>
      </View>
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
    borderBottomColor: '#C6C6C8',
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#000' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  iconButton: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  // Same cart badge pattern as Shopscreen.js's header cart icon (cartCount
  // from CartContext, same '99+' cap and visual style) — Shop was chosen
  // over Home's bottom-tab badge since both are header icon buttons.
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
  imageContainer: { height: 400, backgroundColor: '#F2F2F7' },
  productImage: { width: '100%', height: '100%' },
  productInfo: { padding: 20 },
  productName: { fontSize: 24, fontWeight: '700', color: '#000', marginBottom: 8 },
  productPrice: { fontSize: 22, fontWeight: '700', color: '#000', marginBottom: 24 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginBottom: 12 },
  rtwBadge: { backgroundColor: '#4CAF50' },
  ukayBadge: { backgroundColor: '#FF6B6B' },
  typeBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  lowStockText: { color: '#FF3B30', fontSize: 14, fontWeight: '600', marginBottom: 16 },
  outOfStockText: { color: '#FF3B30', fontSize: 14, fontWeight: '700', marginBottom: 16 },
  maxStockText: { color: '#FF3B30', fontSize: 12, marginTop: -20, marginBottom: 10 },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#000', marginBottom: 16 },
  descriptionText: { fontSize: 15, color: '#444', lineHeight: 22, marginBottom: 24 },
  optionsRow: { flexDirection: 'row', marginBottom: 24, flexWrap: 'wrap' },
  colorOption: { width: 40, height: 40, borderRadius: 20, marginRight: 16, borderWidth: 1 },
  selectedColor: { borderWidth: 2, borderColor: '#8B6F47' },
  sizeOption: { width: 50, height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginRight: 16, marginBottom: 10 },
  sizeText: { fontSize: 16, fontWeight: '600' },
  quantityContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 40 },
  quantityButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F2F2F7', justifyContent: 'center', alignItems: 'center' },
  quantityButtonText: { fontSize: 20, fontWeight: '400', color: '#000' },
  quantityText: { fontSize: 18, fontWeight: '600', marginHorizontal: 24, color: '#000' },
  actionContainer: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderTopColor: '#C6C6C8', backgroundColor: '#fff', gap: 12 },
  addToCartButton: { paddingHorizontal: 12, paddingVertical: 16, backgroundColor: '#F2F2F7', borderRadius: 10, alignItems: 'center', flex: 1, height: 56, justifyContent: 'center' },
  addToCartText: { fontSize: 15, fontWeight: '600', color: '#000' },
  buyNowButton: { paddingHorizontal: 12, paddingVertical: 16, backgroundColor: '#8B6F47', borderRadius: 10, alignItems: 'center', flex: 1.4, height: 56, justifyContent: 'center' },
  buyNowText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  disabledButton: { opacity: 0.4 },
});