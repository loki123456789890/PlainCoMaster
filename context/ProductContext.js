import React, { createContext, useState, useContext, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebaseConfig';

const ProductContext = createContext();

export const useProducts = () => useContext(ProductContext);

export const ProductProvider = ({ children }) => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Bumped by retryFetchProducts() to force the effect below to tear down
  // and re-establish the onSnapshot subscription. Firestore's listener
  // self-heals most transient network blips on its own, but if the very
  // first subscribe attempt fails outright (e.g. no connectivity at mount),
  // the listener never recovers on its own — a real resubscribe is the only
  // way to try again once connectivity returns.
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    // firestore.rules gates /products reads on `request.auth != null`, and
    // this provider wraps the whole navigator — including Landing/Login/
    // Signup, which render before anyone has signed in. Subscribing on mount
    // therefore hit the rules unauthenticated and failed with
    // permission-denied. Gate on onAuthStateChanged instead (same pattern,
    // and same reasoning, as FavoritesContext): a plain one-time
    // auth.currentUser check wouldn't work either, since this provider never
    // remounts and so would never see the login that happens later.
    let unsubscribeProducts = () => {};

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      // Tear down the previous account's listener before starting the next,
      // so a logout -> login switch doesn't leave a stale one running.
      unsubscribeProducts();

      if (!user) {
        setProducts([]);
        setLoading(false);
        setError(null);
        unsubscribeProducts = () => {};
        return;
      }

      setLoading(true);
      setError(null);

      const productsQuery = query(
        collection(db, 'products'),
        orderBy('createdAt', 'desc')
      );

      // Live listener replaces the old manual loadProducts() call —
      // it fires immediately on subscribe and again on every change.
      unsubscribeProducts = onSnapshot(
        productsQuery,
        (snapshot) => {
          const productList = snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }));
          setProducts(productList);
          setLoading(false);
          setError(null);
        },
        (err) => {
          console.error('Error listening to products:', err.code, err.message);
          setError(err);
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeProducts();
    };
  }, [retryToken]);

  const retryFetchProducts = () => setRetryToken((t) => t + 1);

  const addProduct = async (productData) => {
    try {
      const docData = {
        name: productData.name,
        price: productData.price,
        type: productData.type,
        stock: productData.stock,
        description: productData.description || '',
        imageUrl: productData.imageUrl,
        colors: productData.colors || [],
        sizes: productData.sizes || [],
        createdAt: serverTimestamp(),
      };
      // Optional per-size measurement guide — omitted entirely (rather than
      // written as undefined, which addDoc rejects) when the admin didn't
      // fill any of it in. See constants/productOptions.js buildMeasurementsPayload.
      // measurementType only ever accompanies measurements (never written
      // alone), same as the caller's guarded spread in AdminAddProductScreen.
      if (productData.measurements) {
        docData.measurements = productData.measurements;
      }
      if (productData.measurementType) {
        docData.measurementType = productData.measurementType;
      }
      const docRef = await addDoc(collection(db, 'products'), docData);
      return { success: true, product: { id: docRef.id, ...productData } };
    } catch (error) {
      console.error('Error adding product:', error.code, error.message);
      return { success: false, error: error.message };
    }
  };

  const updateProduct = async (productId, updatedData) => {
    try {
      await updateDoc(doc(db, 'products', productId), updatedData);
      return { success: true };
    } catch (error) {
      console.error('Error updating product:', error.code, error.message);
      return { success: false, error: error.message };
    }
  };

  const deleteProduct = async (productId) => {
    try {
      await deleteDoc(doc(db, 'products', productId));
      return { success: true };
    } catch (error) {
      console.error('Error deleting product:', error.code, error.message);
      return { success: false, error: error.message };
    }
  };

  return (
    <ProductContext.Provider
      value={{
        products,
        loading,
        error,
        addProduct,
        updateProduct,
        deleteProduct,
        retryFetchProducts,
        // Kept for compatibility with any screen still calling this manually —
        // it's a no-op now since onSnapshot keeps `products` live automatically.
        refreshProducts: () => {},
      }}
    >
      {children}
    </ProductContext.Provider>
  );
};