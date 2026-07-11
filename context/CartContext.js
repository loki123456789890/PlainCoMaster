import React, { createContext, useState, useContext, useEffect } from 'react';
import { auth, db } from '../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';

const CartContext = createContext();

export const useCart = () => useContext(CartContext);

export const CartProvider = ({ children }) => {
  const [cartItems, setCartItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Same reasoning as FavoritesContext: this provider wraps the whole
    // app once at launch and never remounts, so we need to react to
    // login/logout events happening later in the session, not just check
    // auth.currentUser once at mount.
    let unsubscribeCart = () => {};

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      // Tear down any listener from a previous account before starting
      // the next one, so a logout->login switch doesn't leave a stale
      // listener running against the wrong user.
      unsubscribeCart();

      if (!user) {
        setCartItems([]);
        setLoading(false);
        unsubscribeCart = () => {};
        return;
      }

      setLoading(true);
      const cartRef = collection(db, 'users', user.uid, 'cart');
      unsubscribeCart = onSnapshot(
        cartRef,
        (snapshot) => {
          const items = snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }));
          setCartItems(items);
          setLoading(false);
        },
        (error) => {
          console.error('Error fetching cart:', error);
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeCart();
    };
  }, []);

  const addToCart = async (cartItem) => {
    if (!auth.currentUser) {
      // No Alert here — the calling screen (e.g. ProductScreen) already
      // handles the not-authenticated case with its own Login-prompt
      // Alert, same convention FavoritesContext uses for toggleFavorite.
      return { success: false, error: 'not-authenticated' };
    }

    try {
      const userCartRef = collection(db, 'users', auth.currentUser.uid, 'cart');
      // Cart items don't dedupe like favorites do — the same product can
      // legitimately appear as several separate cart lines with different
      // size/color/quantity, so this always adds a new doc rather than
      // checking for an existing one first.
      await addDoc(userCartRef, { ...cartItem, addedAt: serverTimestamp() });

      // No manual setCartItems() call needed — the onSnapshot listener
      // above picks up the change and updates state reactively, same
      // pattern FavoritesContext uses.
      return { success: true };
    } catch (error) {
      console.error('Error adding to cart:', error);
      return { success: false, error: error.message };
    }
  };

  const removeFromCart = async (itemId) => {
    if (!auth.currentUser) {
      return { success: false, error: 'not-authenticated' };
    }
    try {
      await deleteDoc(doc(db, 'users', auth.currentUser.uid, 'cart', itemId));
      return { success: true };
    } catch (error) {
      console.error('Error removing item:', error);
      return { success: false, error: error.message };
    }
  };

  // Badge count = total quantity across all cart lines, not just the
  // number of distinct lines — e.g. one line with quantity 3 shows "3".
  // Swap to cartItems.length if you'd rather the badge reflect distinct
  // product lines instead.
  const cartCount = cartItems.reduce((sum, item) => sum + (item.quantity || 1), 0);

  return (
    <CartContext.Provider value={{
      cartItems,
      loading,
      cartCount,
      addToCart,
      removeFromCart,
    }}>
      {children}
    </CartContext.Provider>
  );
};