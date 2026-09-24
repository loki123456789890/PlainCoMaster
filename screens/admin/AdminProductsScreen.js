// Manage Products, from the approved store-manager preview: search, filter
// counts that double as the store's stock summary, one row per product with
// its stock at a glance, a ⋯ sheet for Edit / Duplicate / Delete (the delete
// confirmation happens inside the same sheet), and "Add product" floating
// bottom-right.
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { showAppAlert } from '../../utils/appAlert';
import { useProducts } from '../../context/ProductContext';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import { Colors } from '../../constants/theme';
import { stockLevel, parseStockLimit } from '../../utils/stock';
import Button from '../../components/ui/Button';
import SkeletonBlock from '../../components/ui/Skeleton';
import ProductImage from '../../components/ui/ProductImage';
import Sheet from '../../components/shop/Sheet';
import Reveal from '../../components/shop/Reveal';
import { TopBar, OfflineNotice, BigEmpty, UndoToast, useAutoClear } from '../../components/shop/TabScreen';

const INK = Colors.light.text;
const MUTED = Colors.light.icon;
const CLAY = Colors.light.tint;
const MOSS = Colors.light.secondary;
const ERR = '#B42318';
const LINE = Colors.light.border;
const CARD_LINE = '#EEE7DD';
const PRICE = '#8C6D0C';

const isUkay = (product) => product.type === 'ukay-ukay';
const needsRestock = (product) => {
  const level = stockLevel(product.stock);
  return level === 'out' || level === 'low';
};

const FILTERS = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'rtw', label: 'RTW', test: (p) => !isUkay(p) },
  { key: 'ukay', label: 'Ukay', test: isUkay },
  // "Low stock" is the dashboard's restocking list: sold out or under
  // LOW_STOCK_THRESHOLD. Products with no recorded stock aren't in it.
  { key: 'low', label: 'Low stock', test: needsRestock },
];

const peso = (value) => `₱${(Number(value) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

// The coloured dot and words under a product's price.
function stockInfo(stock) {
  const level = stockLevel(stock);
  const n = parseStockLimit(stock);
  if (level === 'out') return { color: ERR, label: 'Out of stock', warn: true };
  if (level === 'low') return { color: CLAY, label: `${n} left`, warn: true };
  if (level === 'unknown') return { color: '#B3AAA0', label: 'Stock not recorded', warn: false };
  return { color: MOSS, label: `${n} in stock`, warn: false };
}

function TypeTag({ product }) {
  const ukay = isUkay(product);
  return <Text style={[styles.tag, { backgroundColor: ukay ? MOSS : CLAY }]}>{ukay ? 'UKAY' : 'RTW'}</Text>;
}

function RowSkeleton() {
  return (
    <View style={styles.row}>
      <SkeletonBlock style={styles.thumb} />
      <View style={{ flex: 1, gap: 8 }}>
        <SkeletonBlock style={{ width: '70%', height: 14, borderRadius: 6 }} />
        <SkeletonBlock style={{ width: 110, height: 16, borderRadius: 8 }} />
        <SkeletonBlock style={{ width: 80, height: 11, borderRadius: 6 }} />
      </View>
    </View>
  );
}

function Action({ icon, title, detail, danger, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && { backgroundColor: '#F1EBE3' }]}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
    >
      <View style={[styles.actionIcon, danger && { backgroundColor: '#FBEDEB' }]}>
        <Ionicons name={icon} size={18} color={danger ? ERR : INK} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.actionTitle, danger && { color: ERR }]}>{title}</Text>
        <Text style={styles.actionDetail}>{detail}</Text>
      </View>
    </Pressable>
  );
}

// The ⋯ sheet: the product up top, then its actions. "Delete product"
// swaps the actions for the confirmation rather than stacking a second
// dialog over the sheet.
function ActionSheet({ product, onClose, onEdit, onDuplicate, onDelete, deleting }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (product) setConfirming(false);
  }, [product]);
  // Holds the last product so the sheet keeps its content while it slides away.
  const last = useRef(product);
  if (product) last.current = product;
  const shown = last.current || {};
  const info = stockInfo(shown.stock);

  return (
    <Sheet visible={Boolean(product)} onClose={onClose} locked={deleting}>
      <View style={styles.sheetProduct}>
        <ProductImage uri={shown.imageUrl || shown.image} style={styles.sheetThumb} />
        <View style={{ flex: 1 }}>
          <Text style={styles.sheetName} numberOfLines={1}>
            {shown.name}
          </Text>
          <Text style={styles.sheetMeta} numberOfLines={1}>
            {isUkay(shown) ? 'Ukay-Ukay' : 'Ready-to-Wear'} · {peso(shown.price)} · {info.label}
          </Text>
        </View>
      </View>
      {confirming ? (
        <View>
          <Text style={styles.confirmTitle} accessibilityRole="header">
            Delete this product?
          </Text>
          <Text style={styles.confirmText}>
            It disappears from the shop right away. Past orders keep their own copy, so order history isn&apos;t
            affected. This can&apos;t be undone.
          </Text>
          <View style={styles.confirmRow}>
            <View style={{ flex: 1 }}>
              <Button variant="secondary" label="Keep it" fontSize={15} onPress={onClose} disabled={deleting} />
            </View>
            <View style={{ flex: 1 }}>
              <Button variant="danger" label="Delete" fontSize={15} onPress={onDelete} loading={deleting} />
            </View>
          </View>
        </View>
      ) : (
        <View>
          <Action icon="create-outline" title="Edit details" detail="Name, price, stock, variants" onPress={onEdit} />
          <Action
            icon="copy-outline"
            title="Duplicate"
            detail="Start a new listing from this one"
            onPress={onDuplicate}
          />
          <Action
            icon="trash-outline"
            title="Delete product"
            detail="Removes it from the shop"
            danger
            onPress={() => {
              Haptics.selectionAsync();
              setConfirming(true);
            }}
          />
        </View>
      )}
    </Sheet>
  );
}

export default function AdminProductsScreen({ navigation, route }) {
  // storeProducts, not products: this screen manages the signed-in
  // manager's own store, and every other store's items are refused them.
  const { storeProducts: products, loading, error, deleteProduct, refreshProducts, retryFetchProducts } = useProducts();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  // The dashboard's "Low on stock" row arrives with filter: 'restock'.
  const [filter, setFilter] = useState(route.params?.filter === 'restock' ? 'low' : 'all');
  const [selected, setSelected] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [toast, setToast] = useState('');
  useAutoClear(toast, () => setToast(''), 3200);
  const { isConnected } = useNetworkStatus();

  // If the dashboard sends the filter again while this screen is already
  // mounted, honour it.
  useEffect(() => {
    if (route.params?.filter === 'restock') setFilter('low');
  }, [route.params?.filter]);

  // Back from Add or Edit: say what happened, and ring the row it
  // happened to for a moment. Add sends `added`; Edit sends `notice` and
  // the row to `highlight` (none after a delete).
  const [justAdded, setJustAdded] = useState(null);
  useEffect(() => {
    const { added, notice, highlight } = route.params || {};
    if (!added && !notice) return undefined;
    setToast(added ? `"${added}" is live in your shop` : notice);
    if (added) setFilter('all');
    const ring = added || highlight;
    if (!ring) return undefined;
    setJustAdded(ring);
    const t = setTimeout(() => setJustAdded(null), 2500);
    return () => clearTimeout(t);
  }, [route.params?.addedAt, route.params?.noticeAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshProducts();
    setRefreshing(false);
  };

  const q = searchQuery.trim().toLowerCase();
  const activeFilter = FILTERS.find((f) => f.key === filter);
  // Search and the filter compose (AND), so searching inside Low stock
  // narrows it instead of silently dropping back to the whole catalog.
  const shown = products
    .filter(activeFilter.test)
    .filter((p) => !q || (p.name || '').toLowerCase().includes(q) || (p.type || '').toLowerCase().includes(q));

  const openActions = (product) => {
    Haptics.selectionAsync();
    setSelected(product);
  };

  const confirmDelete = async () => {
    if (!selected?.id) return;
    const name = selected.name;
    setDeleting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await deleteProduct(selected.id);
    setDeleting(false);
    setSelected(null);
    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setToast(`"${name}" deleted. It's logged in Store Activity.`);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAppAlert('Error', 'Failed to delete product: ' + result.error);
    }
  };

  // Hands the Add form a filled-in copy to edit rather than a blank one to
  // retype — an ukay bale is dozens of similar pieces. Deliberately opens
  // the form rather than writing a copy straight to Firestore, so nothing
  // lands in the catalog without the manager seeing it.
  const duplicate = () => {
    const product = selected;
    setSelected(null);
    navigation.navigate('AdminAddProduct', { duplicateFrom: product });
  };

  const edit = () => {
    const product = selected;
    setSelected(null);
    navigation.navigate('AdminEditProduct', { product });
  };

  const emptyText =
    filter === 'low' && !q
      ? {
          icon: 'checkmark-circle-outline',
          title: 'Nothing is running low',
          text: 'Every product has enough stock. Nice.',
        }
      : q
        ? {
            icon: 'search-outline',
            title: 'No products match',
            text: 'Try a different name.',
          }
        : products.length === 0
          ? {
              icon: 'cube-outline',
              title: 'No products yet',
              text: 'Add your first product and it shows up in the shop right away.',
            }
          : {
              icon: 'cube-outline',
              title: 'Nothing here',
              text: 'No products of this type yet.',
            };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar title="Manage Products" onBack={() => navigation.goBack()} stuck={stuck} />

      <View style={styles.top}>
        <View style={[styles.search, searchFocused && styles.searchFocused]}>
          <Ionicons name="search-outline" size={18} color={MUTED} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search your products"
            placeholderTextColor={MUTED}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            accessibilityLabel="Search products by name or type"
            returnKeyType="search"
          />
          {searchQuery ? (
            <Pressable
              onPress={() => setSearchQuery('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={18} color={MUTED} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.seg} accessibilityRole="tablist">
          {FILTERS.map((f) => {
            const on = filter === f.key;
            const count = loading ? '–' : products.filter(f.test).length;
            return (
              <Pressable
                key={f.key}
                onPress={() => {
                  Haptics.selectionAsync();
                  setFilter(f.key);
                }}
                style={[styles.segItem, on && styles.segItemOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${f.label}, ${count}`}
              >
                <Text style={[styles.segCount, on && { color: Colors.light.background }]}>{count}</Text>
                <Text style={[styles.segLabel, on && { color: '#BDB3A9' }]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {!isConnected ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <OfflineNotice>No internet connection. Product data may be out of date.</OfflineNotice>
        </View>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.list, { paddingBottom: Math.max(insets.bottom, 16) + 100 }]}
        onScroll={(e) => setStuck(e.nativeEvent.contentOffset.y > 4)}
        scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={CLAY} />}
      >
        {loading && !refreshing ? (
          <>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        ) : error ? (
          <BigEmpty
            icon="cloud-offline-outline"
            title="Couldn't load products"
            text="Check your connection and try again."
            actionLabel="Retry"
            onAction={retryFetchProducts}
          />
        ) : shown.length === 0 ? (
          <BigEmpty {...emptyText} />
        ) : (
          shown.map((product, index) => {
            const info = stockInfo(product.stock);
            return (
              <Reveal key={product.id} delay={Math.min(index, 8) * 45}>
                <Pressable
                  onPress={() => openActions(product)}
                  style={({ pressed }) => [
                    styles.row,
                    justAdded === product.name && styles.rowNew,
                    pressed && { transform: [{ scale: 0.99 }] },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${product.name}, ${isUkay(product) ? 'Ukay-Ukay' : 'Ready-to-Wear'}, ${peso(product.price)}, ${info.label}`}
                  accessibilityHint="Opens edit, duplicate and delete"
                >
                  <ProductImage uri={product.imageUrl || product.image} style={styles.thumb} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {product.name}
                    </Text>
                    <View style={styles.meta}>
                      <TypeTag product={product} />
                      <Text style={styles.price}>{peso(product.price)}</Text>
                    </View>
                    <View style={styles.stock}>
                      <View style={[styles.stockDot, { backgroundColor: info.color }]} />
                      <Text style={[styles.stockText, info.warn && { color: info.color }]}>{info.label}</Text>
                    </View>
                  </View>
                  <View style={styles.more} accessibilityElementsHidden importantForAccessibility="no">
                    <Ionicons name="ellipsis-horizontal" size={18} color={INK} />
                  </View>
                </Pressable>
              </Reveal>
            );
          })
        )}
      </ScrollView>

      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          navigation.navigate('AdminAddProduct');
        }}
        style={({ pressed }) => [
          styles.fab,
          { bottom: Math.max(insets.bottom, 12) + 18 },
          pressed && { transform: [{ scale: 0.95 }] },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Add product"
      >
        <Ionicons name="add" size={22} color="#fff" />
        <Text style={styles.fabText}>Add product</Text>
      </Pressable>

      <UndoToast text={toast} lift={4} />

      <ActionSheet
        product={selected}
        onClose={() => !deleting && setSelected(null)}
        onEdit={edit}
        onDuplicate={duplicate}
        onDelete={confirmDelete}
        deleting={deleting}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  top: { paddingHorizontal: 16, paddingBottom: 8 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: LINE,
    paddingHorizontal: 14,
  },
  searchFocused: { borderColor: CLAY },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: INK,
    paddingVertical: 0,
    outlineStyle: 'none',
  },
  seg: { flexDirection: 'row', gap: 6, marginTop: 10 },
  segItem: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: LINE,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segItemOn: { backgroundColor: INK, borderColor: INK },
  segCount: { fontSize: 17, fontWeight: '600', color: INK, lineHeight: 20 },
  segLabel: { fontSize: 11, fontWeight: '500', color: MUTED },

  list: { paddingHorizontal: 16, paddingTop: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: CARD_LINE,
    marginBottom: 10,
  },
  rowNew: { borderColor: MOSS, borderWidth: 2, padding: 9 },
  thumb: {
    width: 72,
    height: 80,
    borderRadius: 14,
    backgroundColor: '#EFE6DA',
  },
  name: { fontSize: 14, fontWeight: '600', color: INK },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  tag: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  price: { fontSize: 14, fontWeight: '600', color: PRICE },
  stock: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  stockDot: { width: 7, height: 7, borderRadius: 4 },
  stockText: { fontSize: 11.5, color: MUTED },
  more: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#F3EEE6',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },

  fab: {
    position: 'absolute',
    right: 18,
    height: 56,
    paddingLeft: 16,
    paddingRight: 20,
    borderRadius: 18,
    backgroundColor: CLAY,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: CLAY,
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  fabText: { fontSize: 14.5, fontWeight: '600', color: '#fff' },

  sheetProduct: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    marginBottom: 8,
  },
  sheetThumb: {
    width: 48,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#EFE6DA',
  },
  sheetName: { fontSize: 14, fontWeight: '600', color: INK },
  sheetMeta: { fontSize: 12, color: MUTED, marginTop: 1 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#F3EEE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitle: { fontSize: 14, fontWeight: '500', color: INK },
  actionDetail: { fontSize: 11.5, color: MUTED },
  confirmTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: INK,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 6,
  },
  confirmText: {
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
    marginBottom: 14,
  },
  confirmRow: { flexDirection: 'row', gap: 10 },
});
