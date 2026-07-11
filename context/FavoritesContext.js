import React, { createContext, useState, useContext, useEffect } from 'react';
import { auth, db } from '../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';

const FavoritesContext = createContext();

export const useFavorites = () => useContext(FavoritesContext);

export const FavoritesProvider = ({ children }) => {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // This provider wraps the whole app once at launch and never remounts,
    // so we can't just check auth.currentUser one time the way a screen
    // would — we need to actively react to login/logout events happening
    // later in the session. onAuthStateChanged gives us that; a plain
    // useEffect(() => {...}, []) checking auth.currentUser once would only
    // ever see whatever the auth state was at app launch.
    let unsubscribeFavorites = () => {};

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      // Tear down any listener from a previous account before starting
      // the next one, so a logout->login switch doesn't leave a stale
      // listener running against the wrong user.
      unsubscribeFavorites();

      if (!user) {
        setFavorites([]);
        setLoading(false);
        unsubscribeFavorites = () => {};
        return;
      }

      setLoading(true);
      const favoritesRef = collection(db, 'users', user.uid, 'favorites');
      unsubscribeFavorites = onSnapshot(
        favoritesRef,
        (snapshot) => {
          const fetched = snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }));
          setFavorites(fetched);
          setLoading(false);
        },
        (error) => {
          console.error('Error fetching favorites:', error);
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeFavorites();
    };
  }, []);

  const toggleFavorite = async (product) => {
    if (!auth.currentUser) {
      // No Alert here — the calling screen (e.g. ProductScreen) already
      // handles the not-authenticated case with its own Login-prompt
      // Alert, matching how it handles handleAddToCart's guest case.
      // Popping one here too would stack two alerts on a single tap.
      return { success: false, error: 'not-authenticated' };
    }

    try {
      const exists = favorites.some((item) => item.id === product.id);
      const favoriteRef = doc(db, 'users', auth.currentUser.uid, 'favorites', product.id);

      if (exists) {
        await deleteDoc(favoriteRef);
      } else {
        // Store the product as given, same as the old AsyncStorage version
        // did — a snapshot at the time of favoriting, not a live reference.
        // Matches how OrderDetailsScreen already shows historical product
        // snapshots rather than always resolving against live product data.
        await setDoc(favoriteRef, { ...product, addedAt: serverTimestamp() });
      }

      // No manual setFavorites() call needed — the onSnapshot listener
      // above picks up the change and updates state reactively, same
      // pattern used by ProductContext and Cart elsewhere in the app.
      return { success: true, isFavorite: !exists };
    } catch (error) {
      console.error('Error toggling favorite:', error);
      return { success: false, error: error.message };
    }
  };

  const isFavorite = (productId) => {
    return favorites.some((item) => item.id === productId);
  };

  // Kept for backward compatibility in case any screen calls this
  // expecting a manual refresh — the live onSnapshot listener already
  // keeps favorites current, so this is mostly a safety net now rather
  // than the primary way data gets loaded.
  const refreshFavorites = async () => {
    if (!auth.currentUser) {
      setFavorites([]);
      return;
    }
    try {
      const favoritesRef = collection(db, 'users', auth.currentUser.uid, 'favorites');
      const snapshot = await getDocs(favoritesRef);
      const fetched = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));
      setFavorites(fetched);
    } catch (error) {
      console.error('Error refreshing favorites:', error);
    }
  };

  return (
    <FavoritesContext.Provider value={{
      favorites,
      loading,
      toggleFavorite,
      isFavorite,
      refreshFavorites,
    }}>
      {children}
    </FavoritesContext.Provider>
  );
};