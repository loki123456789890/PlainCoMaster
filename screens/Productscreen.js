// screens/Productscreen.js — one product
//
// In the approved product-details preview's design: a tall photo that
// drifts and zooms as the page scrolls, under a sheet with the category,
// name and price, who sells it, the color, size (with the size guide and a
// fit line for the chosen size), quantity, description and reviews. The
// header floats over the photo and turns solid, with the product's name,
// once the photo has scrolled away. Adding to the cart flies the photo into
// the cart button and brings up a short "Added to cart" panel instead of a
// dialog. Everything shown is the product's live data.
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  AccessibilityInfo,
  useWindowDimensions,
} from 'react-native';
import { showAppAlert } from '../utils/appAlert';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  useAnimatedRef,
  useAnimatedReaction,
  withTiming,
  withSequence,
  interpolate,
  Extrapolation,
  Easing,
  runOnJS,
  useReducedMotion,
  FadeIn,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Path, Circle } from 'react-native-svg';

import { onSnapshot } from 'firebase/firestore';

import { useFavorites } from '../context/FavoritesContext';
import { useCart } from '../context/CartContext';
import { useProducts } from '../context/ProductContext';
import { useStores, useStoreRatings, storeReviewCountLabel } from '../context/StoreContext';
import { auth } from '../firebaseConfig';
import { COLOR_PALETTE, DEFAULT_COLORS, DEFAULT_SIZES } from '../constants/productOptions';
import { Colors } from '../constants/theme';
import SkeletonBlock from '../components/ui/Skeleton';
import ProductImage from '../components/ui/ProductImage';
import StarRating from '../components/ui/StarRating';
import Avatar from '../components/ui/Avatar';
import Reveal from '../components/shop/Reveal';
import StoreLogo from '../components/shop/StoreLogo';
import SizeGuideSheet, { measuredFields, measurementUnit } from '../components/shop/SizeGuideSheet';
import { TopBar, BigEmpty } from '../components/shop/TabScreen';
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

const INK = Colors.light.text;
const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const CREAM = Colors.light.background;
const MUTED = Colors.light.icon;
const LINE = '#E4DCD1';
const CARD_LINE = '#EEE7DD';
const PRICE = '#8C6D0C';
const ERR = '#B42318';

// How many reviews render before the "Show all" toggle appears. Three is
// enough to read the room without turning a product page into a feed.
const REVIEW_PREVIEW_COUNT = 3;

// How long the "Added to cart" panel stays up.
const ADDED_MS = 4000;

const formatReviewDate = (date) =>
  date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

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

// The landing cards' icons, small: a tag for ukay-ukay, a hanger for
// ready-to-wear.
function TypeIcon({ ukay, color }) {
  const stroke = { stroke: color, strokeWidth: 3, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <Svg width={13} height={13} viewBox="0 0 40 40">
      {ukay ? (
        <>
          <Path d="M20 5 L30 14 V33 Q30 35 28 35 H12 Q10 35 10 33 V14 Z" {...stroke} />
          <Circle cx={20} cy={14} r={2.6} {...stroke} />
        </>
      ) : (
        <>
          <Path d="M20 15 V13 C20 11 23.5 10.5 23.5 8 C23.5 6 22 5 20 5 C18 5 16.6 6.2 16.5 7.6" {...stroke} />
          <Path d="M20 15 L5 28 H35 Z" {...stroke} />
        </>
      )}
    </Svg>
  );
}

// A round button floating over the photo. Its cream backing fades out as
// the header turns solid behind it.
function FloatButton({ solid, children, style, ...props }) {
  const backing = useAnimatedStyle(() => ({ opacity: 1 - solid.value }));
  return (
    <Pressable style={({ pressed }) => [styles.floatButton, pressed && { transform: [{ scale: 0.9 }] }, style]} hitSlop={4} {...props}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.floatBacking, backing]} />
      {children}
    </Pressable>
  );
}

export default function ProductScreen({ navigation, route }) {
  // What the navigation carried: a snapshot of the product taken when the
  // customer tapped it. The page reads the live product instead, so stock,
  // price and availability are never frozen at that moment — on a catalog
  // where much of the stock is one-of-a-kind ukay-ukay, a piece selling out
  // while someone looks at it is the ordinary case rather than an edge one.
  const routeProduct = route.params?.product;
  const { toggleFavorite, isFavorite } = useFavorites();
  const { addToCart, cartCount } = useCart();
  // ProductContext already holds a live listener on the whole collection,
  // so reading through it costs no extra listener and no extra read.
  const { products, loading: productsLoading } = useProducts();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  const liveProduct = routeProduct?.id ? products.find((p) => p.id === routeProduct.id) : undefined;

  // "Not in the list" and "the list hasn't arrived" are different answers,
  // and only one of them means the product is gone. Gated on a signed-in
  // user because firestore.rules requires auth to read /products, so a
  // guest's catalogue is empty rather than missing this product.
  const isRemoved = Boolean(routeProduct?.id) && Boolean(auth.currentUser) && !productsLoading && !liveProduct;

  const product = liveProduct || routeProduct;
  const { getStore } = useStores();
  const store = getStore(product?.storeId);
  // The seller's rating, from the store's own verified-purchase reviews.
  const sellerRating = useStoreRatings(store ? [store.id] : [])[store?.id];

  // Legacy fallback: products saved before per-product colors/sizes
  // existed have no such array on their doc (or an admin left it empty).
  const productColors = product?.colors && product.colors.length > 0 ? product.colors : DEFAULT_COLORS;
  const productSizes = product?.sizes && product.sizes.length > 0 ? product.sizes : DEFAULT_SIZES;
  const onlySize = productSizes.length === 1 ? productSizes[0] : null;

  // The first color is chosen for the customer, as the preview shows. A
  // size is not, unless there is only one: a size picked on someone's
  // behalf is how a wrong-size order gets placed without anyone deciding
  // on it.
  const [selectedColor, setSelectedColor] = useState(productColors[0]);
  const [selectedSize, setSelectedSize] = useState(onlySize);
  const [quantity, setQuantity] = useState(1);
  const [isFavoriteState, setIsFavoriteState] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [added, setAdded] = useState(null); // { text } while the panel is up
  const [needSize, setNeedSize] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [sizeGuideVisible, setSizeGuideVisible] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsFailed, setReviewsFailed] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);
  // While the photo flies to the cart, the badge keeps the count it had so
  // it can tick up when the photo lands rather than before it leaves.
  const [heldCount, setHeldCount] = useState(null);
  const [flying, setFlying] = useState(false);

  const productName = product?.name || 'Product';
  const productPrice = product?.price || '0.00';
  const unitPrice = parsePrice(productPrice);
  const productImage = product?.imageUrl || product?.image || 'https://via.placeholder.com/400';
  const productId = product?.id || 'unknown';
  const isUkay = product?.type === 'ukay-ukay';

  // A missing/non-numeric stock value must NOT be treated the same as a
  // confirmed zero (SRS 2.2/5a only fires on an actual 0) — unrecorded
  // stock is treated as unlimited.
  const parsedStockValue = parseInt(product?.stock, 10);
  const hasKnownStock = !Number.isNaN(parsedStockValue);
  const isOutOfStock = hasKnownStock && parsedStockValue === 0;
  const maxQuantity = hasKnownStock ? parsedStockValue : Infinity;
  const atMaxQuantity = hasKnownStock && quantity >= maxQuantity;
  const stockText = !hasKnownStock
    ? null
    : isOutOfStock
    ? 'Sold out'
    : isUkay && parsedStockValue === 1
    ? 'One of a kind'
    : parsedStockValue < 10
    ? `Only ${parsedStockValue} left`
    : `${parsedStockValue} in stock`;

  const hasDescription = Boolean(product?.description && product.description.trim().length > 0);

  // The size guide only earns its link when the store recorded something.
  const hasMeasurements = Boolean(
    product?.measurements &&
      Object.values(product.measurements).some(
        (entry) => entry && Object.values(entry).some((value) => typeof value === 'string' && value.trim() !== '')
      )
  );
  const fit = selectedSize ? measuredFields(product?.measurements, selectedSize) : [];
  const unit = measurementUnit(product?.measurementType);

  const reviewSummary = summarizeReviews(reviews);
  const visibleReviewList = showAllReviews ? reviews : reviews.slice(0, REVIEW_PREVIEW_COUNT);

  useEffect(() => {
    if (product?.id) setIsFavoriteState(isFavorite(product.id));
  }, [product, isFavorite]);

  // A seller can change the options while the page is open. A selection
  // the product no longer offers falls back to one it does (or, for size,
  // back to unchosen), rather than letting a cart line be built from it.
  useEffect(() => {
    if (!productColors.includes(selectedColor)) setSelectedColor(productColors[0]);
  }, [productColors, selectedColor]);

  useEffect(() => {
    if (selectedSize && !productSizes.includes(selectedSize)) setSelectedSize(onlySize);
    else if (!selectedSize && onlySize) setSelectedSize(onlySize);
  }, [productSizes, selectedSize, onlySize]);

  // Quantity is clamped, not reset, when someone else buys some of the
  // stock in the meantime: the customer asked for as many as they can
  // still have.
  useEffect(() => {
    if (hasKnownStock && parsedStockValue > 0 && quantity > parsedStockValue) setQuantity(parsedStockValue);
  }, [hasKnownStock, parsedStockValue, quantity]);

  // This product's reviews, live. Gated on a signed-in user because
  // firestore.rules requires auth to read /reviews.
  useEffect(() => {
    if (!product?.id || !auth.currentUser) {
      setReviewsLoading(false);
      return undefined;
    }
    setReviewsLoading(true);
    const unsubscribe = onSnapshot(
      productReviewsQuery(product.id),
      (snapshot) => {
        // Hidden reviews are filtered here rather than in the query; see
        // utils/reviews.js.
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

  // ---- scrolling: the photo drifts and zooms, the header turns solid
  const heroHeight = Math.min(440, Math.round(width * 1.13));
  const scrollRef = useAnimatedRef();
  const scrollY = useSharedValue(0);
  const solid = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  useAnimatedReaction(
    () => scrollY.value > heroHeight - 80,
    (now, before) => {
      if (now !== before) solid.value = withTiming(now ? 1 : 0, { duration: 250 });
    }
  );
  const heroStyle = useAnimatedStyle(() => {
    const y = scrollY.value;
    if (reduceMotion) return {};
    return y > 0
      ? { transform: [{ translateY: y * 0.4 }, { scale: 1 + y / 1600 }] }
      : { transform: [{ translateY: y / 2 }, { scale: 1 - y / 500 }] };
  });
  const barStyle = useAnimatedStyle(() => ({ opacity: solid.value }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: solid.value,
    transform: [{ translateY: interpolate(solid.value, [0, 1], [6, 0], Extrapolation.CLAMP) }],
  }));

  // ---- favorite heart and cart badge
  const heartScale = useSharedValue(1);
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heartScale.value }] }));
  const badgeScale = useSharedValue(1);
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badgeScale.value }] }));
  const shownCount = heldCount ?? cartCount;
  const previousCount = useRef(shownCount);
  useEffect(() => {
    if (shownCount > previousCount.current && !reduceMotion) {
      badgeScale.value = withSequence(
        withTiming(1.45, { duration: 200, easing: EASE_OUT_QUINT }),
        withTiming(1, { duration: 300, easing: EASE_OUT_QUART })
      );
    }
    previousCount.current = shownCount;
  }, [shownCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- "please choose a size" shake
  const sizesShake = useSharedValue(0);
  const sizesShakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: sizesShake.value }] }));
  const sizeBlockY = useRef(0);

  const askForSize = () => {
    setNeedSize(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    AccessibilityInfo.announceForAccessibility('Please choose a size first.');
    if (!reduceMotion) {
      const step = (v) => withTiming(v, { duration: 70, easing: Easing.linear });
      sizesShake.value = withSequence(step(-6), step(5), step(-3), step(2), step(0));
    }
    scrollRef.current?.scrollTo({ y: Math.max(0, heroHeight - 28 + sizeBlockY.current - 180), animated: true });
  };

  // ---- the "Added to cart" panel
  const addedTimer = useRef(null);
  const addedBar = useSharedValue(1);
  const addedBarStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: addedBar.value }] }));
  const hideAdded = () => {
    clearTimeout(addedTimer.current);
    setAdded(null);
  };
  useEffect(() => () => clearTimeout(addedTimer.current), []);

  // ---- the photo flying to the cart
  const rootRef = useRef(null);
  const addButtonRef = useRef(null);
  const cartButtonRef = useRef(null);
  const flightProgress = useSharedValue(0);
  const flightPath = useSharedValue(null);
  const flightStyle = useAnimatedStyle(() => {
    const flight = flightPath.value;
    if (!flight) return { opacity: 0 };
    const t = flightProgress.value;
    const arc = 240 * t * (1 - t);
    return {
      opacity: interpolate(t, [0, 0.5, 1], [1, 1, 0.3]),
      transform: [
        { translateX: flight.x0 + (flight.x1 - flight.x0) * t },
        { translateY: flight.y0 + (flight.y1 - flight.y0) * t - arc },
        { scale: interpolate(t, [0, 0.5, 1], [1, 0.8, 0.2]) },
      ],
    };
  });
  const land = () => {
    setFlying(false);
    setHeldCount(null);
  };

  const measure = (ref) =>
    new Promise((resolve) => {
      if (!ref.current?.measureInWindow) return resolve(null);
      ref.current.measureInWindow((x, y, w, h) => resolve({ x, y, w, h }));
    });

  const flyToCart = async () => {
    const [root, from, to] = await Promise.all([measure(rootRef), measure(addButtonRef), measure(cartButtonRef)]);
    if (!root || !from || !to || reduceMotion) {
      land();
      return;
    }
    flightPath.value = {
      x0: from.x - root.x + from.w / 2 - 30,
      y0: from.y - root.y - 40,
      x1: to.x - root.x + to.w / 2 - 30,
      y1: to.y - root.y + to.h / 2 - 30,
    };
    flightProgress.value = 0;
    setFlying(true);
    flightProgress.value = withTiming(1, { duration: 700, easing: Easing.bezier(0.5, 0, 0.3, 1) }, (done) => {
      if (done) runOnJS(land)();
    });
  };

  const handleToggleFavorite = async () => {
    if (!product) return;
    if (!reduceMotion) {
      heartScale.value = withSequence(
        withTiming(0.8, { duration: 130, easing: EASE_OUT_QUINT }),
        withTiming(1.2, { duration: 140, easing: EASE_OUT_QUART }),
        withTiming(1, { duration: 180, easing: EASE_OUT_QUART })
      );
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await toggleFavorite(product);
    if (result.success) {
      setIsFavoriteState(result.isFavorite);
    } else if (result.error === 'not-authenticated') {
      showAppAlert('Login Required', 'Please sign in to save favorites.', [
        { text: 'Login', onPress: () => navigation.navigate('Login') },
        { text: 'Cancel' },
      ]);
    } else {
      showAppAlert('Error', 'Failed to update favorites');
    }
  };

  const handleAddToCart = async () => {
    if (!selectedSize) {
      askForSize();
      return;
    }
    if (isAdding) return;
    setIsAdding(true);
    hideAdded();
    const countBefore = cartCount;
    setHeldCount(countBefore);

    const result = await addToCart({
      productId,
      name: productName,
      price: productPrice,
      image: productImage,
      color: selectedColor,
      size: selectedSize,
      quantity,
    });

    setIsAdding(false);

    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 1800);
      flyToCart();
      const text = `${selectedColor} · ${selectedSize} · Qty ${quantity}`;
      setAdded({ text });
      AccessibilityInfo.announceForAccessibility(`Added to cart. ${text}`);
      addedBar.value = 1;
      if (!reduceMotion) addedBar.value = withTiming(0, { duration: ADDED_MS, easing: Easing.linear });
      clearTimeout(addedTimer.current);
      addedTimer.current = setTimeout(() => setAdded(null), ADDED_MS);
      return;
    }

    setHeldCount(null);
    if (result.error === 'not-authenticated') {
      showAppAlert('Login Required', 'Please sign in to add items to your cart.', [
        { text: 'Login', onPress: () => navigation.navigate('Login') },
        { text: 'Cancel' },
      ]);
    } else {
      console.error('Error adding to cart:', result.error);
      showAppAlert('Error', 'Could not save item to cart. Please try again.');
    }
  };

  const handleBuyNow = () => {
    if (!selectedSize) {
      askForSize();
      return;
    }
    hideAdded();
    navigation.navigate('Checkout', {
      orderItems: [{ ...product, selectedColor, selectedSize, quantity, image: productImage }],
    });
  };

  const handleSelectColor = (color) => {
    if (color === selectedColor) return;
    Haptics.selectionAsync();
    setSelectedColor(color);
  };

  const handleSelectSize = (size) => {
    setNeedSize(false);
    if (size === selectedSize) return;
    Haptics.selectionAsync();
    setSelectedSize(size);
  };

  // Two ways to have nothing to show: params that arrived without a
  // product, and a product the seller deleted while this page was open.
  if (!product || isRemoved) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <TopBar title="Product" onBack={() => navigation.goBack()} />
        <BigEmpty
          icon="alert-circle-outline"
          title="Product unavailable"
          text="This item may have been removed or the link is out of date."
          actionLabel="Back to Shop"
          onAction={() => navigation.navigate('Shop')}
        />
      </View>
    );
  }

  const barBottom = Math.max(insets.bottom, 12) + 10;
  const barHeight = 12 + 54 + barBottom;
  const total = unitPrice * quantity;

  return (
    <View style={styles.container} ref={rootRef} collapsable={false}>
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: barHeight + 24 }}
      >
        {/* Photo */}
        <View style={[styles.hero, { height: heroHeight }]}>
          <Animated.View style={[StyleSheet.absoluteFill, heroStyle, { transformOrigin: 'top' }]}>
            {!imageLoaded && !imageFailed && <SkeletonBlock style={StyleSheet.absoluteFill} />}
            {imageFailed ? (
              <View style={styles.imageFallback}>
                <Ionicons name="image-outline" size={40} color={MUTED} />
                <Text style={styles.imageFallbackText}>Photo unavailable</Text>
              </View>
            ) : (
              <ProductImage
                uri={productImage}
                style={StyleSheet.absoluteFill}
                onLoad={() => setImageLoaded(true)}
                onError={() => setImageFailed(true)}
                accessibilityLabel={`Photo of ${productName}`}
              />
            )}
          </Animated.View>
          {isOutOfStock ? (
            <View style={[styles.soldOutTag, { top: insets.top + 64 }]}>
              <Text style={styles.soldOutTagText}>Sold out</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.sheet}>
          <Reveal delay={60}>
            <View style={[styles.chip, isUkay && styles.chipUkay]}>
              <TypeIcon ukay={isUkay} color={isUkay ? MOSS : CLAY} />
              <Text style={[styles.chipText, isUkay && { color: MOSS }]}>{isUkay ? 'Ukay-Ukay' : 'Ready-to-Wear'}</Text>
            </View>
          </Reveal>

          <Reveal delay={110} style={styles.titleRow}>
            <Text style={styles.name} accessibilityRole="header">
              {productName}
            </Text>
            <Text style={styles.bigPrice}>₱{unitPrice.toFixed(2)}</Text>
          </Reveal>

          {/* The rating sits with the price, where the decision is made.
              No stars at all until there is a review: an empty row of
              stars reads as a zero rating rather than as no ratings. */}
          <Reveal delay={150} style={styles.ratingLine}>
            {reviewSummary.count > 0 ? (
              <>
                <StarRating rating={reviewSummary.average} size={14} label={productName} />
                <Text style={styles.ratingValue}>{formatAverage(reviewSummary.average)}</Text>
                <Text style={styles.ratingCount}>({reviewCountLabel(reviewSummary.count)})</Text>
              </>
            ) : (
              <Text style={styles.ratingCount}>{reviewsLoading ? ' ' : 'No reviews yet'}</Text>
            )}
          </Reveal>

          {/* Who sells it. A multi-store cart checks out as one order per
              store, so the shopper should know the store before buying. */}
          {store ? (
            <Reveal delay={200}>
              <Pressable
                style={({ pressed }) => [styles.store, pressed && { transform: [{ scale: 0.98 }] }]}
                onPress={() => navigation.push('Shop', { storeId: store.id })}
                accessibilityRole="button"
                accessibilityLabel={`Sold by ${store.name}. View store`}
              >
                <StoreLogo uri={store.logoUrl} size={42} radius={12} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.storeSmall}>Sold by</Text>
                  <Text style={styles.storeName} numberOfLines={1}>
                    {store.name}
                  </Text>
                  {sellerRating && sellerRating.count > 0 ? (
                    <View style={styles.storeRating}>
                      <Ionicons name="star" size={11} color={CLAY} />
                      <Text style={styles.storeSmall}>
                        {formatAverage(sellerRating.average)} ({storeReviewCountLabel(sellerRating)})
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.storeGo}>View store</Text>
                <Ionicons name="chevron-forward" size={15} color={CLAY} style={{ marginLeft: -4 }} />
              </Pressable>
            </Reveal>
          ) : null}

          {/* Color */}
          <Reveal delay={250} style={styles.block}>
            <View style={styles.blockHead}>
              <Text style={styles.blockTitle}>Color</Text>
              <Text style={styles.blockMeta}>{selectedColor}</Text>
            </View>
            <View style={styles.swatches}>
              {productColors.map((color) => {
                const selected = selectedColor === color;
                return (
                  <Pressable
                    key={color}
                    onPress={() => handleSelectColor(color)}
                    style={[styles.swatchRing, selected && styles.swatchRingOn]}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityLabel={`${color}${selected ? ', selected' : ''}`}
                    accessibilityState={{ selected }}
                  >
                    <View style={[styles.swatch, { backgroundColor: getColorHex(color) }]} />
                  </Pressable>
                );
              })}
            </View>
          </Reveal>

          {/* Size */}
          <View onLayout={(e) => (sizeBlockY.current = e.nativeEvent.layout.y)}>
          <Reveal delay={300} style={styles.block}>
            <View style={styles.blockHead}>
              <Text style={styles.blockTitle}>Size</Text>
              {hasMeasurements ? (
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSizeGuideVisible(true);
                  }}
                  style={styles.link}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Open the size guide"
                >
                  <MaterialCommunityIcons name="ruler" size={16} color={CLAY} />
                  <Text style={styles.linkText}>Size guide</Text>
                </Pressable>
              ) : null}
            </View>
            <Animated.View style={[styles.sizes, sizesShakeStyle]}>
              {productSizes.map((size) => {
                const selected = selectedSize === size;
                return (
                  <Pressable
                    key={size}
                    onPress={() => handleSelectSize(size)}
                    style={({ pressed }) => [
                      styles.size,
                      needSize && styles.sizeNeed,
                      selected && styles.sizeOn,
                      pressed && { transform: [{ scale: 0.94 }] },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Size ${size}`}
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.sizeText, selected && { color: CREAM }]}>{size}</Text>
                  </Pressable>
                );
              })}
            </Animated.View>
            {needSize ? <Text style={styles.needText}>Please choose a size first.</Text> : null}
            {fit.length > 0 ? (
              <Animated.View
                key={selectedSize}
                entering={reduceMotion ? undefined : FadeIn.duration(300).easing(EASE_OUT_QUINT)}
                style={styles.fit}
              >
                <MaterialCommunityIcons name="ruler" size={16} color="#37412F" />
                <Text style={styles.fitText}>
                  {`Size ${selectedSize}: `}
                  {fit.map((f, i) => (
                    <Text key={f.key} style={i === 0 ? styles.fitStrong : null}>
                      {`${i ? ' · ' : ''}${f.label.toLowerCase()} ${f.value} ${unit}`}
                    </Text>
                  ))}
                </Text>
              </Animated.View>
            ) : null}
          </Reveal>
          </View>

          {/* Quantity */}
          <Reveal delay={350} style={styles.block}>
            <View style={styles.blockHead}>
              <Text style={styles.blockTitle}>Quantity</Text>
              {stockText ? <Text style={[styles.blockMeta, isOutOfStock && { color: ERR }]}>{stockText}</Text> : null}
            </View>
            <View style={styles.qty}>
              <Pressable
                style={styles.qtyButton}
                onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                accessibilityRole="button"
                accessibilityLabel="Decrease quantity"
                accessibilityState={{ disabled: quantity <= 1 }}
              >
                <Text style={[styles.qtySign, quantity <= 1 && styles.qtySignOff]}>−</Text>
              </Pressable>
              <Text style={styles.qtyValue}>{quantity}</Text>
              <Pressable
                style={styles.qtyButton}
                onPress={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                disabled={atMaxQuantity || isOutOfStock}
                accessibilityRole="button"
                accessibilityLabel="Increase quantity"
                accessibilityState={{ disabled: atMaxQuantity || isOutOfStock }}
              >
                <Text style={[styles.qtySign, (atMaxQuantity || isOutOfStock) && styles.qtySignOff]}>+</Text>
              </Pressable>
            </View>
          </Reveal>

          {hasDescription ? (
            <Reveal delay={400} style={styles.block}>
              <Text style={[styles.blockTitle, { marginBottom: 10 }]}>Description</Text>
              <Text style={styles.desc}>{product.description}</Text>
            </Reveal>
          ) : null}

          {/* Reviews, only from people whose order containing this item
              reached 'delivered' — enforced by firestore.rules. */}
          <Reveal delay={450} style={styles.block}>
            <Text style={[styles.blockTitle, { marginBottom: 10 }]}>Reviews</Text>
            {reviewsLoading ? (
              <View>
                <SkeletonBlock style={{ width: '50%', height: 16, borderRadius: 8, marginBottom: 10 }} />
                <SkeletonBlock style={{ width: '85%', height: 13, borderRadius: 8 }} />
              </View>
            ) : reviewsFailed ? (
              <Text style={styles.reviewsError}>
                {"Reviews couldn't be loaded right now. Everything else on this page is up to date."}
              </Text>
            ) : reviewSummary.count > 0 ? (
              <>
                <View style={styles.summary}>
                  <View style={styles.summaryTop}>
                    <Text style={styles.summaryAverage}>{formatAverage(reviewSummary.average)}</Text>
                    <View style={{ flex: 1, gap: 4 }}>
                      <StarRating rating={reviewSummary.average} size={16} label={productName} />
                      <Text style={styles.summaryCount}>{reviewCountLabel(reviewSummary.count)} from verified buyers</Text>
                    </View>
                  </View>
                  <View style={styles.matched}>
                    <Ionicons name="checkmark-circle-outline" size={16} color={MOSS} />
                    <Text style={styles.matchedText}>{matchedDescriptionSentence(reviewSummary)}</Text>
                  </View>
                </View>

                {visibleReviewList.map((review) => (
                  <View
                    key={review.id}
                    style={styles.review}
                    accessible
                    accessibilityLabel={`${review.rating} stars from ${review.userName}. ${
                      review.matchedDescription ? 'Matched the description.' : "Didn't match the description."
                    } ${review.text}`}
                  >
                    <View style={styles.reviewHead}>
                      <Avatar uri={review.userPhotoUrl} size={28} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reviewAuthor} numberOfLines={1}>
                          {review.userName}
                        </Text>
                        <StarRating rating={review.rating} size={12} />
                      </View>
                      <Text style={styles.reviewDate}>{formatReviewDate(review.createdAt)}</Text>
                    </View>
                    {/* Shown on every review, not only the negative ones:
                        an answer that appears only when it's bad turns its
                        absence into a second, unlabelled signal. */}
                    <View style={[styles.matchPill, !review.matchedDescription && styles.matchPillNo]}>
                      <Ionicons
                        name={review.matchedDescription ? 'checkmark' : 'close'}
                        size={12}
                        color={review.matchedDescription ? MOSS : ERR}
                      />
                      <Text style={[styles.matchPillText, !review.matchedDescription && { color: ERR }]}>
                        {review.matchedDescription ? 'Matched the description' : "Didn't match the description"}
                      </Text>
                    </View>
                    {review.text ? <Text style={styles.reviewText}>{review.text}</Text> : null}
                  </View>
                ))}

                {reviews.length > REVIEW_PREVIEW_COUNT ? (
                  <Pressable
                    onPress={() => {
                      Haptics.selectionAsync();
                      setShowAllReviews((shown) => !shown);
                    }}
                    style={styles.showAll}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <Text style={styles.linkText}>
                      {showAllReviews ? 'Show fewer reviews' : `Show all ${reviews.length} reviews`}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <View style={styles.noReviews}>
                <Text style={styles.noReviewsTitle}>No reviews for this item yet</Text>
                {/* Secondhand pieces are often one of a kind and can never
                    gather more than a single review, so the seller's own
                    record of matching descriptions stands in. Its own
                    store only. */}
                <Text style={styles.noReviewsBody}>
                  {sellerRating && sellerRating.count > 0
                    ? `Secondhand pieces are often one of a kind, so most have no reviews of their own. Across ${store.name}'s ${storeReviewCountLabel(sellerRating)}, ${matchedDescriptionSentence(sellerRating).toLowerCase()}`
                    : 'Buyers can review an item once their order has been delivered.'}
                </Text>
              </View>
            )}
          </Reveal>
        </View>
      </Animated.ScrollView>

      {/* Header, floating over the photo */}
      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Animated.View style={[StyleSheet.absoluteFill, styles.topSolid, barStyle]} pointerEvents="none" />
        <FloatButton solid={solid} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color={INK} />
        </FloatButton>
        <Animated.Text style={[styles.topTitle, titleStyle]} numberOfLines={1}>
          {productName}
        </Animated.Text>
        <FloatButton
          solid={solid}
          onPress={handleToggleFavorite}
          accessibilityRole="button"
          accessibilityLabel={isFavoriteState ? `Remove ${productName} from favorites` : `Save ${productName} to favorites`}
          accessibilityState={{ selected: isFavoriteState }}
        >
          <Animated.View style={heartStyle}>
            <Ionicons name={isFavoriteState ? 'heart' : 'heart-outline'} size={21} color={isFavoriteState ? CLAY : INK} />
          </Animated.View>
        </FloatButton>
        <View ref={cartButtonRef} collapsable={false}>
          <FloatButton
            solid={solid}
            onPress={() => navigation.navigate('Cart')}
            accessibilityRole="button"
            accessibilityLabel={shownCount > 0 ? `Cart, ${shownCount} items` : 'Cart'}
          >
            <Ionicons name="cart-outline" size={21} color={INK} />
            {shownCount > 0 ? (
              <Animated.View style={[styles.badge, badgeStyle]}>
                <Text style={styles.badgeText}>{shownCount > 99 ? '99+' : shownCount}</Text>
              </Animated.View>
            ) : null}
          </FloatButton>
        </View>
      </View>

      {/* Added to cart */}
      {added ? (
        <Animated.View
          style={[styles.added, { bottom: barHeight + 8 }]}
          entering={reduceMotion ? undefined : FadeIn.duration(400).easing(EASE_OUT_QUINT)}
          accessibilityLiveRegion="polite"
        >
          <ProductImage uri={productImage} style={styles.addedThumb} />
          <View style={{ flex: 1 }}>
            <View style={styles.addedTitleRow}>
              <View style={styles.addedTick}>
                <Ionicons name="checkmark" size={11} color="#fff" />
              </View>
              <Text style={styles.addedTitle}>Added to cart</Text>
            </View>
            <Text style={styles.addedText} numberOfLines={1}>
              {added.text}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              hideAdded();
              navigation.navigate('Cart');
            }}
            style={({ pressed }) => [styles.addedButton, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
          >
            <Text style={styles.addedButtonText}>View cart</Text>
          </Pressable>
          <View style={styles.addedTrack}>
            <Animated.View style={[styles.addedFill, addedBarStyle]} />
          </View>
        </Animated.View>
      ) : null}

      {/* Buy bar */}
      <View style={[styles.buybar, { paddingBottom: barBottom }]}>
        <View ref={addButtonRef} collapsable={false} style={{ flexBasis: '42%' }}>
          <Pressable
            onPress={handleAddToCart}
            disabled={isOutOfStock}
            style={({ pressed }) => [
              styles.button,
              styles.buttonSecondary,
              justAdded && styles.buttonAdded,
              isOutOfStock && { opacity: 0.5 },
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Add to cart"
            accessibilityState={{ disabled: isOutOfStock, busy: isAdding }}
          >
            {isAdding ? (
              <ActivityIndicator color={INK} />
            ) : justAdded ? (
              <View style={styles.buttonRow}>
                <Ionicons name="checkmark" size={17} color="#fff" />
                <Text style={[styles.buttonText, { color: '#fff' }]}>Added</Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>Add to Cart</Text>
            )}
          </Pressable>
        </View>
        <Pressable
          onPress={handleBuyNow}
          disabled={isOutOfStock}
          style={({ pressed }) => [
            styles.button,
            styles.buttonPrimary,
            isOutOfStock && styles.buttonPrimaryOff,
            pressed && { transform: [{ scale: 0.97 }] },
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: isOutOfStock }}
        >
          <Text style={[styles.buttonText, { color: '#fff' }]} numberOfLines={1}>
            {isOutOfStock ? 'Sold out' : `Buy Now · ₱${total.toFixed(2)}`}
          </Text>
        </Pressable>
      </View>

      {flying ? (
        <Animated.View pointerEvents="none" style={[styles.fly, flightStyle]}>
          <ProductImage uri={productImage} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}

      <SizeGuideSheet
        visible={sizeGuideVisible}
        onClose={() => setSizeGuideVisible(false)}
        measurements={product.measurements}
        measurementType={product.measurementType}
        sizes={productSizes}
        selectedSize={selectedSize}
        onChoose={handleSelectSize}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CREAM },

  hero: { overflow: 'hidden', backgroundColor: '#D9DAD6' },
  imageFallback: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: Colors.light.border },
  imageFallbackText: { fontSize: 13, color: MUTED, fontWeight: '600' },
  soldOutTag: { position: 'absolute', left: 16, backgroundColor: INK, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  soldOutTagText: { color: CREAM, fontSize: 12, fontWeight: '600' },

  sheet: {
    marginTop: -28,
    backgroundColor: CREAM,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 22,
    paddingHorizontal: 20,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: '#F6E6DE',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  chipUkay: { backgroundColor: '#E8ECE3' },
  chipText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.66, textTransform: 'uppercase', color: CLAY },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 10, marginBottom: 4 },
  name: { flex: 1, fontSize: 24, fontWeight: '600', letterSpacing: -0.5, lineHeight: 29, color: INK },
  bigPrice: { fontSize: 24, fontWeight: '600', color: PRICE, lineHeight: 29 },
  ratingLine: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 18 },
  ratingValue: { fontSize: 12.5, fontWeight: '600', color: INK },
  ratingCount: { fontSize: 12.5, color: MUTED },

  store: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    marginTop: 16,
    marginBottom: 4,
  },
  storeSmall: { fontSize: 11.5, color: MUTED },
  storeName: { fontSize: 14, fontWeight: '600', color: INK },
  storeRating: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  storeGo: { fontSize: 12.5, fontWeight: '600', color: CLAY },

  block: { paddingTop: 18 },
  blockHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  blockTitle: { fontSize: 14.5, fontWeight: '600', color: INK },
  blockMeta: { fontSize: 12.5, color: MUTED },
  link: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  linkText: { fontSize: 12.5, fontWeight: '600', color: CLAY },

  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  swatchRing: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  swatchRingOn: { borderColor: CLAY },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(28,27,26,0.12)' },

  sizes: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  size: {
    minWidth: 58,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeNeed: { borderColor: ERR },
  sizeOn: { backgroundColor: INK, borderColor: INK },
  sizeText: { fontSize: 15, fontWeight: '600', color: INK },
  needText: { fontSize: 12, color: ERR, marginTop: 8 },
  fit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#EEF0EA',
  },
  fitText: { flex: 1, fontSize: 12, lineHeight: 17, color: '#37412F' },
  fitStrong: { fontWeight: '600' },

  qty: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    height: 46,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: '#fff',
  },
  qtyButton: { width: 46, height: 43, alignItems: 'center', justifyContent: 'center' },
  qtySign: { fontSize: 20, fontWeight: '500', color: INK },
  qtySignOff: { color: '#CFC6BC' },
  qtyValue: { minWidth: 34, textAlign: 'center', fontSize: 15, fontWeight: '600', color: INK },

  desc: { fontSize: 13.5, lineHeight: 22, color: '#453E38' },

  reviewsError: { fontSize: 13, color: MUTED, lineHeight: 19 },
  summary: { padding: 16, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: CARD_LINE, gap: 12, marginBottom: 4 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  summaryAverage: { fontSize: 34, fontWeight: '600', color: PRICE },
  summaryCount: { fontSize: 12, color: MUTED },
  matched: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: CARD_LINE },
  matchedText: { flex: 1, fontSize: 12.5, color: INK, lineHeight: 18 },
  review: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: CARD_LINE, gap: 8 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewAuthor: { fontSize: 13, fontWeight: '600', color: INK },
  reviewDate: { fontSize: 11, color: MUTED },
  matchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#EEF0EA',
  },
  matchPillNo: { backgroundColor: '#FBEDEB' },
  matchPillText: { fontSize: 11, fontWeight: '600', color: MOSS },
  reviewText: { fontSize: 13.5, color: INK, lineHeight: 20 },
  showAll: { alignSelf: 'flex-start', paddingVertical: 12 },
  noReviews: { padding: 16, borderRadius: 18, backgroundColor: '#F3EEE6', gap: 2 },
  noReviewsTitle: { fontSize: 13.5, fontWeight: '600', color: INK },
  noReviewsBody: { fontSize: 12.5, color: MUTED, lineHeight: 19 },

  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topSolid: { backgroundColor: 'rgba(250,247,242,0.97)', borderBottomWidth: 1, borderBottomColor: LINE },
  topTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', color: INK },
  floatButton: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  floatBacking: { borderRadius: 21, backgroundColor: 'rgba(250,247,242,0.9)' },
  badge: {
    position: 'absolute',
    top: -2,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: CLAY,
    borderWidth: 2,
    borderColor: CREAM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '600' },

  added: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 20,
    backgroundColor: INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
    zIndex: 13,
  },
  addedThumb: { width: 48, height: 48, borderRadius: 12 },
  addedTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  addedTick: { width: 18, height: 18, borderRadius: 9, backgroundColor: MOSS, alignItems: 'center', justifyContent: 'center' },
  addedTitle: { fontSize: 13.5, fontWeight: '600', color: CREAM },
  addedText: { fontSize: 11.5, color: '#BDB3A9', marginTop: 2 },
  addedButton: { height: 38, paddingHorizontal: 14, borderRadius: 12, backgroundColor: CREAM, justifyContent: 'center' },
  addedButtonText: { fontSize: 12.5, fontWeight: '600', color: INK },
  addedTrack: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 5,
    height: 2,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(250,247,242,0.12)',
  },
  addedFill: { flex: 1, backgroundColor: 'rgba(250,247,242,0.5)', transformOrigin: 'left' },

  buybar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(250,247,242,0.97)',
    borderTopWidth: 1,
    borderTopColor: LINE,
    zIndex: 12,
  },
  button: { height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  buttonSecondary: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: LINE },
  buttonAdded: { backgroundColor: MOSS, borderColor: MOSS },
  buttonPrimary: { flex: 1, backgroundColor: CLAY },
  buttonPrimaryOff: { backgroundColor: '#E3C3B6' },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  buttonText: { fontSize: 15.5, fontWeight: '600', color: INK },

  fly: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 60,
    height: 60,
    borderRadius: 14,
    overflow: 'hidden',
    zIndex: 50,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
});
