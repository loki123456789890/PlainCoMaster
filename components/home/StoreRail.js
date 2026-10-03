// components/home/StoreRail.js
//
// "Shop by store" on Home, from the approved home preview: a sideways row of
// small gradient cards, one per store with something listed — the logo, the
// name, and "8 items · New store" or the store's star rating. A store
// that mostly sells ready-to-wear gets a Clay card, one that mostly sells
// ukay-ukay a Moss card, matching the category tiles above. The same item
// count, "New store" and rating rules as Shop's store row.
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { formatAverage } from '../../utils/reviews';
import AnimatedPressable from '../ui/AnimatedPressable';
import Reveal from '../shop/Reveal';

const CARD_WIDTH = 150;
const GAP = 12;
// A store younger than this, with no reviews yet, is labelled "New store".
const NEW_STORE_MS = 30 * 24 * 60 * 60 * 1000;
const GRADIENT = {
  rtw: ['#C4623E', '#A94F2F'],
  ukay: ['#5B6B4F', '#4A5940'],
};

function StoreCard({ store, count, rtwCount, rating, onPress }) {
  const rated = rating?.count > 0;
  const isNew = !rated && store.createdAt && Date.now() - store.createdAt.getTime() < NEW_STORE_MS;
  const items = `${count} ${count === 1 ? 'item' : 'items'}`;
  const label = [store.name, items, rated ? `rated ${formatAverage(rating.average)} out of 5` : isNew ? 'new store' : null]
    .filter(Boolean)
    .join(', ');

  return (
    <AnimatedPressable
      style={styles.card}
      onPress={onPress}
      rippleColor="rgba(255,255,255,0.2)"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {/* 160°, as in the preview: lighter at the top left. */}
      <LinearGradient
        colors={rtwCount * 2 > count ? GRADIENT.rtw : GRADIENT.ukay}
        start={{ x: 0.33, y: 0 }}
        end={{ x: 0.67, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.ring} />
      {store.logoUrl ? (
        <Image source={{ uri: store.logoUrl }} style={styles.logo} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.logo, styles.logoEmpty]}>
          <Ionicons name="storefront-outline" size={20} color="#FFFFFF" />
        </View>
      )}
      <Text style={styles.name} numberOfLines={2}>
        {store.name}
      </Text>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {items}
          {rated || isNew ? ' · ' : ''}
          {isNew ? 'New store' : ''}
        </Text>
        {rated ? (
          <>
            <Ionicons name="star" size={11} color="#FFFFFF" />
            <Text style={styles.meta}>
              {formatAverage(rating.average)} ({rating.count})
            </Text>
          </>
        ) : null}
      </View>
    </AnimatedPressable>
  );
}

export default function StoreRail({ stores, counts, rtwCounts, ratings, onOpen, startDelay = 0 }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
      snapToInterval={CARD_WIDTH + GAP}
      decelerationRate="fast"
    >
      {stores.map((store, i) => (
        <Reveal key={store.id} from="right" delay={startDelay + i * 70}>
          <StoreCard
            store={store}
            count={counts[store.id] || 0}
            rtwCount={rtwCounts[store.id] || 0}
            rating={ratings[store.id]}
            onPress={() => onOpen(store)}
          />
        </Reveal>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rail: { paddingHorizontal: 20, paddingBottom: 4, gap: GAP },
  card: { width: CARD_WIDTH, borderRadius: 22, padding: 14, overflow: 'hidden' },
  ring: {
    position: 'absolute',
    right: -30,
    bottom: -30,
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  logo: { width: 44, height: 44, borderRadius: 13, borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)' },
  logoEmpty: { backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  name: { marginTop: 10, marginBottom: 2, fontSize: 13.5, fontWeight: '600', lineHeight: 17, color: '#FFFFFF' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { fontSize: 11, color: 'rgba(255,255,255,0.85)' },
});
