// context/AdminContext.jsx
import React, { createContext, useState, useContext, useEffect } from 'react';
import { auth, db } from '../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

const AdminContext = createContext();

export const useAdmin = () => useContext(AdminContext);

export const AdminProvider = ({ children }) => {
  const [isAdmin, setIsAdmin] = useState(false);
  // isAdmin starts false, but that's not the same as "confirmed not
  // admin" — on mount it's genuinely UNKNOWN until onAuthStateChanged
  // fires and (if there's a user) the Firestore role check resolves.
  // withAdminGuard must treat this as a distinct third state and hold
  // off redirecting while it's true, or it reproduces the exact bug
  // this fixes (bouncing a still-authenticated admin before their role
  // has actually been checked).
  const [adminLoading, setAdminLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setIsAdmin(false);
        setAdminLoading(false);
        return;
      }

      try {
        // Mirrors the exact checks AdminLoginScreen.js's handleLogin
        // performs: doc must exist, role must be 'admin', and the
        // account must not be explicitly deactivated. Deliberately NOT
        // mirroring AdminLoginScreen's auth.signOut()/Alert on failure,
        // though — this listener fires for EVERY signed-in user in the
        // app (regular customers included, since there's one shared
        // Firebase Auth instance), not just someone who just attempted
        // an admin login. Signing a customer out of their own account
        // just because they aren't an admin would be a serious bug in
        // its own right.
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);

        const isValidAdmin =
          userDocSnap.exists() &&
          userDocSnap.data().role === 'admin' &&
          userDocSnap.data().isActive !== false;

        setIsAdmin(isValidAdmin);
      } catch (error) {
        // A failed Firestore read must not leave the app stuck on
        // withAdminGuard's loading spinner forever — treat as not-admin
        // and let the guard redirect normally.
        console.error('Error restoring admin session:', error);
        setIsAdmin(false);
      } finally {
        setAdminLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Called by AdminLoginScreen.js only after it has already independently
  // verified role + isActive via its own getDoc — so it's safe to also
  // clear adminLoading here immediately, rather than making a fresh
  // manual login wait on this provider's own (redundant) listener-driven
  // check to catch up.
  const loginAsAdmin = () => {
    setIsAdmin(true);
    setAdminLoading(false);
  };

  const logoutAsAdmin = () => {
    setIsAdmin(false);
    setAdminLoading(false);
  };

  return (
    <AdminContext.Provider value={{
      isAdmin,
      adminLoading,
      loginAsAdmin,
      logoutAsAdmin,
    }}>
      {children}
    </AdminContext.Provider>
  );
};