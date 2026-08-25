// context/AdminContext.jsx
import React, { createContext, useState, useContext, useEffect, useRef, useCallback } from 'react';
import { auth, db } from '../firebaseConfig';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { showAppAlert } from '../utils/appAlert';
import { resetToLanding } from '../navigationRef';

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
  // there's a user) the Firestore role check resolves. withRoleGuard must
  // treat this as a distinct third state and hold off redirecting while
  // it's true, or it reproduces the exact bug this fixes (bouncing a
  // still-authenticated seller/platformAdmin before their role has
  // actually been checked).
  const [adminLoading, setAdminLoading] = useState(true);
  // Whether this account is usable at all, which is a DIFFERENT question
  // from what role it has, and the reason it needs its own state.
  // resolvePrivilegedRole() deliberately collapses "no document",
  // "unrecognized role" and "deactivated" into one null, because for the
  // role question those three really are the same answer. For revocation
  // they are not: only the third means "sign this person out", and the
  // other two describe ordinary customers.
  //
  // null = unknown (signed out, still resolving, or the read failed),
  // true = confirmed usable, false = confirmed deactivated.
  const [accountActive, setAccountActive] = useState(null);
  // Has onAuthStateChanged fired even once? Distinct from "is there a
  // user", and the distinction is the whole reason this exists: on a cold
  // start with a persisted session, Firebase restores auth asynchronously,
  // so for the first moments signedIn is false because nothing has been
  // checked yet — not because nobody is signed in. LandingScreen has to
  // wait through that rather than treat it as a signed-out visitor and
  // show the marketing screen to someone who has an account.
  const [authChecked, setAuthChecked] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  // Guards against acting twice. onSnapshot fires again for any later edit
  // to the document, and signing out itself churns state — without this a
  // deactivated user could be shown the notice more than once.
  const revocationHandled = useRef(false);

  // Signs a deactivated account out and says why.
  //
  // Declared above the effect that calls it, and wrapped in useCallback so
  // its identity is stable: the effect subscribes to Firestore, so a
  // function that changed on every render would tear down and rebuild that
  // listener each time it appeared in the dependency array.
  //
  // Order matters inside: the flag is set BEFORE the await, because
  // signOut() synchronously triggers onAuthStateChanged, which would
  // otherwise race this function and let a second snapshot through.
  //
  // The notice is shown AFTER signing out rather than before, so the
  // account is already closed by the time anyone reads it — the message is
  // a courtesy, not a confirmation, and there is no path through it back
  // into staying signed in.
  const revokeSession = useCallback(async () => {
    if (revocationHandled.current) return;
    revocationHandled.current = true;

    try {
      await signOut(auth);
    } catch (error) {
      // Nothing useful to do — the notice still needs to appear, and the
      // rules deny this account's writes regardless of what the client
      // believes about its own auth state.
      console.error('Error signing out a deactivated account:', error);
    }

    // Navigate BEFORE the notice, and do not hang the navigation off the
    // alert's button.
    //
    // AppAlertHost is a Modal with onRequestClose, so Android's back
    // gesture dismisses it without running any button's onPress. Putting
    // resetToLanding() on the OK handler meant a customer who pressed Back
    // instead of OK stayed on whatever screen they were on — signed out,
    // looking at stale data, every read failing. That is the exact
    // experience this whole listener was built to replace, reachable by
    // the more natural of the two gestures.
    //
    // Resetting first makes the outcome independent of how the notice is
    // dismissed. The alert renders above the navigator rather than inside
    // it, so it survives the reset and is read on Landing.
    resetToLanding();

    // NOT the only place this message can come from, deliberately.
    // Loginscreen and AdminLoginScreen each check isActive right after
    // authenticating and refuse the sign-in there, which this does not
    // replace: without their check a deactivated account would reach Home
    // and be bounced a moment later, once this listener's first snapshot
    // arrived. They are the fast path; this is the one that covers a
    // session already in progress.
    //
    // The two can race on a fresh sign-in. That is harmless — AppAlertHost
    // shows one alert at a time, both messages say the same thing, and
    // both paths sign out. Resist collapsing them into one: dropping the
    // screens' check reintroduces the flash of Home, and dropping this one
    // reopens mid-session revocation entirely.
    showAppAlert(
      'Account Deactivated',
      'This account has been deactivated, so you have been signed out. Please contact support if you believe this is a mistake.',
      [{ text: 'OK' }]
    );
  }, []);

  // Called by ProfileScreen immediately BEFORE it writes isActive: false
  // on the user's own document.
  //
  // Self-deactivation writes exactly what an admin deactivation writes, so
  // the listener above cannot tell the two apart — and without this it
  // would greet someone who had just deliberately closed their own account
  // with "this account has been deactivated, contact support if you
  // believe this is a mistake". They know. They did it. ProfileScreen runs
  // its own sign-out and its own reset to Landing, so the whole revocation
  // path is redundant there, not just the wording.
  //
  // Claiming the same one-shot flag the listener checks is what makes this
  // work, and it must happen before the write rather than after: the
  // snapshot can arrive while the updateDoc promise is still pending.
  const acknowledgeSelfDeactivation = useCallback(() => {
    revocationHandled.current = true;
  }, []);

  useEffect(() => {
    // Two subscriptions, nested: auth state, and then the signed-in user's
    // own document. The inner one has to be torn down and rebuilt whenever
    // the user changes, or a listener on the previous account's document
    // outlives the session that was allowed to read it.
    let unsubscribeUserDoc = null;

    const stopWatchingUserDoc = () => {
      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
        unsubscribeUserDoc = null;
      }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      stopWatchingUserDoc();
      setAuthChecked(true);
      setSignedIn(Boolean(user));

      if (!user) {
        setRole(null);
        setAccountActive(null);
        setAdminLoading(false);
        // Cleared so the NEXT person to sign in on this device can be
        // revoked too. Safe to reset here because there is no user to act
        // on until a new one arrives.
        revocationHandled.current = false;
        return;
      }

      // WAS A ONE-SHOT getDoc, now a live subscription. The read was
      // already correct on every cold start; what it could not do was
      // notice a change DURING a session. A Store Manager deactivated
      // while their app was open kept every admin screen until they
      // restarted, and firestore.rules would deny their writes — so the
      // experience of being deactivated was a string of unexplained
      // permission errors rather than being told.
      //
      // Still re-verified against Firestore, never trusted from a cached
      // or client-supplied value.
      unsubscribeUserDoc = onSnapshot(
        doc(db, 'users', user.uid),
        (snapshot) => {
          setRole(resolvePrivilegedRole(snapshot));

          // A document that does not exist is NOT a deactivated account.
          // It is the gap between creating an auth user and writing the
          // user doc at signup, and treating it as revocation would sign
          // people out of accounts they had just created.
          const active = snapshot.exists()
            ? snapshot.data().isActive !== false
            : null;
          setAccountActive(active);
          setAdminLoading(false);

          if (active === false) revokeSession();
        },
        (error) => {
          // A failed read must not leave the app stuck on withRoleGuard's
          // loading spinner — fail closed on the ROLE and let the guard
          // redirect normally.
          //
          // But it must NOT fail closed on accountActive. An error is not
          // a deactivation: offline, a rules change, a transient backend
          // problem all land here, and signing someone out mid-checkout
          // over a dropped connection would be a far worse bug than the
          // one this listener fixes. Unknown stays unknown.
          console.error('Error watching account status:', error);
          setRole(null);
          setAccountActive(null);
          setAdminLoading(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      stopWatchingUserDoc();
    };
  }, [revokeSession]);

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
      // Exposed for the deferred Landing work: a persisted session cannot
      // safely be auto-routed past Landing without knowing whether the
      // account behind it is still usable, and this is that answer.
      // Consumers must treat null as "not known yet", never as "inactive".
      accountActive,
      authChecked,
      signedIn,
      acknowledgeSelfDeactivation,
      loginAsAdmin,
      logoutAsAdmin,
    }}>
      {children}
    </AdminContext.Provider>
  );
};
