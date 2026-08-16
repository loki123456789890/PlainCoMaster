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
import { logStoreActivity, ACTIONS } from '../utils/activityLog';

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
      // Not awaited: the product exists at this point, so the caller's
      // success path shouldn't wait on (or fail with) the log write.
      logStoreActivity({
        action: ACTIONS.PRODUCT_CREATED,
        targetId: docRef.id,
        targetLabel: productData.name,
        summary: `Added product "${productData.name}"`,
      });
      return { success: true, product: { id: docRef.id, ...productData } };
    } catch (error) {
      console.error('Error adding product:', error.code, error.message);
      return { success: false, error: error.message };
    }
  };

  const updateProduct = async (productId, updatedData) => {
    try {
      await updateDoc(doc(db, 'products', productId), updatedData);
      // Names the fields that changed rather than dumping their values:
      // "who touched what, and when" is what the SRS asks the log to
      // answer, and a full before/after diff of every product edit would
      // bury that under noise. updatedData carries deleteField() sentinels
      // for cleared optional fields, so only the keys are meaningful here.
      const changed = Object.keys(updatedData).join(', ');
      const label = updatedData.name || products.find((p) => p.id === productId)?.name || productId;
      logStoreActivity({
        action: ACTIONS.PRODUCT_UPDATED,
        targetId: productId,
        targetLabel: label,
        summary: `Edited "${label}"${changed ? ` — changed ${changed}` : ''}`,
      });
      return { success: true };
    } catch (error) {
      console.error('Error updating product:', error.code, error.message);
      return { success: false, error: error.message };
    }
  };

  const deleteProduct = async (productId) => {
    // Resolved before the delete, not after: once the document is gone the
    // local list drops it too, and the log entry would be left naming a
    // bare id. The id is kept as a fallback so an entry is still written
    // even if the product was never in local state.
    const label = products.find((p) => p.id === productId)?.name || productId;
    try {
      await deleteDoc(doc(db, 'products', productId));
      logStoreActivity({
        action: ACTIONS.PRODUCT_DELETED,
        targetId: productId,
        targetLabel: label,
        summary: `Deleted product "${label}"`,
      });
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