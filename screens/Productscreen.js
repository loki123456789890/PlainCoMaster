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

import { onSnapshot } from 'firebase/firestore';

import { useFavorites } from '../context/FavoritesContext';
import { useCart } from '../context/CartContext';
import { useProducts } from '../context/ProductContext';
import { useStores, useStoreRatings, storeReviewCountLabel } from '../context/StoreContext';
import { auth } from '../firebaseConfig';
import { COLOR_PALETTE, DEFAULT_COLORS, DEFAULT_SIZES } from '../constants/productOptions';
import { Colors, Radius } from '../constants/theme';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import SkeletonBlock from '../components/ui/Skeleton';
import ProductImage from '../components/ui/ProductImage';
import SizeGuideModal from '../components/ui/SizeGuideModal';
import StarRating from '../components/ui/StarRating';
import {
  productReviewsQuery,
  mapReviewDoc,
  visibleReviews,
  sortByNewest,
  summarizeReviews,
  formatAverage,
  matchedDescriptionSentence,
  reviewCountLabel,
} from '../utils/reviews';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

// How many reviews render before the "Show all" toggle appears. Three is
// enough to read the room without turning a product page into a feed.
const REVIEW_PREVIEW_COUNT = 3;

const formatReviewDate = (date) =>
  date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

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
  // What the navigation carried: a snapshot of the product taken when the
  // customer tapped it, which is where every field on this screen used to
  // come from. Stock, price and availability were therefore frozen at that
  // moment — a shopper could read "Only 2 left" long after the item sold
  // out, and only discover otherwise at checkout. On a catalog where much
  // of the stock is one-of-a-kind ukay-ukay, that is the ordinary case
  // rather than an edge one.
  const routeProduct = route.params?.product;
  const { toggleFavorite, isFavorite } = useFavorites();
  const { addToCart, cartCount } = useCart();
  // ProductContext already holds a live listener on the whole collection,
  // so reading through it costs no extra listener and no extra read — the
  // document this screen wants is already arriving.
  const { products, loading: productsLoading } = useProducts();

  const liveProduct = routeProduct?.id
    ? products.find((p) => p.id === routeProduct.id)
    : undefined;

  // The same lesson as Cartscreen's availability check: "not in the list"
  // and "the list hasn't arrived" are different answers, and only one of
  // them means the product is gone. Until the catalog has loaded, the
  // snapshot navigation carried stands in.
  //
  // Gated on a signed-in user because firestore.rules requires auth to
  // read /products, so ProductContext resolves to an empty array for a
  // guest — without this, every product page would report itself removed
  // rather than merely unreadable.
  const isRemoved =
    Boolean(routeProduct?.id) &&
    Boolean(auth.currentUser) &&
    !productsLoading &&
    !liveProduct;

  const product = liveProduct || routeProduct;
  const { getStore } = useStores();
  const store = getStore(product?.storeId);
  // The seller's rating, from the store's own verified-purchase reviews.
  // Undefined while loading, and for a product whose store can't be named.
  const sellerRating = useStoreRatings(store ? [store.id] : [])[store?.id];

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
  const [sizeGuideVisible, setSizeGuideVisible] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsFailed, setReviewsFailed] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);

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

  // Ukay-ukay sizing is inconsistent, so the guide only earns its spot when
  // there's real data — no disabled button, no modal that opens to an
  // empty table. Legacy products (saved before this field existed) simply
  // have no `measurements` key and fall through to false here.
  const hasMeasurements = Boolean(
    product?.measurements &&
      Object.values(product.measurements).some(
        (entry) => entry && Object.values(entry).some((value) => typeof value === 'string' && value.trim() !== '')
      )
  );

  // Recomputed on render rather than memoised: `reviews` is a handful of
  // documents, and the arithmetic is a sum and a filter over them.
  const reviewSummary = summarizeReviews(reviews);
  const visibleReviewList = showAllReviews ? reviews : reviews.slice(0, REVIEW_PREVIEW_COUNT);

  useEffect(() => {
    if (product?.id) {
      setIsFavoriteState(isFavorite(product.id));
    }
  }, [product, isFavorite]);

  // Now that the product is live, its options can change under a customer
  // mid-view — a seller editing colors or sizes is exactly what the
  // subscription above exists to surface. If the current selection stops
  // being offered, fall back to one that is, rather than letting a cart
  // line be built from a size or color the product no longer has.
  //
  // Both settle in a single pass: the fallback is drawn from the same list
  // being tested against, so the next run finds it and stops.
  useEffect(() => {
    if (!productColors.includes(selectedColor)) setSelectedColor(productColors[0]);
  }, [productColors, selectedColor]);

  useEffect(() => {
    if (!productSizes.includes(selectedSize)) setSelectedSize(productSizes[0]);
  }, [productSizes, selectedSize]);

  // Same reasoning for quantity against stock. The stepper's own cap stops
  // a customer raising quantity past what's available, but it cannot
  // retract a quantity that was legal when they chose it and isn't any
  // more because someone else bought two in the meantime. Clamped rather
  // than reset to 1: the customer asked for as many as they can still have.
  useEffect(() => {
    if (hasKnownStock && parsedStockValue > 0 && quantity > parsedStockValue) {
      setQuantity(parsedStockValue);
    }
  }, [hasKnownStock, parsedStockValue, quantity]);

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

  // This product's reviews, live — one posted from another device should
  // appear without a reload, and the query is a single equality filter over
  // a small set, so the listener is cheap.
  //
  // Gated on a signed-in user because firestore.rules requires auth to read
  // /reviews, exactly as it does for /products. Firing it for a guest would
  // produce a permission denial that isn't a real error, and the error path
  // below would then tell an honest user something is broken.
  useEffect(() => {
    if (!product?.id || !auth.currentUser) {
      setReviewsLoading(false);
      return undefined;
    }

    setReviewsLoading(true);
    const unsubscribe = onSnapshot(
      productReviewsQuery(product.id),
      (snapshot) => {
        // Hidden reviews are filtered here rather than in the query: an
        // equality filter on hidden plus this one would need a composite
        // index, and moderation is rare enough that the documents cost
        // nothing to fetch and drop. See utils/reviews.js.
        setReviews(sortByNewest(visibleReviews(snapshot.docs.map((d) => mapReviewDoc(d)))));
        setReviewsLoading(false);
        setReviewsFailed(false);
      },
      (error) => {
        console.error('Error loading product reviews:', error);
        setReviewsLoading(false);
        setReviewsFailed(true);
      }
    );

    return () => unsubscribe();
  }, [product?.id]);

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

  const handleOpenSizeGuide = () => {
    Haptics.selectionAsync();
    setSizeGuideVisible(true);
  };

  // Two ways to have nothing to show, and the existing copy covers both:
  // route params that arrived without a product (a stale deep link, a
  // malformed nav call), and a product the seller deleted while this
  // screen was open — which only became detectable once the data went
  // live. Either way, the shared EmptyState beats a fabricated
  // "Product Details" / ₱0.00 placeholder.
  if (!product || isRemoved) {
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
            <ProductImage
              uri={productImage}
              style={styles.productImage}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageFailed(true)}
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

          {/* A compact rating line sits with the price because that is
              where the buy/don't-buy decision is actually made — the full
              reviews section further down is for someone who has already
              decided to look closer. Rendered only when there is something
              to report: an empty star row next to the price would read as a
              zero rating rather than as an absence of ratings. */}
          {reviewSummary.count > 0 && (
            <View style={styles.ratingRow}>
              <StarRating rating={reviewSummary.average} size={15} label={productName} />
              <Text style={styles.ratingRowValue}>{formatAverage(reviewSummary.average)}</Text>
              <Text style={styles.ratingRowCount}>({reviewCountLabel(reviewSummary.count)})</Text>
            </View>
          )}

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

          {/* Who sells it. A multi-store cart checks out as one order per
              store, so the shopper should know the store before buying, and
              can open its page to see what else it has. Left out when the
              store can't be named (a product from before stores, or the
              store list failed to load) rather than showing a blank. */}
          {store && (
            <AnimatedPressable
              style={styles.soldByRow}
              onPress={() => navigation.push('Shop', { storeId: store.id })}
              rippleColor={Colors.light.border}
              accessibilityRole="button"
              accessibilityLabel={`Sold by ${store.name}. Open store`}
            >
              <Ionicons name="storefront-outline" size={18} color={Colors.light.tint} />
              <View style={styles.soldByTextWrap}>
                <Text style={styles.soldByText} numberOfLines={1}>
                  Sold by <Text style={styles.soldByName}>{store.name}</Text>
                </Text>
                {sellerRating ? (
                  <View style={styles.soldByRatingRow}>
                    {sellerRating.count > 0 && (
                      <>
                        <Ionicons name="star" size={12} color={Colors.light.highlight} />
                        <Text style={styles.soldByRatingValue}>{formatAverage(sellerRating.average)}</Text>
                      </>
                    )}
                    <Text style={styles.soldByRatingCount}>
                      {sellerRating.count > 0 ? `(${storeReviewCountLabel(sellerRating)})` : 'No store reviews yet'}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.soldByLink}>View store</Text>
              <Ionicons name="chevron-forward" size={14} color={Colors.light.tint} />
            </AnimatedPressable>
          )}

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
          {hasMeasurements && (
            <TouchableOpacity
              onPress={handleOpenSizeGuide}
              style={styles.sizeGuideButton}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="View size guide"
            >
              <Text style={styles.sizeGuideButtonText}>View Size Guide</Text>
            </TouchableOpacity>
          )}

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

          {/* Reviews.
              Only from people whose order containing this item reached
              'delivered' — enforced by firestore.rules, not by this screen,
              so "verified buyers" below is a statement about the data
              rather than a claim the UI is making on its behalf. */}
          <Text style={styles.sectionTitle}>Reviews</Text>

          {reviewsLoading ? (
            <View style={styles.reviewsSkeletonWrap}>
              <SkeletonBlock style={{ width: '50%', height: 16, borderRadius: Radius.sm, marginBottom: 10 }} />
              <SkeletonBlock style={{ width: '85%', height: 13, borderRadius: Radius.sm }} />
            </View>
          ) : reviewsFailed ? (
            <Text style={styles.reviewsErrorText}>
              {"Reviews couldn't be loaded right now. Everything else on this page is up to date."}
            </Text>
          ) : reviewSummary.count > 0 ? (
            <>
              <Card variant="flat" style={styles.reviewSummaryCard}>
                <View style={styles.reviewSummaryTop}>
                  <Text style={styles.reviewSummaryAverage}>
                    {formatAverage(reviewSummary.average)}
                  </Text>
                  <View style={styles.reviewSummaryTextWrap}>
                    <StarRating rating={reviewSummary.average} size={16} label={productName} />
                    <Text style={styles.reviewSummaryCount}>
                      {reviewCountLabel(reviewSummary.count)} from verified buyers
                    </Text>
                  </View>
                </View>
                <View style={styles.reviewSummaryDivider} />
                <View style={styles.matchedRow}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={Colors.light.secondary} />
                  <Text style={styles.matchedText}>{matchedDescriptionSentence(reviewSummary)}</Text>
                </View>
              </Card>

              {visibleReviewList.map((review) => (
                <View
                  key={review.id}
                  style={styles.reviewItem}
                  accessible
                  accessibilityLabel={`${review.rating} stars from ${review.userName}. ${
                    review.matchedDescription
                      ? 'Matched the description.'
                      : "Didn't match the description."
                  } ${review.text}`}
                >
                  <View style={styles.reviewItemHeader}>
                    <StarRating rating={review.rating} size={13} />
                    <Text style={styles.reviewItemAuthor} numberOfLines={1}>{review.userName}</Text>
                    <Text style={styles.reviewItemDate}>{formatReviewDate(review.createdAt)}</Text>
                  </View>
                  {/* Shown on every review, not only the negative ones: an
                      answer that appears only when it's bad turns its
                      absence into a second, unlabelled signal. */}
                  <Badge
                    label={
                      review.matchedDescription
                        ? 'Matched the description'
                        : "Didn't match the description"
                    }
                    color={review.matchedDescription ? Colors.light.secondary : Colors.light.danger}
                  />
                  {review.text ? <Text style={styles.reviewItemText}>{review.text}</Text> : null}
                </View>
              ))}

              {reviews.length > REVIEW_PREVIEW_COUNT && (
                <TouchableOpacity
                  onPress={() => {
                    Haptics.selectionAsync();
                    setShowAllReviews((shown) => !shown);
                  }}
                  style={styles.showAllButton}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                >
                  <Text style={styles.showAllButtonText}>
                    {showAllReviews ? 'Show fewer reviews' : `Show all ${reviews.length} reviews`}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <Card variant="flat" style={styles.noReviewsCard}>
              <Text style={styles.noReviewsTitle}>No reviews for this item yet</Text>
              {/* The ukay-ukay fallback, and the reason this feature works
                  at all on a catalogue of one-of-a-kind items: a piece with
                  stock 1 sells once and can never gather more than a single
                  review, so an empty reviews section would be the permanent
                  state of much of the catalogue. "Did it match the
                  description?" is the same question about every listing,
                  so the SELLER's answer says something about this item
                  even when nobody has reviewed it. Its own store only: one
                  store's record says nothing about another's goods. */}
              {sellerRating && sellerRating.count > 0 ? (
                <Text style={styles.noReviewsBody}>
                  {`Secondhand pieces are often one of a kind, so most have no reviews of their own. Across ${store.name}'s ${storeReviewCountLabel(sellerRating)}, ${matchedDescriptionSentence(sellerRating).toLowerCase()}`}
                </Text>
              ) : (
                <Text style={styles.noReviewsBody}>
                  Buyers can review an item once their order has been delivered.
                </Text>
              )}
            </Card>
          )}
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

      <SizeGuideModal
        visible={sizeGuideVisible}
        onClose={() => setSizeGuideVisible(false)}
        measurements={product.measurements}
        measurementType={product.measurementType}
        sizes={productSizes}
        selectedSize={selectedSize}
      />
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
  soldByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    marginBottom: 16,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  soldByTextWrap: { flex: 1, paddingVertical: 8 },
  soldByText: { fontSize: 14, color: Colors.light.icon },
  soldByRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  soldByRatingValue: { fontSize: 12, fontWeight: '600', color: Colors.light.text },
  soldByRatingCount: { fontSize: 12, color: Colors.light.icon },
  soldByName: { fontWeight: '600', color: Colors.light.text },
  soldByLink: { fontSize: 13, fontWeight: '600', color: Colors.light.tint },
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
  sizeGuideButton: { alignSelf: 'flex-start', marginTop: 4, marginBottom: 24 },
  sizeGuideButtonText: { fontSize: 14, fontWeight: '600', color: Colors.light.tint },
  quantityContainer: { flexDirection: 'row', alignItems: 'center' },
  quantityButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.light.border, justifyContent: 'center', alignItems: 'center' },
  quantityIconDisabled: { opacity: 0.3 },
  quantityText: { fontSize: 18, fontWeight: '600', marginHorizontal: 24, color: Colors.light.text },
  // Reserves consistent space for "Max stock reached" whether it's shown or
  // not, replacing the old negative-margin hack that pulled the text up
  // under the stepper (fragile — broke the moment the row above resized).
  quantityHelperRow: { minHeight: 24, justifyContent: 'center', marginTop: 8, marginBottom: 24 },
  maxStockText: { color: Colors.light.danger, fontSize: 12 },

  // Reviews. The compact line under the price pulls up into the price's
  // own 24pt bottom margin rather than adding a third gap between the two.
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -16, marginBottom: 20 },
  ratingRowValue: { fontSize: 14, fontWeight: '700', color: Colors.light.text },
  ratingRowCount: { fontSize: 13, color: Colors.light.icon },

  reviewsSkeletonWrap: { marginBottom: 24 },
  reviewsErrorText: { fontSize: 13, color: Colors.light.icon, lineHeight: 19, marginBottom: 24 },

  reviewSummaryCard: { marginBottom: 16 },
  reviewSummaryTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  // Gold, the same accent the stars use — this is the one number on the
  // screen besides the price that a shopper scans for.
  reviewSummaryAverage: { fontSize: 34, fontWeight: '700', color: Colors.light.highlight },
  reviewSummaryTextWrap: { flex: 1, gap: 4 },
  reviewSummaryCount: { fontSize: 12, color: Colors.light.icon },
  reviewSummaryDivider: { height: 1, backgroundColor: Colors.light.border, marginVertical: 12 },
  matchedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  matchedText: { flex: 1, fontSize: 13, color: Colors.light.text, lineHeight: 18 },

  reviewItem: {
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
    gap: 8,
  },
  reviewItemHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reviewItemAuthor: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.light.text },
  reviewItemDate: { fontSize: 11, color: Colors.light.icon },
  reviewItemText: { fontSize: 14, color: Colors.light.text, lineHeight: 20 },

  showAllButton: { alignSelf: 'flex-start', paddingVertical: 12, marginBottom: 12 },
  showAllButtonText: { fontSize: 14, fontWeight: '600', color: Colors.light.tint },

  noReviewsCard: { marginBottom: 24, gap: 6 },
  noReviewsTitle: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  noReviewsBody: { fontSize: 13, color: Colors.light.icon, lineHeight: 19 },
  missingProductState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  shopNowButtonWrap: { marginTop: 20, width: 200 },
  actionContainer: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderTopColor: Colors.light.border, backgroundColor: Colors.light.background, gap: 12 },
});
