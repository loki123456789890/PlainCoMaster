// context/AdminContext.jsx
import React, { createContext, useState, useContext, useEffect } from 'react';
import { auth, db } from '../firebaseConfig';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

const AdminContext = createContext();

export const useAdmin = () => useContext(AdminContext);

// The two privileged roles. Anything else — "customer", a missing role
// field, a typo, a role invented after this file was last touched — is
// unprivileged. See resolvePrivilegedRole() below; this array is the only
// place that should ever change to add a role.
const PRIVILEGED_ROLES = ['seller', 'platformAdmin'];

// Reduces a Firestore user doc snapshot down to the one shape the rest of
// the app is allowed to trust: either a known privileged role string, or
// null. This is the fail-closed boundary — anything that isn't
// unambiguously "seller" or "platformAdmin" AND active becomes null, never
// passed through as-is. A missing doc, a missing/unrecognized role, and a
// deactivated account (isActive === false) all collapse to the same null.
function resolvePrivilegedRole(userDocSnap) {
  if (!userDocSnap.exists()) return null;
  const data = userDocSnap.data();
  if (data.isActive === false) return null;
  return PRIVILEGED_ROLES.includes(data.role) ? data.role : null;
}

export const AdminProvider = ({ children }) => {
  // role is null while unauthenticated, while still resolving, for an
  // unrecognized/missing role, or for a deactivated account — see
  // resolvePrivilegedRole(). It is never anything other than null,
  // "seller", or "platformAdmin".
  const [role, setRole] = useState(null);
  // role starts null, but that's not the same as "confirmed unprivileged" —
  // on mount it's genuinely UNKNOWN until onAuthStateChanged fires and (if
  // there's a user) the Firestore role check resolves. withAdminGuard must
  // treat this as a distinct third state and hold off redirecting while
  // it's true, or it reproduces the exact bug this fixes (bouncing a
  // still-authenticated seller/platformAdmin before their role has
  // actually been checked).
  const [adminLoading, setAdminLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setRole(null);
        setAdminLoading(false);
        return;
      }

      try {
        // Re-verifies role + isActive against Firestore on every cold
        // start / auth state change — never trusts a cached or
        // client-supplied role. Deliberately NOT signing the user out or
        // alerting on an unprivileged result, though — this listener
        // fires for EVERY signed-in user in the app (regular customers
        // included, since there's one shared Firebase Auth instance), not
        // just someone who just attempted a privileged login. Signing a
        // customer out of their own account just because they aren't
        // privileged would be a serious bug in its own right.
        const userDocRef = doc(db, 'users', user.uid);
        const userDocSnap = await getDoc(userDocRef);

        setRole(resolvePrivilegedRole(userDocSnap));
      } catch (error) {
        // A failed Firestore read must not leave the app stuck on
        // withAdminGuard's loading spinner forever — fail closed and let
        // the guard redirect normally.
        console.error('Error restoring admin session:', error);
        setRole(null);
      } finally {
        setAdminLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Called by a screen that has already independently verified role +
  // isActive via its own getDoc — so it's safe to also clear adminLoading
  // here immediately, rather than making a fresh manual login wait on this
  // provider's own (redundant) listener-driven check to catch up.
  // nextRole must be a value the caller already confirmed via Firestore;
  // fails closed to null (unprivileged) if it isn't one of
  // PRIVILEGED_ROLES, even if a caller passes something else by mistake.
  const loginAsAdmin = (nextRole) => {
    setRole(PRIVILEGED_ROLES.includes(nextRole) ? nextRole : null);
    setAdminLoading(false);
  };

  const logoutAsAdmin = () => {
    setRole(null);
    setAdminLoading(false);
  };

  const isSeller = role === 'seller';
  const isPlatformAdmin = role === 'platformAdmin';

  return (
    <AdminContext.Provider value={{
      role,
      isSeller,
      isPlatformAdmin,
      adminLoading,
      loginAsAdmin,
      logoutAsAdmin,
    }}>
      {children}
    </AdminContext.Provider>
  );
};
