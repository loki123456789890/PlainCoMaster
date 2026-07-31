// screens/HomeScreen.js
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ImageBackground,
  ScrollView,
  Platform,
} from 'react-native';
import { showAppAlert } from '../utils/appAlert';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  useReducedMotion,
  FadeIn,
  FadeInDown,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useProducts } from '../context/ProductContext';
import { useFavorites } from '../context/FavoritesContext';
import { useCart } from '../context/CartContext';
import { auth, db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { Colors, Spacing, Radius, Shadow } from '../constants/theme';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import SkeletonBlock from '../components/ui/Skeleton';
import { EASE_OUT_QUINT, EASE_OUT_QUART } from '../constants/motion';

// Favorite heart: generic press-dip plus a distinct settle-pulse on toggle,
// since favoriting is a state change and earns motion beyond generic press
// feedback. Three explicit ease-out keyframes, not spring physics — no
// uncontrolled overshoot/wobble.
function FavoriteButton({ favorited, onToggle, accessibilityLabel }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    if (!reduceMotion) {
      scale.value = withSequence(
        withTiming(0.85, { duration: 80, easing: EASE_OUT_QUINT }),
        withTiming(1.15, { duration: 120, easing: EASE_OUT_QUART }),
        withTiming(1, { duration: 120, easing: EASE_OUT_QUART })
      );
    }
    onToggle();
  };

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: favorited }}
      android_ripple={{ color: 'rgba(255,255,255,0.4)', radius: 22 }}
    >
      <Animated.View style={[styles.favoriteBtn, animatedStyle]}>
        <Ionicons
          name={favorited ? 'heart' : 'heart-outline'}
          size={18}
          color={favorited ? Colors.light.danger : '#fff'}
        />
      </Animated.View>
    </Pressable>
  );
}

// Fades a remote image in over its existing placeholder background once
// decoded, instead of popping in abruptly. Falls back to no animation
// (instant) under Reduce Motion.
function FadingImage({ style, ...rest }) {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const handleLoad = () => {
    opacity.value = reduceMotion ? 1 : withTiming(1, { duration: 220, easing: EASE_OUT_QUART });
  };
  return <Animated.Image style={[style, animatedStyle]} onLoad={handleLoad} {...rest} />;
}

// Loading placeholder shaped exactly like the real Featured Picks row, so
// there's zero layout shift when the live data swaps in.
function FeaturedPicksSkeleton() {
  return (
    <View style={styles.skeletonRow}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.productCard}>
          <SkeletonBlock style={styles.productImageWrapper} />
          <SkeletonBlock style={styles.skeletonLine} />
          <SkeletonBlock style={[styles.skeletonLine, styles.skeletonLineShort]} />
        </View>
      ))}
    </View>
  );
}

// The hero photo cross-fades in on load (over the canvas-colored background
// that's already there while it decodes); the CTA gets the same shared
// press feedback as every other button on the screen.
function HeroImage({ navigation, reduceMotion }) {
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const handleLoad = () => {
    opacity.value = reduceMotion ? 1 : withTiming(1, { duration: 300, easing: EASE_OUT_QUART });
  };

  return (
    <Animated.View style={animatedStyle}>
      <ImageBackground
        source={{
          uri: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?q=80&w=735&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
        }}
        style={styles.hero}
        resizeMode="cover"
        onLoad={handleLoad}
      >
        <View style={styles.heroOverlay}>
          <Text style={styles.title}>Looking for New{'\n'}Clothes in Minutes?</Text>
          <AnimatedPressable
            style={styles.button}
            onPress={() => navigation.navigate('Shop')}
            rippleColor="rgba(255,255,255,0.25)"
          >
            <Text style={styles.buttonText}>Start Shopping</Text>
          </AnimatedPressable>
        </View>
      </ImageBackground>
    </Animated.View>
  );
}

const getTimeGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

export default function HomeScreen({ navigation }) {
  const { products, loading, error, retryFetchProducts } = useProducts();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { cartCount } = useCart();
  const [firstName, setFirstName] = React.useState('');
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    const fetchUserName = async () => {
      try {
        const currentUser = auth.currentUser;
        if (!currentUser) return;

        const userDocRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userDocRef);

        if (userSnap.exists()) {
          const userData = userSnap.data();
          // Adjust these keys if your Signupscreen.js saves the name under a different field
          const fullName = userData.name || userData.fullName || userData.firstName || '';
          const first = fullName.trim().split(' ')[0];
          setFirstName(first || '');
        }
      } catch (error) {
        console.error('Error fetching user name:', error);
      }
    };

    fetchUserName();
  }, []);

  // Take the most recently added products as "Featured Picks"
  // (falls back to first 6 if no createdAt field, e.g. seeded defaults)
  const featuredProducts = [...products]
    .sort((a, b) => {
      if (!a.createdAt || !b.createdAt) return 0;
      return new Date(b.createdAt) - new Date(a.createdAt);
    })
    .slice(0, 6);

  const ukayCount = products.filter((p) => p.type === 'ukay-ukay').length;

  const goToCategory = (type) => {
    navigation.navigate('Shop', { filterType: type });
  };

  // Guests can browse Featured Picks, but favoriting needs an account —
  // same guard pattern as ProductScreen's heart icon, since the Context
  // no longer alerts internally (that messaging lives at the screen level
  // to avoid the double-alert bug we hit on Product).
  const handleToggleFavorite = (product) => {
    if (!auth.currentUser) {
      showAppAlert('Login Required', 'Please sign in to save favorites.', [
        { text: 'Login', onPress: () => navigation.navigate('Login') },
        { text: 'Cancel' },
      ]);
      return;
    }
    toggleFavorite(product);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Greeting */}
        {firstName ? (
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(200)}
            style={styles.greetingWrap}
          >
            <Text style={styles.greetingText}>
              {getTimeGreeting()}, {firstName} 👋
            </Text>
          </Animated.View>
        ) : null}

        {/* Hero — the screen's one signature entrance moment: the photo
            cross-fades in once decoded rather than popping onto a 340pt
            block. No further page-load choreography beyond this. */}
        <HeroImage navigation={navigation} reduceMotion={reduceMotion} />

        {/* Sustainability Strip */}
        {ukayCount > 0 && (
          <View style={styles.ecoStrip}>
            <Text style={styles.ecoEmoji}>♻️</Text>
            <Text style={styles.ecoText}>
              <Text style={styles.ecoNumber}>{ukayCount} </Text>
              pre-loved {ukayCount === 1 ? 'piece' : 'pieces'} getting a second life right now
            </Text>
          </View>
        )}

        {/* Category Cards — navigation triggers, not toggles, so press
            feedback is the only motion here (no persistent "selected"
            state exists to animate). */}
        <View style={styles.categoryRow}>
          <AnimatedPressable
            style={[styles.categoryCard, { backgroundColor: Colors.light.secondary }]}
            onPress={() => goToCategory('ukay-ukay')}
            rippleColor="rgba(255,255,255,0.25)"
          >
            <MaterialCommunityIcons name="recycle" size={28} color="#fff" />
            <Text style={styles.categoryText}>Ukay-Ukay</Text>
            <Text style={styles.categorySubtext}>Thrifted finds</Text>
          </AnimatedPressable>

          <AnimatedPressable
            style={[styles.categoryCard, { backgroundColor: Colors.light.tint }]}
            onPress={() => goToCategory('ready-to-wear')}
            rippleColor="rgba(255,255,255,0.25)"
          >
            <Ionicons name="shirt-outline" size={28} color="#fff" />
            <Text style={styles.categoryText}>Ready-to-Wear</Text>
            <Text style={styles.categorySubtext}>Brand new</Text>
          </AnimatedPressable>
        </View>

        {/* Featured Picks */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Featured Picks</Text>
          <AnimatedPressable onPress={() => navigation.navigate('Shop')} rippleColor={Colors.light.tint + '20'}>
            <Text style={styles.seeAll}>See all</Text>
          </AnimatedPressable>
        </View>

        {loading ? (
          <FeaturedPicksSkeleton />
        ) : error ? (
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(220)}
            style={styles.errorState}
          >
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load picks"
              subtitle="Check your connection and try again."
            />
            <Button variant="secondary" label="Retry" onPress={retryFetchProducts} />
          </Animated.View>
        ) : featuredProducts.length === 0 ? (
          <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(220)}>
            <EmptyState
              icon="pricetags-outline"
              title="Nothing here just yet"
              subtitle="We're still unpacking — new finds land here first."
            />
          </Animated.View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.featuredRow}
          >
            {featuredProducts.map((product, index) => (
              <Animated.View
                key={product.id}
                entering={reduceMotion ? undefined : FadeInDown.delay(index * 40).duration(220)}
              >
                <AnimatedPressable
                  style={styles.productCard}
                  onPress={() => navigation.navigate('Product', { product })}
                  rippleColor={Colors.light.border}
                >
                  <View style={styles.productImageWrapper}>
                    <FadingImage source={{ uri: product.imageUrl }} style={styles.productImage} />
                    <FavoriteButton
                      favorited={isFavorite(product.id)}
                      onToggle={() => handleToggleFavorite(product)}
                      accessibilityLabel={
                        isFavorite(product.id)
                          ? `Remove ${product.name} from favorites`
                          : `Add ${product.name} to favorites`
                      }
                    />
                  </View>
                  <Text style={styles.productName} numberOfLines={1}>
                    {product.name}
                  </Text>
                  <Text style={styles.productPrice}>₱{product.price}</Text>
                </AnimatedPressable>
              </Animated.View>
            ))}
          </ScrollView>
        )}
      </ScrollView>

      {/* Bottom Navigation */}
      <View style={styles.bottomNav}>
        <AnimatedPressable
          style={styles.navItem}
          rippleColor={Colors.light.border}
          accessibilityRole="tab"
          accessibilityState={{ selected: true }}
          accessibilityLabel="Home, current tab"
        >
          <Ionicons name="home" size={24} color={Colors.light.tint} />
          <Text style={styles.navTextActive}>Home</Text>
        </AnimatedPressable>

        <AnimatedPressable
          style={styles.navItem}
          onPress={() => navigation.navigate('Shop')}
          rippleColor={Colors.light.border}
          accessibilityRole="tab"
          accessibilityLabel="Shop"
        >
          <Ionicons name="search-outline" size={24} color={Colors.light.icon} />
          <Text style={styles.navText}>Shop</Text>
        </AnimatedPressable>

        <AnimatedPressable
          style={styles.navItem}
          onPress={() => navigation.navigate('Cart')}
          rippleColor={Colors.light.border}
          accessibilityRole="tab"
          accessibilityLabel={cartCount > 0 ? `Cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}` : 'Cart'}
        >
          <View style={styles.navIconWrapper}>
            <Ionicons name="cart-outline" size={24} color={Colors.light.icon} />
            {cartCount > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeText}>{cartCount > 99 ? '99+' : cartCount}</Text>
              </View>
            )}
          </View>
          <Text style={styles.navText}>Cart</Text>
        </AnimatedPressable>

        <AnimatedPressable
          style={styles.navItem}
          onPress={() => navigation.navigate('Profile')}
          rippleColor={Colors.light.border}
          accessibilityRole="tab"
          accessibilityLabel="Profile"
        >
          <Ionicons name="person-outline" size={24} color={Colors.light.icon} />
          <Text style={styles.navText}>Profile</Text>
        </AnimatedPressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  greetingWrap: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  greetingText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.light.text,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  hero: {
    width: '100%',
    height: 340,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroOverlay: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 32,
    paddingVertical: 40,
    borderRadius: 20,
    alignItems: 'center',
    marginHorizontal: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
    lineHeight: 34,
    marginBottom: 20,
  },
  button: {
    backgroundColor: Colors.light.tint,
    paddingHorizontal: 36,
    paddingVertical: 14,
    borderRadius: Radius.lg,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  ecoStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.light.secondary + '20',
    marginHorizontal: 20,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: Radius.lg,
  },
  ecoEmoji: {
    fontSize: 20,
    marginRight: 10,
  },
  ecoText: {
    flex: 1,
    fontSize: 13,
    color: Colors.light.secondary,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  ecoNumber: {
    fontWeight: '700',
    fontSize: 14,
  },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: 20,
    gap: 12,
  },
  categoryCard: {
    flex: 1,
    borderRadius: Radius.lg,
    padding: 18,
    minHeight: 100,
    justifyContent: 'center',
  },
  categoryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 8,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  categorySubtext: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 28,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.light.text,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  seeAll: {
    fontSize: 14,
    color: Colors.light.tint,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  featuredRow: {
    paddingHorizontal: 20,
    paddingBottom: 30,
    gap: 14,
  },
  errorState: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 30,
    gap: 12,
  },
  skeletonRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 30,
    gap: 14,
  },
  skeletonLine: {
    marginTop: 8,
    height: 14,
    width: '90%',
    borderRadius: Radius.sm,
  },
  skeletonLineShort: {
    marginTop: 6,
    height: 12,
    width: '50%',
  },
  productCard: {
    width: 140,
  },
  productImageWrapper: {
    width: 140,
    height: 140,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.light.border,
    // Hairline frame so a light/white-background product photo doesn't
    // blend into the canvas behind it — same restrained device premium
    // product photography uses.
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  favoriteBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 14,
    padding: 6,
  },
  productName: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.light.text,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  productPrice: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.light.highlight,
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: Colors.light.background,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  navItem: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  navIconWrapper: {
    position: 'relative',
  },
  cartBadge: {
    position: 'absolute',
    top: -4,
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
  navText: {
    fontSize: 10,
    color: Colors.light.icon,
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  navTextActive: {
    fontSize: 10,
    color: Colors.light.tint,
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
});