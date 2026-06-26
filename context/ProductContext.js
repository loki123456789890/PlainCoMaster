import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ProductContext = createContext();

export const useProducts = () => useContext(ProductContext);

export const ProductProvider = ({ children }) => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Default products matching your shop screen
  const defaultProducts = [
    { 
      id: '1', 
      name: 'T-shirt', 
      price: '43.99', 
      type: 'ready-to-wear',
      stock: '50',
      description: 'Comfortable cotton t-shirt',
      imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=880&auto=format&fit=crop' 
    },
    { 
      id: '2', 
      name: 'Blouson Jacket', 
      price: '6.99', 
      type: 'ukay-ukay',
      stock: '15',
      description: 'Vintage thrifted jacket',
      imageUrl: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?q=80&w=736&auto=format&fit=crop' 
    },
    { 
      id: '3', 
      name: 'Sandals', 
      price: '45.99', 
      type: 'ready-to-wear',
      stock: '30',
      description: 'Comfortable summer sandals',
      imageUrl: 'https://plus.unsplash.com/premium_photo-1676234844384-82e1830af724?q=80&w=688&auto=format&fit=crop' 
    },
    { 
      id: '4', 
      name: 'Converse Shoes', 
      price: '35.99', 
      type: 'ukay-ukay',
      stock: '8',
      description: 'Classic Converse sneakers',
      imageUrl: 'https://images.unsplash.com/photo-1680204101574-dea570724119?q=80&w=687&auto=format&fit=crop' 
    },
    { 
      id: '5', 
      name: 'Dress', 
      price: '55.99', 
      type: 'ready-to-wear',
      stock: '25',
      description: 'Elegant floral dress',
      imageUrl: 'https://plus.unsplash.com/premium_photo-1676236306466-25ba882070b3?q=80&w=688&auto=format&fit=crop' 
    },
    { 
      id: '6', 
      name: 'Hat', 
      price: '95.00', 
      type: 'ukay-ukay',
      stock: '12',
      description: 'Stylish vintage hat',
      imageUrl: 'https://plus.unsplash.com/premium_photo-1680859126205-1c593bb4f9e8?q=80&w=687&auto=format&fit=crop' 
    },
  ];

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    try {
      const storedProducts = await AsyncStorage.getItem('products');
      if (storedProducts) {
        setProducts(JSON.parse(storedProducts));
      } else {
        setProducts(defaultProducts);
        await AsyncStorage.setItem('products', JSON.stringify(defaultProducts));
      }
    } catch (error) {
      console.error('Error loading products:', error);
      setProducts(defaultProducts);
    } finally {
      setLoading(false);
    }
  };

  const addProduct = async (productData) => {
    try {
      const newProduct = {
        id: Date.now().toString(),
        name: productData.name,
        price: productData.price,
        type: productData.type,
        stock: productData.stock,
        description: productData.description || '',
        imageUrl: productData.imageUrl,
        createdAt: new Date().toISOString(),
      };
      
      const updatedProducts = [...products, newProduct];
      setProducts(updatedProducts);
      await AsyncStorage.setItem('products', JSON.stringify(updatedProducts));
      return { success: true, product: newProduct };
    } catch (error) {
      console.error('Error adding product:', error);
      return { success: false, error: error.message };
    }
  };

  const updateProduct = async (productId, updatedData) => {
    try {
      const updatedProducts = products.map(product =>
        product.id === productId ? { ...product, ...updatedData } : product
      );
      setProducts(updatedProducts);
      await AsyncStorage.setItem('products', JSON.stringify(updatedProducts));
      return { success: true };
    } catch (error) {
      console.error('Error updating product:', error);
      return { success: false, error: error.message };
    }
  };

  const deleteProduct = async (productId) => {
    try {
      const updatedProducts = products.filter(product => product.id !== productId);
      setProducts(updatedProducts);
      await AsyncStorage.setItem('products', JSON.stringify(updatedProducts));
      return { success: true };
    } catch (error) {
      console.error('Error deleting product:', error);
      return { success: false, error: error.message };
    }
  };

  return (
    <ProductContext.Provider value={{
      products,
      loading,
      addProduct,
      updateProduct,
      deleteProduct,
      refreshProducts: loadProducts,
    }}>
      {children}
    </ProductContext.Provider>
  );
};