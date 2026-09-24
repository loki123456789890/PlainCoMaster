// components/admin/StoreChip.js
//
// The store's logo and name in a small pill, on the right of a Store
// Manager screen's top bar (Reviews, Store Activity), so it's clear whose
// data is on screen. Renders nothing without a store.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAdmin } from '../../context/AdminContext';
import { useStores } from '../../context/StoreContext';
import { Colors } from '../../constants/theme';
import StoreLogo from '../shop/StoreLogo';

export default function StoreChip() {
  const { storeId } = useAdmin();
  const { getStore } = useStores();
  const store = storeId ? getStore(storeId) : null;
  if (!store) return null;
  return (
    <View style={styles.chip} accessible accessibilityLabel={`Store: ${store.name}`}>
      <StoreLogo uri={store.logoUrl} size={20} radius={6} />
      <Text style={styles.name} numberOfLines={1}>
        {store.name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 150,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 10,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#EEE7DD',
  },
  name: { flexShrink: 1, fontSize: 11, fontWeight: '600', color: Colors.light.icon },
});
