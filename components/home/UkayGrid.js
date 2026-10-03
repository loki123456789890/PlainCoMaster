// components/home/UkayGrid.js
//
// "Ukay finds" on Home, from the approved home preview: a two-column grid
// with a staggered rhythm — the left card's photo a little taller, the
// right card set 22 pt lower — so it reads like a thrift rack rather than
// a spreadsheet. Each row fades up as it scrolls into view, left then
// right. Reduce Motion shows every row in place.
//
// Home passes the scroll position as shared values (`scrollBottom`: the
// content offset at the bottom of the screen) and the grid's own offset in
// the scrolling content (`gridTop`), so the reveal runs on the UI thread
// without re-rendering Home on every scroll.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withDelay,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';
import { EASE_OUT_QUINT } from '../../constants/motion';
import ProductCard from '../shop/ProductCard';

const COLUMN_GAP = 12;
const ROW_GAP = 12;
const STAGGER = 22;
const TALL_PHOTO = 4 / 5.4;
// How far into view a row must come before it rises.
const SEEN_AT = 40;

function GridCell({ seen, column, children, style }) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(reduceMotion ? 1 : 0);
  useAnimatedReaction(
    () => seen.value,
    (now, before) => {
      if (now && !before && progress.value === 0) {
        progress.value = withDelay(column * 90, withTiming(1, { duration: 600, easing: EASE_OUT_QUINT }));
      }
    }
  );
  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 24 }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

function GridRow({ pair, index, gridTop, scrollBottom, renderCard }) {
  const rowTop = useSharedValue(-1);
  const seen = useSharedValue(false);
  useAnimatedReaction(
    () => rowTop.value >= 0 && gridTop.value >= 0 && scrollBottom.value > gridTop.value + rowTop.value + SEEN_AT,
    (now) => {
      if (now && !seen.value) seen.value = true;
    }
  );
  return (
    <View
      style={[styles.row, index > 0 && { marginTop: ROW_GAP }]}
      onLayout={(e) => {
        rowTop.value = e.nativeEvent.layout.y;
      }}
    >
      <GridCell seen={seen} column={0} style={styles.cell}>
        {renderCard(pair[0], { photoAspect: TALL_PHOTO })}
      </GridCell>
      {pair[1] ? (
        <GridCell seen={seen} column={1} style={[styles.cell, styles.lower]}>
          {renderCard(pair[1], {})}
        </GridCell>
      ) : (
        <View style={styles.cell} />
      )}
    </View>
  );
}

export default function UkayGrid({ products, gridTop, scrollBottom, isFavorite, storeNameOf, onOpen, onToggleFavorite }) {
  const rows = [];
  for (let i = 0; i < products.length; i += 2) rows.push(products.slice(i, i + 2));

  const renderCard = (product, extra) => (
    <ProductCard
      product={product}
      favorited={isFavorite(product.id)}
      storeName={storeNameOf(product)}
      nameLines={1}
      onPress={() => onOpen(product)}
      onToggleFavorite={() => onToggleFavorite(product)}
      {...extra}
    />
  );

  return (
    <View style={styles.grid}>
      {rows.map((pair, i) => (
        <GridRow
          key={pair[0].id}
          pair={pair}
          index={i}
          gridTop={gridTop}
          scrollBottom={scrollBottom}
          renderCard={renderCard}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { paddingHorizontal: 20 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: COLUMN_GAP },
  cell: { flex: 1 },
  lower: { marginTop: STAGGER },
});
