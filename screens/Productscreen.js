import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { showAppAlert } from '../utils/appAlert';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  useReducedMotion,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

import { useFavorites } from '../context/FavoritesContext';
import { useCart } from '../context/CartContext';
import { COLOR_PALETTE, DEFAULT_COLORS, DEFAULT_SIZES } from '../constants/productOptions';
import { Colors, Radius } from '../constants/theme';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import SkeletonBlock from '../components/ui/Skeleton';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

// Falls back to a neutral gray swatch instead of crashing if a stored
// color name doesn't match anything in COLOR_PALETTE (e.g. the palette
// changes later and an older product still references a retired name).
const getColorHex = (colorName) => {
  const found = COLOR_PALETTE.find((c) => c.name === colorName);
  return found ? found.hex : '#808080';
};

// Picks a dark or light checkmark so the selected-swatch indicator stays
// readable against any product color, not just the palette's darker half.
const isLightColor = (hex) => {
  const value = hex.replace('#', '');
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
};

// Fades a remote image in over its skeleton once decoded, instead of
// popping in abruptly — same treatment Home gives its product photos.
function FadingImage({ style, onLoad, ...rest }) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const handleLoad = (e) => {
    opacity.value = reduceMotion ? 1 : withTiming(1, { duration: 280, easing: EASE_OUT_QUART });
    onLoad?.(e);
  };
  return <Animated.Image style={[style, animatedStyle]} onLoad={handleLoad} {...rest} />;
}

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
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const reduceMotion = useReducedMotion();
  const favoriteScale = useSharedValue(1);
  const favoriteAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: favoriteScale.value }],
  }));
  const cartBadgeScale = useSharedValue(1);
  const cartBadgeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cartBadgeScale.value }],
  }));
  const previousCartCount = useRef(cartCount);

  const productName = product?.name || 'Product Details';
  const productPrice = product?.price || '0.00';
  const formattedPrice = `₱${parsePrice(productPrice).toFixed(2)}`;
  const productImage = product?.imageUrl || product?.image || 'https://via.placeholder.com/400';
  const productId = product?.id || 'unknown';
  const productType = product?.type || 'ready-to-wear';

  // A missing/non-numeric stock value must NOT be treated the same as a
  // confirmed zero (SRS 2.2/5a only fires on an actual 0) —
  // parseInt(undefined) is NaN, not 0, so this stays distinct on purpose.
  const parsedStockValue = parseInt(product?.stock, 10);
  const hasKnownStock = !Number.isNaN(parsedStockValue);
  const isOutOfStock = hasKnownStock && parsedStockValue === 0;
  const isLowStock = hasKnownStock && parsedStockValue > 0 && parsedStockValue < 10;
  // Unrecorded stock is treated as unlimited, not zero — previously the
  // quantity stepper capped at `parseInt(product?.stock || '0')`, permanently
  // locking quantity at 1 for exactly the products least likely to have
  // inventory data entered.
  const maxQuantity = hasKnownStock ? parsedStockValue : Infinity;
  const atMaxQuantity = hasKnownStock && quantity >= maxQuantity;

  // Older products may predate this field, or an admin may have left it
  // blank — render nothing at all in either case rather than an empty
  // heading with no body text under it.
  const hasDescription = Boolean(product?.description && product.description.trim().length > 0);

  useEffect(() => {
    if (product?.id) {
      setIsFavoriteState(isFavorite(product.id));
    }
  }, [product, isFavorite]);

  // Cart badge gets a settle-pulse whenever the count actually grows (not on
  // mount, and not when it shrinks from removals elsewhere) — quick visual
  // confirmation that lives at the icon the user will look for next.
  useEffect(() => {
    if (cartCount > previousCartCount.current && !reduceMotion) {
      cartBadgeScale.value = withSequence(
        withTiming(1.35, { duration: 100, easing: EASE_OUT_QUINT }),
        withTiming(1, { duration: 180, easing: EASE_OUT_QUART })
      );
    }
    previousCartCount.current = cartCount;
  }, [cartCount]);

  const handleToggleFavorite = async () => {
    if (!product) return;
    if (!reduceMotion) {
      favoriteScale.value = withSequence(
        withTiming(0.85, { duration: 80, easing: EASE_OUT_QUINT }),
        withTiming(1.15, { duration: 120, easing: EASE_OUT_QUART }),
        withTiming(1, { duration: 120, easing: EASE_OUT_QUART })
      );
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await toggleFavorite(product);
    if (result.success) {
      setIsFavoriteState(result.isFavorite);
    } else if (result.error === 'not-authenticated') {
      // Same Login-prompt pattern as handleAddToCart below, so both
      // guest-blocked actions on this screen behave identically.
      showAppAlert(
        "Login Required",
        "Please sign in to save favorites.",
        [{ text: "Login", onPress: () => navigation.navigate('Login') }, { text: "Cancel" }]
      );
    } else {
      showAppAlert('Error', 'Failed to update favorites');
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAppAlert(
        "Added to Cart",
        `${productName} (${selectedSize}) has been added.`,
        [
          { text: "View Cart", onPress: () => navigation.navigate('Cart') },
          { text: "Continue Shopping", style: "cancel" }
        ]
      );
    } else if (result.error === 'not-authenticated') {
      showAppAlert(
        "Login Required",
        "Please sign in to add items to your cart.",
        [{ text: "Login", onPress: () => navigation.navigate('Login') }, { text: "Cancel" }]
      );
    } else {
      console.error("Error adding to cart:", result.error);
      showAppAlert("Error", "Could not save item to cart. Please try again.");
    }
  };

  const handleBuyNow = () => {
    navigation.navigate('Checkout', {
      orderItems: [{ ...product, selectedColor, selectedSize, quantity, image: productImage }]
    });
  };

  const handleSelectColor = (color) => {
    if (color === selectedColor) return;
    Haptics.selectionAsync();
    setSelectedColor(color);
  };

  const handleSelectSize = (size) => {
    if (size === selectedSize) return;
    Haptics.selectionAsync();
    setSelectedSize(size);
  };

  // Route params can arrive without a product (a stale deep link, a
  // malformed nav call) — render the shared EmptyState instead of a
  // fabricated "Product Details" / ₱0.00 placeholder product.
  if (!product) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Details</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.missingProductState}>
          <EmptyState
            icon="alert-circle-outline"
            title="Product unavailable"
            subtitle="This item may have been removed or the link is out of date."
          />
          <View style={styles.shopNowButtonWrap}>
            <Button variant="primary" label="Back to Shop" onPress={() => navigation.navigate('Shop')} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Details</Text>
        <View style={styles.headerRight}>
          <Pressable
            style={styles.iconButton}
            onPress={handleToggleFavorite}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={isFavoriteState ? `Remove ${productName} from favorites` : `Add ${productName} to favorites`}
            accessibilityState={{ selected: isFavoriteState }}
          >
            <Animated.View style={favoriteAnimatedStyle}>
              <Ionicons
                name={isFavoriteState ? "heart" : "heart-outline"}
                size={24}
                color={isFavoriteState ? Colors.light.danger : Colors.light.text}
              />
            </Animated.View>
          </Pressable>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => navigation.navigate('Cart')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={cartCount > 0 ? `View cart, ${cartCount} items` : 'View cart'}
          >
            <View style={styles.cartIconWrapper}>
              <Ionicons name="cart-outline" size={24} color={Colors.light.text} />
              {cartCount > 0 && (
                <Animated.View style={[styles.cartBadge, cartBadgeAnimatedStyle]}>
                  <Text style={styles.cartBadgeText}>{cartCount > 99 ? '99+' : cartCount}</Text>
                </Animated.View>
              )}
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Product Image */}
        <View style={styles.imageContainer}>
          {!imageLoaded && !imageFailed && <SkeletonBlock style={StyleSheet.absoluteFill} />}
          {imageFailed ? (
            <View style={styles.imageFallback}>
              <Ionicons name="image-outline" size={40} color={Colors.light.icon} />
              <Text style={styles.imageFallbackText}>Photo unavailable</Text>
            </View>
          ) : (
            <FadingImage
              source={{ uri: productImage }}
              style={styles.productImage}
              resizeMode="cover"
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageFailed(true)}
              accessible
              accessibilityLabel={`Photo of ${productName}`}
            />
          )}
          {isOutOfStock && (
            <View style={styles.imageBadgeWrap}>
              <Badge label="Out of Stock" color={Colors.light.danger} />
            </View>
          )}
        </View>

        {/* Product Info */}
        <View style={styles.productInfo}>
          <Text style={styles.productName}>{productName}</Text>
          <Text style={styles.productPrice}>{formattedPrice}</Text>

          {/* Product Type Badge */}
          <View style={styles.typeBadgeRow}>
            {productType === 'ukay-ukay' ? (
              <MaterialCommunityIcons name="recycle" size={14} color={Colors.light.secondary} />
            ) : (
              <Ionicons name="shirt-outline" size={14} color={Colors.light.tint} />
            )}
            <Badge
              label={productType === 'ukay-ukay' ? 'Ukay-Ukay' : 'Ready to Wear'}
              color={productType === 'ukay-ukay' ? Colors.light.secondary : Colors.light.tint}
            />
          </View>

          {/* Stock Status */}
          {isOutOfStock ? (
            <View style={styles.stockBadgeRow}>
              <Badge label="Out of Stock" color={Colors.light.danger} />
            </View>
          ) : isLowStock ? (
            <View style={styles.stockBadgeRow}>
              <Badge label={`Only ${parsedStockValue} left in stock`} color={Colors.light.danger} />
            </View>
          ) : null}

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
            {productColors.map((color) => {
              const selected = selectedColor === color;
              const hex = getColorHex(color);
              return (
                <AnimatedPressable
                  key={color}
                  style={[styles.colorSwatchWrap, selected && styles.colorSwatchWrapSelected]}
                  onPress={() => handleSelectColor(color)}
                  accessibilityRole="button"
                  accessibilityLabel={`Color: ${color}`}
                  accessibilityState={{ selected }}
                >
                  <View style={[styles.colorOption, { backgroundColor: hex }]}>
                    {selected && (
                      <Ionicons name="checkmark" size={16} color={isLightColor(hex) ? Colors.light.text : '#fff'} />
                    )}
                  </View>
                </AnimatedPressable>
              );
            })}
          </View>

          {/* Size Selection */}
          <Text style={styles.sectionTitle}>Size</Text>
          <View style={styles.optionsRow}>
            {productSizes.map((size) => {
              const selected = selectedSize === size;
              return (
                <AnimatedPressable
                  key={size}
                  style={[styles.sizeOption, { backgroundColor: selected ? Colors.light.tint : Colors.light.border }]}
                  onPress={() => handleSelectSize(size)}
                  accessibilityRole="button"
                  accessibilityLabel={`Size ${size}`}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.sizeText, { color: selected ? '#fff' : Colors.light.text }]}>
                    {size}
                  </Text>
                </AnimatedPressable>
              );
            })}
          </View>

          {/* Quantity */}
          <Text style={styles.sectionTitle}>Quantity</Text>
          <View style={styles.quantityContainer}>
            <AnimatedPressable
              style={styles.quantityButton}
              onPress={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Decrease quantity"
              accessibilityState={{ disabled: quantity <= 1 }}
            >
              <Ionicons name="remove" size={20} color={Colors.light.text} style={[quantity <= 1 && styles.quantityIconDisabled]} />
            </AnimatedPressable>
            <Text style={styles.quantityText}>{quantity}</Text>
            <AnimatedPressable
              style={styles.quantityButton}
              onPress={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
              disabled={atMaxQuantity}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Increase quantity"
              accessibilityState={{ disabled: atMaxQuantity }}
            >
              <Ionicons name="add" size={20} color={Colors.light.text} style={[atMaxQuantity && styles.quantityIconDisabled]} />
            </AnimatedPressable>
          </View>
          <View style={styles.quantityHelperRow}>
            {atMaxQuantity && maxQuantity > 0 ? (
              <Text style={styles.maxStockText}>Max stock reached</Text>
            ) : null}
          </View>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.actionContainer}>
        <View style={{ flex: 1 }}>
          <Button
            variant="secondary"
            label="Add to Cart"
            onPress={handleAddToCart}
            loading={isAdding}
            disabled={isOutOfStock}
          />
        </View>
        <View style={{ flex: 1.4 }}>
          <Button
            variant="primary"
            label={`Buy Now ${formattedPrice}`}
            onPress={handleBuyNow}
            disabled={isOutOfStock}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text },
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
    backgroundColor: Colors.light.danger,
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
  imageContainer: { height: 400, backgroundColor: Colors.light.border, position: 'relative' },
  productImage: { width: '100%', height: '100%' },
  imageFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.light.border,
  },
  imageFallbackText: { fontSize: 13, color: Colors.light.icon, fontWeight: '600' },
  imageBadgeWrap: { position: 'absolute', top: 16, left: 16 },
  productInfo: { padding: 20 },
  productName: { fontSize: 24, fontWeight: '700', color: Colors.light.text, marginBottom: 8 },
  productPrice: { fontSize: 22, fontWeight: '700', color: Colors.light.highlight, marginBottom: 24 },
  typeBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginBottom: 12 },
  stockBadgeRow: { alignSelf: 'flex-start', marginBottom: 16 },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: Colors.light.text, marginBottom: 16 },
  descriptionText: { fontSize: 15, color: Colors.light.icon, lineHeight: 22, marginBottom: 24 },
  optionsRow: { flexDirection: 'row', marginBottom: 24, flexWrap: 'wrap' },
  // 44x44 wrapper is the real touch target and selection ring; the visible
  // swatch inside is smaller so the ring reads as a deliberate frame, not
  // a second border fighting the first.
  colorSwatchWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorSwatchWrapSelected: { borderColor: Colors.light.tint },
  colorOption: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: Colors.light.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sizeOption: { width: 50, height: 50, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center', marginRight: 16, marginBottom: 10 },
  sizeText: { fontSize: 16, fontWeight: '600' },
  quantityContainer: { flexDirection: 'row', alignItems: 'center' },
  quantityButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.light.border, justifyContent: 'center', alignItems: 'center' },
  quantityIconDisabled: { opacity: 0.3 },
  quantityText: { fontSize: 18, fontWeight: '600', marginHorizontal: 24, color: Colors.light.text },
  // Reserves consistent space for "Max stock reached" whether it's shown or
  // not, replacing the old negative-margin hack that pulled the text up
  // under the stepper (fragile — broke the moment the row above resized).
  quantityHelperRow: { minHeight: 24, justifyContent: 'center', marginTop: 8, marginBottom: 24 },
  maxStockText: { color: Colors.light.danger, fontSize: 12 },
  missingProductState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  shopNowButtonWrap: { marginTop: 20, width: 200 },
  actionContainer: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderTopColor: Colors.light.border, backgroundColor: Colors.light.background, gap: 12 },
});
