import React, { createContext, useState, useContext, useEffect, useMemo, useCallback } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebaseConfig';
import {
  storeReviewsQuery,
  mapReviewDoc,
  summarizeReviews,
  STORE_SUMMARY_LIMIT,
} from '../utils/reviews';

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
              // The store profile its manager edits (AdminStoreProfileScreen).
              logoUrl: data.logoUrl || null,
              description: data.description || '',
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

// Seller ratings: each store's summary, keyed by store id, from the same
// verified-purchase reviews that rate its products. A review names the
// store that sold the item (checked against the order by firestore.rules),
// so this is what the store's own buyers said, and one store's record
// never leans on another's.
//
// Read from each store's most recent STORE_SUMMARY_LIMIT reviews, not its
// lifetime total, for the reason given in utils/reviews.js: the recent
// record is the useful claim. `sampled` says when the cap was reached, so
// a screen can say "last 100 reviews" rather than implying that is all.
//
// A store is missing from the result while it loads or if the read fails;
// screens show nothing for it rather than "No reviews yet", which would be
// a claim. Live, so hiding a review in moderation moves the number at once.
export function useStoreRatings(storeIds) {
  // A string key, so a caller passing a fresh array each render doesn't
  // tear the listeners down and set them up again every time.
  const key = [...new Set((storeIds || []).filter(Boolean))].sort().join('|');
  const [ratings, setRatings] = useState({});

  useEffect(() => {
    setRatings({});
    if (!key || !auth.currentUser) return undefined;

    const unsubscribes = key.split('|').map((storeId) =>
      onSnapshot(
        storeReviewsQuery(storeId),
        (snapshot) => {
          const summary = summarizeReviews(snapshot.docs.map((docSnap) => mapReviewDoc(docSnap)));
          summary.sampled = snapshot.size >= STORE_SUMMARY_LIMIT;
          setRatings((previous) => ({ ...previous, [storeId]: summary }));
        },
        (err) => console.error('Error loading store rating:', storeId, err.code, err.message)
      )
    );

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [key]);

  return ratings;
}

// "12 reviews", or "last 100 reviews" once the sample is capped.
export function storeReviewCountLabel(summary) {
  if (!summary || summary.count === 0) return 'No reviews yet';
  if (summary.sampled) return `last ${summary.count} reviews`;
  return summary.count === 1 ? '1 review' : `${summary.count} reviews`;
}
