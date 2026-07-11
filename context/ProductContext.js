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
import { db } from '../firebaseConfig';

const ProductContext = createContext();

export const useProducts = () => useContext(ProductContext);

export const ProductProvider = ({ children }) => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const productsQuery = query(
      collection(db, 'products'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
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

    // Live listener replaces the old manual loadProducts() call —
    // it fires immediately on mount and again on every change.
    return () => unsubscribe();
  }, []);

  const addProduct = async (productData) => {
    try {
      const docRef = await addDoc(collection(db, 'products'), {
        name: productData.name,
        price: productData.price,
        type: productData.type,
        stock: productData.stock,
        description: productData.description || '',
        imageUrl: productData.imageUrl,
        createdAt: serverTimestamp(),
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
        // Kept for compatibility with any screen still calling this manually —
        // it's a no-op now since onSnapshot keeps `products` live automatically.
        refreshProducts: () => {},
      }}
    >
      {children}
    </ProductContext.Provider>
  );
};