// screens/HomeScreen.js
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  Image,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useProducts } from '../context/ProductContext';
import { useFavorites } from '../context/FavoritesContext';
import { useCart } from '../context/CartContext';
import { auth, db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';

const getTimeGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

export default function HomeScreen({ navigation }) {
  const { products, loading } = useProducts();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { cartCount } = useCart();
  const [firstName, setFirstName] = React.useState('');

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
      Alert.alert('Login Required', 'Please sign in to save favorites.', [
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
          <View style={styles.greetingWrap}>
            <Text style={styles.greetingText}>
              {getTimeGreeting()}, {firstName} 👋
            </Text>
          </View>
        ) : null}

        {/* Hero */}
        <ImageBackground
          source={{
            uri: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?q=80&w=735&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
          }}
          style={styles.hero}
          resizeMode="cover"
        >
          <View style={styles.heroOverlay}>
            <Text style={styles.title}>Looking for New{'\n'}Clothes in Minutes?</Text>
            <TouchableOpacity
              style={styles.button}
              onPress={() => navigation.navigate('Shop')}
            >
              <Text style={styles.buttonText}>Start Shopping</Text>
            </TouchableOpacity>
          </View>
        </ImageBackground>

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

        {/* Category Cards */}
        <View style={styles.categoryRow}>
          <TouchableOpacity
            style={[styles.categoryCard, { backgroundColor: '#1C1C1E' }]}
            onPress={() => goToCategory('ukay-ukay')}
          >
            <MaterialCommunityIcons name="recycle" size={28} color="#fff" />
            <Text style={styles.categoryText}>Ukay-Ukay</Text>
            <Text style={styles.categorySubtext}>Thrifted finds</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.categoryCard, { backgroundColor: '#007AFF' }]}
            onPress={() => goToCategory('ready-to-wear')}
          >
            <Ionicons name="shirt-outline" size={28} color="#fff" />
            <Text style={styles.categoryText}>Ready-to-Wear</Text>
            <Text style={styles.categorySubtext}>Brand new</Text>
          </TouchableOpacity>
        </View>

        {/* Featured Picks */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Featured Picks</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Shop')}>
            <Text style={styles.seeAll}>See all</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <Text style={styles.emptyText}>Loading products...</Text>
        ) : featuredProducts.length === 0 ? (
          <Text style={styles.emptyText}>No products yet. Check back soon!</Text>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.featuredRow}
          >
            {featuredProducts.map((product) => (
              <TouchableOpacity
                key={product.id}
                style={styles.productCard}
                onPress={() => navigation.navigate('Product', { product })}
              >
                <View style={styles.productImageWrapper}>
                  <Image source={{ uri: product.imageUrl }} style={styles.productImage} />
                  <TouchableOpacity
                    style={styles.favoriteBtn}
                    onPress={() => handleToggleFavorite(product)}
                  >
                    <Ionicons
                      name={isFavorite(product.id) ? 'heart' : 'heart-outline'}
                      size={18}
                      color={isFavorite(product.id) ? '#FF3B30' : '#fff'}
                    />
                  </TouchableOpacity>
                </View>
                <Text style={styles.productName} numberOfLines={1}>
                  {product.name}
                </Text>
                <Text style={styles.productPrice}>₱{product.price}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </ScrollView>

      {/* Bottom Navigation */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem}>
          <Ionicons name="home" size={24} color="#007AFF" />
          <Text style={styles.navTextActive}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.navigate('Shop')}
        >
          <Ionicons name="search" size={24} color="#8E8E93" />
          <Text style={styles.navText}>Shop</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.navigate('Cart')}
        >
          <View style={styles.navIconWrapper}>
            <Ionicons name="cart" size={24} color="#8E8E93" />
            {cartCount > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeText}>{cartCount > 99 ? '99+' : cartCount}</Text>
              </View>
            )}
          </View>
          <Text style={styles.navText}>Cart</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.navigate('Profile')}
        >
          <Ionicons name="person" size={24} color="#8E8E93" />
          <Text style={styles.navText}>Profile</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  greetingWrap: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  greetingText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
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
    backgroundColor: '#007AFF',
    paddingHorizontal: 36,
    paddingVertical: 14,
    borderRadius: 14,
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
    backgroundColor: '#EAF7EC',
    marginHorizontal: 20,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
  },
  ecoEmoji: {
    fontSize: 20,
    marginRight: 10,
  },
  ecoText: {
    flex: 1,
    fontSize: 13,
    color: '#256029',
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
    borderRadius: 16,
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
    color: '#1C1C1E',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  seeAll: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  emptyText: {
    textAlign: 'center',
    color: '#8E8E93',
    marginTop: 12,
    marginBottom: 24,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  featuredRow: {
    paddingHorizontal: 20,
    paddingBottom: 30,
    gap: 14,
  },
  productCard: {
    width: 140,
  },
  productImageWrapper: {
    width: 140,
    height: 140,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#F2F2F7',
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
    color: '#1C1C1E',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  productPrice: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#C6C6C8',
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
  navText: {
    fontSize: 10,
    color: '#8E8E93',
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  navTextActive: {
    fontSize: 10,
    color: '#007AFF',
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
});