// context/AdminContext.jsx
import React, { createContext, useState, useContext } from 'react';

const AdminContext = createContext();

export const useAdmin = () => useContext(AdminContext);

export const AdminProvider = ({ children }) => {
  const [isAdmin, setIsAdmin] = useState(false);

  const loginAsAdmin = () => setIsAdmin(true);
  const logoutAsAdmin = () => setIsAdmin(false);

  return (
    <AdminContext.Provider value={{
      isAdmin,
      loginAsAdmin,
      logoutAsAdmin,
    }}>
      {children}
    </AdminContext.Provider>
  );
};