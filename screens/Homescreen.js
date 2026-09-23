// screens/HomeScreen.js
//
// Home, from the approved home/shop preview: a greeting, a search bar that
// opens Shop, the two category tiles with live counts, and two sideways
// rails — the newest listings and ukay-ukay finds. The tab bar sits under
// it all. Everything shown comes from the live catalogue; nothing here is
// the preview's sample data.
import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Svg, { Path, Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { showAppAlert } from '../utils/appAlert';
import { useProducts } from '../context/ProductContext';
import { useFavorites } from '../context/FavoritesContext';
import { auth, db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { Colors } from '../constants/theme';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import SkeletonBlock from '../components/ui/Skeleton';
import ProductCard from '../components/shop/ProductCard';
import TabBar, { goToTab } from '../components/shop/TabBar';
import Reveal from '../components/shop/Reveal';

const RAIL_CARD_WIDTH = 148;
const RAIL_GAP = 12;
const NEW_ARRIVALS = 6;
const UKAY_FINDS = 10;

const getTimeGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

// "Juan Dela Cruz" → "JC": first and last word.
const initialsOf = (name) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (words[0][0] + last).toUpperCase();
};

// The same drawn marks as Landing's cards: a price tag for ukay-ukay, a
// hanger for ready-to-wear.
function CategoryGlyph({ kind }) {
  const stroke = {
    fill: 'none',
    stroke: Colors.light.background,
    strokeWidth: 2.2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  return (
    <Svg width={34} height={34} viewBox="0 0 40 40">
      {kind === 'ukay' ? (
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

function CategoryTile({ kind, title, caption, onPress, delay }) {
  return (
    <Reveal delay={delay} style={styles.flex}>
      <AnimatedPressable
        style={[styles.tile, { backgroundColor: kind === 'ukay' ? Colors.light.secondary : Colors.light.tint }]}
        onPress={onPress}
        rippleColor="rgba(255,255,255,0.2)"
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${caption}`}
      >
        <View style={styles.tileRing} />
        <CategoryGlyph kind={kind} />
        <View>
          <Text style={styles.tileTitle}>{title}</Text>
          <Text style={styles.tileCaption}>{caption} →</Text>
        </View>
      </AnimatedPressable>
    </Reveal>
  );
}

function SectionHead({ title, caption, onSeeAll, delay }) {
  return (
    <Reveal delay={delay} style={styles.sectionHead}>
      <View style={styles.flex}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.sectionCaption}>{caption}</Text>
      </View>
      <Pressable onPress={onSeeAll} hitSlop={10} accessibilityRole="link" accessibilityLabel={`See all ${title}`}>
        <Text style={styles.seeAll}>See all</Text>
      </Pressable>
    </Reveal>
  );
}

// Loading placeholder shaped like a rail, so nothing shifts when it fills.
function RailSkeleton() {
  return (
    <View style={styles.railSkeleton}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: RAIL_CARD_WIDTH }}>
          <SkeletonBlock style={styles.skeletonPhoto} />
          <SkeletonBlock style={styles.skeletonLine} />
          <SkeletonBlock style={[styles.skeletonLine, styles.skeletonLineShort]} />
        </View>
      ))}
    </View>
  );
}

function Rail({ products, startDelay, isFavorite, onOpen, onToggleFavorite }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      snapToInterval={RAIL_CARD_WIDTH + RAIL_GAP}
      decelerationRate="fast"
    >
      {products.map((product, i) => (
        <Reveal key={product.id} from="right" delay={startDelay + i * 70}>
          <ProductCard
            style={{ width: RAIL_CARD_WIDTH }}
            product={product}
            favorited={isFavorite(product.id)}
            onPress={() => onOpen(product)}
            onToggleFavorite={() => onToggleFavorite(product)}
          />
        </Reveal>
      ))}
    </ScrollView>
  );
}

export default function HomeScreen({ navigation }) {
  const { products, loading, error, retryFetchProducts } = useProducts();
  const { isFavorite, toggleFavorite } = useFavorites();
  const [profile, setProfile] = React.useState({ name: '', photoUrl: null });

  // Refetch on every focus, not just on mount — this is how we pick up a
  // freshly edited name or photo when the user comes back from Profile.
  useFocusEffect(
    React.useCallback(() => {
      let isActive = true;
      const fetchProfile = async () => {
        try {
          const currentUser = auth.currentUser;
          if (!currentUser) return;
          const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
          if (userSnap.exists() && isActive) {
            const data = userSnap.data();
            setProfile({
              name: (data.name || data.fullName || data.firstName || '').trim(),
              photoUrl: data.photoUrl || null,
            });
          }
        } catch (err) {
          console.error('Error fetching user profile:', err);
        }
      };
      fetchProfile();
      return () => {
        isActive = false;
      };
    }, [])
  );

  const firstName = profile.name.split(' ')[0];

  // Newest first: ProductContext's query is already orderBy('createdAt',
  // 'desc'), so `products` arrives in that order.
  const newArrivals = products.slice(0, NEW_ARRIVALS);
  const ukay = products.filter((p) => p.type === 'ukay-ukay');
  const rtwCount = products.filter((p) => p.type === 'ready-to-wear').length;
  const ukayFinds = ukay.slice(0, UKAY_FINDS);

  const ukayCaption = loading || !ukay.length
    ? 'Pre-loved finds'
    : `${ukay.length} pre-loved ${ukay.length === 1 ? 'find' : 'finds'}`;
  const rtwCaption = loading || !rtwCount ? 'New styles' : `${rtwCount} new ${rtwCount === 1 ? 'style' : 'styles'}`;

  const openShop = (params) => goToTab(navigation, 'Shop', params);
  const openProduct = (product) => navigation.navigate('Product', { product });

  // Guests can browse, but favoriting needs an account.
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

  const renderRails = () => {
    if (loading) {
      return (
        <>
          <RailSkeleton />
          <RailSkeleton />
        </>
      );
    }
    if (error) {
      return (
        <View style={styles.message}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't load new arrivals"
            subtitle="Check your connection and try again."
          />
          <Button variant="secondary" label="Retry" onPress={retryFetchProducts} />
        </View>
      );
    }
    if (!products.length) {
      return (
        <View style={styles.message}>
          <EmptyState
            icon="pricetags-outline"
            title="Nothing here just yet"
            subtitle="We're still unpacking — new finds land here first."
          />
        </View>
      );
    }
    return (
      <>
        <Rail
          products={newArrivals}
          startDelay={360}
          isFavorite={isFavorite}
          onOpen={openProduct}
          onToggleFavorite={handleToggleFavorite}
        />
        {ukayFinds.length > 0 ? (
          <>
            <View style={styles.pad}>
              <SectionHead
                title="Ukay finds"
                caption="One of a kind. Once it's gone, it's gone."
                onSeeAll={() => openShop({ filterType: 'ukay-ukay' })}
                delay={420}
              />
            </View>
            <Rail
              products={ukayFinds}
              startDelay={480}
              isFavorite={isFavorite}
              onOpen={openProduct}
              onToggleFavorite={handleToggleFavorite}
            />
          </>
        ) : null}
      </>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={styles.pad}>
          <Reveal delay={40} style={styles.hello}>
            <View style={styles.flex}>
              <Text style={styles.greeting}>{getTimeGreeting()},</Text>
              <Text style={styles.name} numberOfLines={1}>
                {firstName ? `${firstName} 👋` : 'Welcome 👋'}
              </Text>
            </View>
            <Pressable
              onPress={() => goToTab(navigation, 'Profile')}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Profile"
            >
              {profile.photoUrl ? (
                <Image source={{ uri: profile.photoUrl }} style={styles.avatar} contentFit="cover" transition={150} />
              ) : (
                <View style={[styles.avatar, styles.avatarInitials]}>
                  {initialsOf(profile.name) ? (
                    <Text style={styles.avatarText}>{initialsOf(profile.name)}</Text>
                  ) : (
                    <Ionicons name="person" size={20} color={Colors.light.background} />
                  )}
                </View>
              )}
            </Pressable>
          </Reveal>

          {/* Not a real field: it opens Shop with the search already focused. */}
          <Reveal delay={110}>
            <AnimatedPressable
              style={styles.fakeSearch}
              onPress={() => openShop({ focusSearch: true })}
              rippleColor={Colors.light.border}
              accessibilityRole="search"
              accessibilityLabel="Search clothes"
            >
              <Ionicons name="search" size={19} color={Colors.light.icon} />
              <Text style={styles.fakeSearchText}>Search clothes, e.g. &quot;denim&quot;</Text>
            </AnimatedPressable>
          </Reveal>

          <View style={styles.tiles}>
            <CategoryTile
              kind="ukay"
              title="Ukay-Ukay"
              caption={ukayCaption}
              onPress={() => openShop({ filterType: 'ukay-ukay' })}
              delay={180}
            />
            <CategoryTile
              kind="rtw"
              title="Ready-to-Wear"
              caption={rtwCaption}
              onPress={() => openShop({ filterType: 'ready-to-wear' })}
              delay={240}
            />
          </View>

          <SectionHead
            title="New arrivals"
            caption="Just added by our stores"
            onSeeAll={() => openShop({ filterType: 'all' })}
            delay={300}
          />
        </View>

        {renderRails()}
      </ScrollView>

      <TabBar navigation={navigation} current="Home" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  flex: { flex: 1 },
  scroll: { paddingTop: 16, paddingBottom: 24 },
  pad: { paddingHorizontal: 20 },

  hello: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  greeting: { fontSize: 12.5, color: Colors.light.icon },
  name: { fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: Colors.light.text },
  avatar: { width: 42, height: 42, borderRadius: 14, marginLeft: 12 },
  avatarInitials: { backgroundColor: Colors.light.secondary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '600', color: Colors.light.background },

  fakeSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    paddingHorizontal: 14,
    marginBottom: 20,
  },
  fakeSearchText: { fontSize: 14, color: '#8E857B' },

  tiles: { flexDirection: 'row', gap: 12, marginBottom: 26 },
  tile: {
    height: 132,
    borderRadius: 20,
    padding: 14,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  tileRing: {
    position: 'absolute',
    right: -34,
    top: -34,
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1.5,
    borderColor: 'rgba(250,247,242,0.18)',
  },
  tileTitle: { fontSize: 15.5, fontWeight: '600', color: Colors.light.background },
  tileCaption: { fontSize: 11.5, color: 'rgba(250,247,242,0.85)', marginTop: 1 },

  sectionHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontWeight: '600', letterSpacing: -0.2, color: Colors.light.text },
  sectionCaption: { fontSize: 12, color: Colors.light.icon, marginTop: 2 },
  seeAll: { fontSize: 12.5, fontWeight: '600', color: Colors.light.tint, paddingLeft: 12, paddingTop: 4 },

  rail: { paddingHorizontal: 20, paddingBottom: 4, gap: RAIL_GAP, marginBottom: 22 },
  railSkeleton: { flexDirection: 'row', gap: RAIL_GAP, paddingHorizontal: 20, marginBottom: 26 },
  skeletonPhoto: { aspectRatio: 4 / 5, borderRadius: 18 },
  skeletonLine: { height: 12, borderRadius: 6, marginTop: 10, width: '80%' },
  skeletonLineShort: { marginTop: 6, width: '40%' },

  message: { alignItems: 'center', paddingHorizontal: 20, gap: 12 },
});
