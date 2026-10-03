// screens/HomeScreen.js
//
// Home, from the approved home preview: a greeting, where orders are
// delivered to, a search bar that opens Shop, a gallery of a few listings,
// the two category tiles with live counts, the order on its way (if any),
// then the stores, the newest listings, a dark strip of budget finds and a
// staggered grid of ukay-ukay finds, ending in "Browse everything". No
// listing appears in more than one of those last three sections (the
// gallery is a spotlight and may repeat one). The tab bar sits under it
// all. Everything shown comes from the live catalogue; nothing here is
// the preview's sample data.
import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import Animated, { useSharedValue, useAnimatedScrollHandler } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Svg, { Path, Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { showAppAlert } from '../utils/appAlert';
import { useProducts } from '../context/ProductContext';
import { useFavorites } from '../context/FavoritesContext';
import { useStores, useStoreRatings } from '../context/StoreContext';
import { auth, db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { Colors } from '../constants/theme';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import AnimatedPressable from '../components/ui/AnimatedPressable';
import SkeletonBlock from '../components/ui/Skeleton';
import ProductCard, { isJustIn, isSoldOut, JUST_IN_DAYS } from '../components/shop/ProductCard';
import TabBar, { goToTab } from '../components/shop/TabBar';
import Reveal from '../components/shop/Reveal';
import TypingSearch from '../components/home/TypingSearch';
import ActiveOrderCard, { useActiveOrder } from '../components/home/ActiveOrderCard';
import HeroGallery, { pickSlides, HERO_HEIGHT } from '../components/home/HeroGallery';
import StoreRail from '../components/home/StoreRail';
import UkayGrid from '../components/home/UkayGrid';

const RAIL_CARD_WIDTH = 146;
const RAIL_GAP = 12;
const NEW_ARRIVALS = 6;
const JUST_IN_MAX = 12;
const BUDGET_MAX_PRICE = 300;
const BUDGET_ITEMS = 10;
const UKAY_GRID = 6;

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

// "Balamban, Cebu": the town and province of the saved delivery address,
// or whichever of the two is filled in.
const placeOf = (address) =>
  [address?.city, address?.province]
    .map((v) => (v || '').trim())
    .filter(Boolean)
    .join(', ');

// The same drawn marks as Landing's cards: a price tag for ukay-ukay, a
// hanger for ready-to-wear.
function CategoryGlyph({ kind }) {
  const stroke = {
    fill: 'none',
    stroke: Colors.light.background,
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  return (
    <Svg width={26} height={26} viewBox="0 0 40 40">
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
        <View style={styles.flex}>
          {/* Shrinks a little on large text sizes rather than cutting off
              "Ready-to-Wear". */}
          <Text style={styles.tileTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {title}
          </Text>
          <Text style={styles.tileCaption} numberOfLines={1}>
            {caption}
          </Text>
        </View>
      </AnimatedPressable>
    </Reveal>
  );
}

function SectionHead({ title, chip, caption, onSeeAll, delay, onDark }) {
  return (
    <Reveal delay={delay} style={[styles.sectionHead, onDark && styles.sectionHeadInStrip]}>
      <View style={styles.flex}>
        <View style={styles.titleRow}>
          <Text style={[styles.sectionTitle, onDark && styles.onDarkTitle]} accessibilityRole="header">
            {title}
          </Text>
          {chip ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{chip}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.sectionCaption, onDark && styles.onDarkCaption]}>{caption}</Text>
      </View>
      {onSeeAll ? (
        <Pressable onPress={onSeeAll} hitSlop={10} accessibilityRole="link" accessibilityLabel={`See all ${title}`}>
          <Text style={styles.seeAll}>See all</Text>
        </Pressable>
      ) : null}
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

function Rail({ products, startDelay, isFavorite, storeNameOf, onOpen, onToggleFavorite, onDark }) {
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
            storeName={storeNameOf(product)}
            nameLines={1}
            onDark={onDark}
            onPress={() => onOpen(product)}
            onToggleFavorite={() => onToggleFavorite(product)}
          />
        </Reveal>
      ))}
    </ScrollView>
  );
}

function ArrowIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24">
      <Path
        d="M5 12h14M13 6l6 6-6 6"
        fill="none"
        stroke={Colors.light.text}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export default function HomeScreen({ navigation }) {
  const { products, loading, error, retryFetchProducts } = useProducts();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { stores, getStore } = useStores();
  const storeNameOf = React.useCallback((p) => getStore(p.storeId)?.name || '', [getStore]);
  const [profile, setProfile] = React.useState({ name: '', photoUrl: null, place: '' });
  const activeOrder = useActiveOrder();

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
              place: placeOf(data.shippingAddress),
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
  // 'desc'), so `products` arrives in that order. The rail is "Just in"
  // while anything was listed in the last few days — all of those, topped
  // up with the next newest so it never looks bare (each card carries its
  // own "Just in" note, so the older ones don't pass for new). Otherwise
  // it's plain "New arrivals".
  const justInCount = products.filter((p) => isJustIn(p) && !isSoldOut(p)).length;
  const newArrivals = products.slice(0, Math.max(NEW_ARRIVALS, Math.min(justInCount, JUST_IN_MAX)));
  const arrivalsTitle = justInCount ? 'Just in' : 'New arrivals';
  const arrivalsCaption = justInCount
    ? `${justInCount} new in the last ${JUST_IN_DAYS} days`
    : 'The latest from our stores';
  const heroSlides = React.useMemo(
    () => pickSlides(products, storeNameOf),
    [products, storeNameOf]
  );
  const ukay = products.filter((p) => p.type === 'ukay-ukay');
  const rtwCount = products.filter((p) => p.type === 'ready-to-wear').length;

  // Each section below New arrivals skips what's already been shown above
  // it, and leaves out sold-out pieces.
  const shown = new Set(newArrivals.map((p) => p.id));
  const budget = products
    .filter((p) => !shown.has(p.id) && !isSoldOut(p) && Number(p.price) <= BUDGET_MAX_PRICE)
    .slice(0, BUDGET_ITEMS);
  budget.forEach((p) => shown.add(p.id));
  const ukayGrid = ukay.filter((p) => !shown.has(p.id) && !isSoldOut(p)).slice(0, UKAY_GRID);

  // "Shop by store": item counts per store, and how many are ready-to-wear
  // (which colors the card). A store with nothing listed is left out, as in
  // Shop: a card that leads to an empty page is a dead end.
  const { storeCounts, rtwCounts } = React.useMemo(() => {
    const all = {};
    const rtw = {};
    products.forEach((p) => {
      if (!p.storeId) return;
      all[p.storeId] = (all[p.storeId] || 0) + 1;
      if (p.type === 'ready-to-wear') rtw[p.storeId] = (rtw[p.storeId] || 0) + 1;
    });
    return { storeCounts: all, rtwCounts: rtw };
  }, [products]);
  const browsableStores = stores.filter((st) => storeCounts[st.id] > 0);
  const ratings = useStoreRatings(browsableStores.map((st) => st.id));

  // Where the bottom of the screen is in the scrolling content, for the
  // Ukay grid's scroll-in reveal (kept on the UI thread — no re-render per
  // scroll), and where the grid starts.
  const scrollBottom = useSharedValue(0);
  const gridTop = useSharedValue(-1);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollBottom.value = e.contentOffset.y + e.layoutMeasurement.height;
  });

  const ukayCaption = loading || !ukay.length
    ? 'Pre-loved finds'
    : `${ukay.length} pre-loved ${ukay.length === 1 ? 'find' : 'finds'}`;
  const rtwCaption = loading || !rtwCount ? 'New styles' : `${rtwCount} new ${rtwCount === 1 ? 'style' : 'styles'}`;

  const openShop = (params) => goToTab(navigation, 'Shop', params);
  const openProduct = (product) => navigation.navigate('Product', { product });
  const openOrder = (order) => navigation.navigate('OrderDetails', { order });
  const openStore = (store) => navigation.push('Shop', { storeId: store.id });

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

  const renderSections = () => {
    if (loading) {
      return (
        <>
          <View style={styles.pad}>
            <SectionHead title="New arrivals" caption="The latest from our stores" delay={300} />
          </View>
          <RailSkeleton />
          <RailSkeleton />
        </>
      );
    }
    if (error) {
      return (
        <View style={[styles.message, styles.messageTop]}>
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
        <View style={[styles.message, styles.messageTop]}>
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
        {browsableStores.length > 0 ? (
          <>
            <View style={styles.pad}>
              <SectionHead title="Shop by store" caption="Local stores on PlainCo" delay={300} />
            </View>
            <StoreRail
              stores={browsableStores}
              counts={storeCounts}
              rtwCounts={rtwCounts}
              ratings={ratings}
              onOpen={openStore}
              startDelay={340}
            />
          </>
        ) : null}

        <View style={styles.pad}>
          <SectionHead
            title={arrivalsTitle}
            caption={arrivalsCaption}
            onSeeAll={() => openShop({ filterType: 'all' })}
            delay={380}
          />
        </View>
        <Rail
          products={newArrivals}
          startDelay={420}
          isFavorite={isFavorite}
          storeNameOf={storeNameOf}
          onOpen={openProduct}
          onToggleFavorite={handleToggleFavorite}
        />

        {budget.length > 0 ? (
          <View style={styles.budget}>
            <View style={styles.pad}>
              <SectionHead
                title="Budget finds"
                chip={`₱${BUDGET_MAX_PRICE} and under`}
                caption="Good pieces that go easy on the wallet"
                onDark
              />
            </View>
            <Rail
              products={budget}
              startDelay={0}
              isFavorite={isFavorite}
              storeNameOf={storeNameOf}
              onOpen={openProduct}
              onToggleFavorite={handleToggleFavorite}
              onDark
            />
          </View>
        ) : null}

        {ukayGrid.length > 0 ? (
          <>
            <View style={styles.pad}>
              <SectionHead
                title="Ukay finds"
                caption="One of a kind. Once it's gone, it's gone."
                onSeeAll={() => openShop({ filterType: 'ukay-ukay' })}
              />
            </View>
            <View
              onLayout={(e) => {
                gridTop.value = e.nativeEvent.layout.y;
              }}
            >
              <UkayGrid
                products={ukayGrid}
                gridTop={gridTop}
                scrollBottom={scrollBottom}
                isFavorite={isFavorite}
                storeNameOf={storeNameOf}
                onOpen={openProduct}
                onToggleFavorite={handleToggleFavorite}
              />
            </View>
          </>
        ) : null}

        <View style={styles.pad}>
          <AnimatedPressable
            style={styles.more}
            onPress={() => openShop({ filterType: 'all' })}
            rippleColor={Colors.light.border}
            accessibilityRole="button"
            accessibilityLabel="Browse everything"
          >
            <Text style={styles.moreText}>Browse everything</Text>
            <ArrowIcon />
          </AnimatedPressable>
          <Text style={styles.endNote}>You&apos;ve reached the end. New items are added often.</Text>
        </View>
      </>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={(e) => {
          // Before the first scroll: the bottom of the screen is its height.
          if (!scrollBottom.value) scrollBottom.value = e.nativeEvent.layout.height;
        }}
      >
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

          {/* Guests have nowhere saved to deliver to, so no line for them. */}
          {auth.currentUser ? (
            <Reveal delay={70}>
              <Pressable
                style={styles.deliver}
                onPress={() => navigation.navigate('Location')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={profile.place ? `Deliver to ${profile.place}` : 'Add a delivery address'}
                accessibilityHint="Opens your delivery address"
              >
                <Ionicons name="location-outline" size={14} color={Colors.light.tint} />
                <Text style={styles.deliverText} numberOfLines={1}>
                  {profile.place ? (
                    <>
                      Deliver to <Text style={styles.deliverPlace}>{profile.place}</Text> ›
                    </>
                  ) : (
                    <>
                      <Text style={styles.deliverPlace}>Add a delivery address</Text> ›
                    </>
                  )}
                </Text>
              </Pressable>
            </Reveal>
          ) : null}

          <Reveal delay={110} style={styles.searchWrap}>
            <TypingSearch onPress={() => openShop({ focusSearch: true })} />
          </Reveal>

          {loading ? (
            <SkeletonBlock style={[styles.wide, styles.heroSkeleton]} />
          ) : heroSlides.length ? (
            <Reveal delay={160} style={styles.wide}>
              <HeroGallery slides={heroSlides} onView={openProduct} />
            </Reveal>
          ) : null}

          <View style={[styles.wide, styles.tiles]}>
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

          {activeOrder ? (
            <Reveal delay={270} style={styles.wide}>
              <ActiveOrderCard order={activeOrder} onPress={() => openOrder(activeOrder)} style={styles.order} />
            </Reveal>
          ) : null}
        </View>

        {renderSections()}
      </Animated.ScrollView>

      <TabBar navigation={navigation} current="Home" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  flex: { flex: 1 },
  scroll: { paddingTop: 16, paddingBottom: 24 },
  pad: { paddingHorizontal: 20 },

  hello: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting: { fontSize: 12.5, color: Colors.light.icon },
  name: { fontSize: 24, fontWeight: '600', letterSpacing: -0.5, color: Colors.light.text },
  avatar: { width: 44, height: 44, borderRadius: 15, marginLeft: 12 },
  avatarInitials: { backgroundColor: Colors.light.secondary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '600', color: Colors.light.background },

  deliver: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 8, paddingVertical: 2 },
  deliverText: { fontSize: 12, color: Colors.light.icon, flexShrink: 1 },
  deliverPlace: { fontWeight: '500', color: Colors.light.text },
  searchWrap: { marginTop: 14, marginBottom: 16 },
  // The gallery, tiles and order card sit 16 pt from the edges, a little
  // wider than the 20 pt text column, as in the preview.
  wide: { marginHorizontal: -4 },
  heroSkeleton: { height: HERO_HEIGHT, borderRadius: 28 },

  tiles: { flexDirection: 'row', gap: 10, marginTop: 12 },
  order: { marginTop: 12 },
  tile: {
    height: 72,
    borderRadius: 20,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  tileRing: {
    position: 'absolute',
    right: -30,
    top: -30,
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 1.5,
    borderColor: 'rgba(250,247,242,0.18)',
  },
  tileTitle: { fontSize: 13, fontWeight: '600', lineHeight: 16, color: Colors.light.background },
  tileCaption: { fontSize: 11, color: 'rgba(250,247,242,0.85)' },

  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 24, marginBottom: 12 },
  sectionHeadInStrip: { marginTop: 18 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  sectionTitle: { fontSize: 18, fontWeight: '600', letterSpacing: -0.2, color: Colors.light.text },
  sectionCaption: { fontSize: 12, color: Colors.light.icon, marginTop: 2 },
  seeAll: { fontSize: 12.5, fontWeight: '600', color: Colors.light.tint, paddingLeft: 12, paddingBottom: 2 },
  chip: { marginLeft: 8, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: '#F1D98A' },
  chipText: { fontSize: 11, fontWeight: '600', color: '#4A3B08' },
  onDarkTitle: { color: Colors.light.background },
  onDarkCaption: { color: '#BDB3A9' },

  rail: { paddingHorizontal: 20, paddingBottom: 4, gap: RAIL_GAP },
  // Full-bleed ink strip, as in the preview; the price chip is Gold.
  budget: { marginTop: 24, paddingBottom: 18, backgroundColor: '#2B2622' },
  more: {
    marginTop: 18,
    height: 50,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  moreText: { fontSize: 14, fontWeight: '600', color: Colors.light.text },
  endNote: { marginTop: 22, textAlign: 'center', fontSize: 11.5, color: '#B3AAA0' },
  railSkeleton: { flexDirection: 'row', gap: RAIL_GAP, paddingHorizontal: 20, marginBottom: 26 },
  skeletonPhoto: { aspectRatio: 4 / 5, borderRadius: 18 },
  skeletonLine: { height: 12, borderRadius: 6, marginTop: 10, width: '80%' },
  skeletonLineShort: { marginTop: 6, width: '40%' },

  message: { alignItems: 'center', paddingHorizontal: 20, gap: 12 },
  messageTop: { marginTop: 24 },
});
