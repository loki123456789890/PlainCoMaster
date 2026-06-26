import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FavoritesContext = createContext();

export const useFavorites = () => useContext(FavoritesContext);

export const FavoritesProvider = ({ children }) => {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    try {
      const storedFavorites = await AsyncStorage.getItem('favorites');
      if (storedFavorites) {
        setFavorites(JSON.parse(storedFavorites));
      }
    } catch (error) {
      console.error('Error loading favorites:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleFavorite = async (product) => {
    try {
      const exists = favorites.some(item => item.id === product.id);
      let newFavorites;
      
      if (exists) {
        // Remove from favorites
        newFavorites = favorites.filter(item => item.id !== product.id);
      } else {
        // Add to favorites
        newFavorites = [...favorites, product];
      }
      
      setFavorites(newFavorites);
      await AsyncStorage.setItem('favorites', JSON.stringify(newFavorites));
      return { success: true, isFavorite: !exists };
    } catch (error) {
      console.error('Error toggling favorite:', error);
      return { success: false, error: error.message };
    }
  };

  const isFavorite = (productId) => {
    return favorites.some(item => item.id === productId);
  };

  return (
    <FavoritesContext.Provider value={{
      favorites,
      loading,
      toggleFavorite,
      isFavorite,
      refreshFavorites: loadFavorites,
    }}>
      {children}
    </FavoritesContext.Provider>
  );
};