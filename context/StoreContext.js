import React, { createContext, useState, useContext, useEffect, useMemo, useCallback } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebaseConfig';

const StoreContext = createContext();

export const useStores = () => useContext(StoreContext);

// The stores a shopper can browse, by name. Products carry only a storeId,
// so the Shop, a store's own page and a product's "Sold by" line all need
// this lookup — one listener here rather than one per screen, and it stays
// warm while the shopper moves between them.
//
// Gated on sign-in for the same reason as ProductContext: firestore.rules
// allows reading /stores only to a signed-in account, and this provider
// wraps Landing/Login too.
export const StoreProvider = ({ children }) => {
  const [stores, setStores] = useState([]);

  useEffect(() => {
    let unsubscribeStores = () => {};

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeStores();

      if (!user) {
        setStores([]);
        unsubscribeStores = () => {};
        return;
      }

      unsubscribeStores = onSnapshot(
        collection(db, 'stores'),
        (snapshot) => {
          const list = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              name: data.name || 'Unnamed store',
              createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
            };
          });
          list.sort((a, b) => a.name.localeCompare(b.name));
          setStores(list);
        },
        // A failure costs the store names, not the shop: products still
        // load, and every screen below renders without a store line.
        (err) => console.error('Error listening to stores:', err.code, err.message)
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeStores();
    };
  }, []);

  const byId = useMemo(() => {
    const map = {};
    stores.forEach((store) => {
      map[store.id] = store;
    });
    return map;
  }, [stores]);

  const getStore = useCallback((storeId) => (storeId ? byId[storeId] || null : null), [byId]);

  return (
    <StoreContext.Provider value={{ stores, getStore }}>
      {children}
    </StoreContext.Provider>
  );
};
