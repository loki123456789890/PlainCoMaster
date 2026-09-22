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
import { useAdmin } from './AdminContext';

const ProductContext = createContext();

export const useProducts = () => useContext(ProductContext);

// A FieldValue (deleteField(), serverTimestamp(), …) is a request rather
// than a value: it exposes isEqual() and carries no data of its own, so
// comparing it against a stored value always reports a difference.
const isFieldValueSentinel = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof value.isEqual === 'function';

const stableStringify = (value) => {
  try {
    // Normalised so an absent field and an explicit undefined compare
    // equal rather than throwing the diff off.
    return JSON.stringify(value ?? null);
  } catch {
    return undefined;
  }
};

// Which keys in an update actually differ from the document it targets.
// Used only for the activity log's summary line.
//
// Two shapes need care:
//
//   - deleteField() sentinels. AdminEditProductScreen always sends
//     `measurements: payload || deleteField()`, so a product that has
//     never carried a size guide receives a delete request on every save.
//     That is only a real change when the field is actually there.
//
//   - colors, sizes and measurements are arrays and maps, so comparing
//     by reference would call every save a change. Compared by their JSON
//     form, which is stable here because the form builds both from plain
//     strings in a fixed order.
//
// Falls back to naming every key when the previous document isn't in
// local state: an honest "everything, we couldn't tell" beats a summary
// that quietly claims nothing changed.
function diffChangedKeys(previous, updatedData) {
  const keys = Object.keys(updatedData);
  if (!previous) return keys;

  return keys.filter((key) => {
    const next = updatedData[key];
    if (isFieldValueSentinel(next)) return previous[key] !== undefined;
    return stableStringify(previous[key]) !== stableStringify(next);
  });
}

export const ProductProvider = ({ children }) => {
  // The signed-in Store Manager's store. Every new product is stamped with
  // it, and firestore.rules refuses a create whose storeId is not the
  // caller's own, so it is taken from AdminContext (the manager's own user
  // document) rather than from anything a screen passes in.
  const { storeId } = useAdmin();
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
    // Refused here with a sentence a manager can act on, rather than
    // sent to the rules to come back as "insufficient permissions".
    if (!storeId) {
      return { success: false, error: 'NO_STORE' };
    }
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
        storeId,
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
    // Captured BEFORE the write, while local state still holds the old
    // document — the onSnapshot listener replaces it moments later.
    const previous = products.find((p) => p.id === productId);

    try {
      await updateDoc(doc(db, 'products', productId), updatedData);
      // Names the fields that changed rather than dumping their values:
      // "who touched what, and when" is what the SRS asks the log to
      // answer, and a full before/after diff of every product edit would
      // bury that under noise.
      //
      // Diffed against the previous document rather than taken from
      // Object.keys(updatedData), which is what this used to do. The sole
      // caller — AdminEditProductScreen — sends the WHOLE document on
      // every save, deliberately, because that is what migrates a legacy
      // string price/stock to a number and what lets the rules validate
      // the merged result. So "changed" listed all ten fields on every
      // edit regardless of what was touched, and the log's most useful
      // column was noise. Correcting it here keeps the full-document
      // write intact.
      const changed = diffChangedKeys(previous, updatedData).join(', ');
      const label = updatedData.name || previous?.name || productId;
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