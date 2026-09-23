// screens/Favoritescreen.js
//
// Saved items, in the approved favorites/cart/profile preview's design:
// the page title with a count, the same cards as Shop, and an Undo after
// removing one. A favorite whose product has since been removed stays in
// the list, faded, as "No longer available", so it can be cleared.
import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import Animated, {
  useReducedMotion,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFavorites } from '../context/FavoritesContext';
import { useProducts } from '../context/ProductContext';
import { useStores } from '../context/StoreContext';
import { auth } from '../firebaseConfig';
import { Colors } from '../constants/theme';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import SkeletonBlock from '../components/ui/Skeleton';
import ProductCard from '../components/shop/ProductCard';
import TabBar, { goToTab } from '../components/shop/TabBar';
import { PageHead, BigEmpty, UndoToast, useAutoClear } from '../components/shop/TabScreen';
import { EASE_OUT_QUINT } from '../constants/motion';

function FavoritesSkeleton() {
  return (
    <View style={styles.skeletonGrid}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.skeletonCell}>
          <SkeletonBlock style={styles.skeletonPhoto} />
          <SkeletonBlock style={styles.skeletonLine} />
          <SkeletonBlock style={[styles.skeletonLine, styles.skeletonLineShort]} />
        </View>
      ))}
    </View>
  );
}

export default function FavoritesScreen({ navigation, route }) {
  const { favorites, loading, error, toggleFavorite, retryFetchFavorites } = useFavorites();
  const { products, loading: productsLoading, error: productsError } = useProducts();
  const { getStore } = useStores();
  const reduceMotion = useReducedMotion();
  const fromTab = route.params?.via === 'tab';

  // The most recently removed favorite, kept long enough to offer Undo —
  // removing is reversible for a few seconds, so it needs no confirmation.
  const [undoItem, setUndoItem] = useState(null);
  useAutoClear(undoItem, () => setUndoItem(null));

  useEffect(() => {
    // Favorites are per-account data; a guest belongs on Login, not on an
    // empty list that implies they have an account with nothing saved.
    if (!auth.currentUser) navigation.replace('Login');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRemove = async (item) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Offered straight away, as the card leaves — not after the server
    // confirms, which can take long enough to look like nothing happened.
    setUndoItem(item);
    const result = await toggleFavorite(item);
    if (!result?.success) setUndoItem(null);
  };

  const handleUndo = async () => {
    if (!undoItem) return;
    const item = undoItem;
    setUndoItem(null);
    const result = await toggleFavorite(item);
    if (result?.success) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // A favorite is a copy of the product taken when it was saved. Show the
  // live product where it still exists (current price, stock, photo), and
  // call it unavailable only once the catalogue has actually loaded — an
  // empty list while loading would otherwise mark everything as gone.
  const catalogueKnown = !productsLoading && !productsError;
  const rows = favorites.map((fav) => {
    const live = products.find((p) => p.id === fav.id);
    return {
      key: fav.id,
      saved: fav,
      shown: live ? { ...fav, ...live } : { ...fav, imageUrl: fav.imageUrl || fav.image },
      unavailable: catalogueKnown && !live,
    };
  });

  const renderItem = ({ item, index }) => (
    <Animated.View
      style={styles.cell}
      entering={reduceMotion ? undefined : FadeInDown.delay(Math.min(index, 7) * 50).duration(500).easing(EASE_OUT_QUINT)}
      exiting={reduceMotion ? undefined : FadeOut.duration(250)}
      layout={reduceMotion ? undefined : LinearTransition.duration(300).easing(EASE_OUT_QUINT)}
    >
      <ProductCard
        product={item.shown}
        favorited
        unavailable={item.unavailable}
        storeName={item.unavailable ? null : getStore(item.shown.storeId)?.name}
        onPress={() => navigation.navigate('Product', { product: item.shown })}
        onToggleFavorite={() => handleRemove(item.saved)}
      />
    </Animated.View>
  );

  const count = favorites.length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <PageHead
        title="Favorites"
        meta={!loading && !error && count > 0 ? `${count} ${count === 1 ? 'item' : 'items'}` : null}
        onBack={fromTab ? null : () => navigation.goBack()}
      />

      {loading ? (
        <FavoritesSkeleton />
      ) : error ? (
        <Animated.View style={styles.center} entering={reduceMotion ? undefined : FadeIn.duration(220)}>
          <EmptyState icon="cloud-offline-outline" title="Couldn't load favorites" subtitle="Check your connection and try again." />
          <Button variant="secondary" label="Retry" onPress={retryFetchFavorites} />
        </Animated.View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <BigEmpty
              icon="heart-outline"
              title="No favorites yet"
              text="Tap the heart on any item to save it here for later."
              actionLabel="Browse the Shop"
              onAction={() => goToTab(navigation, 'Shop')}
            />
          }
        />
      )}

      <UndoToast
        text={undoItem ? 'Removed from Favorites' : ''}
        onUndo={handleUndo}
        undoLabel={undoItem ? `Undo removing ${undoItem.name} from favorites` : undefined}
      />
      <TabBar navigation={navigation} current="Favorites" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  grid: { paddingHorizontal: 20, paddingBottom: 24 },
  row: { gap: 12 },
  cell: { flex: 1, maxWidth: '50%', marginBottom: 18 },

  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, columnGap: 12 },
  skeletonCell: { width: '47%', flexGrow: 1, marginBottom: 18 },
  skeletonPhoto: { aspectRatio: 4 / 5, borderRadius: 18 },
  skeletonLine: { height: 12, borderRadius: 6, marginTop: 10, width: '80%' },
  skeletonLineShort: { marginTop: 6, width: '40%' },
});
