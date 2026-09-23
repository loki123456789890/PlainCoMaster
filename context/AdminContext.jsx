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

// The store a Store Manager runs, or null. Only a seller has one, and only
// a string counts — the same test managesStore() makes in firestore.rules,
// so the UI and the rules agree on who is "assigned to nothing".
function resolveStoreId(userDocSnap, resolvedRole) {
  if (resolvedRole !== 'seller') return null;
  const storeId = userDocSnap.data().storeId;
  return typeof storeId === 'string' && storeId ? storeId : null;
}

export const AdminProvider = ({ children }) => {
  // role is null while unauthenticated, while still resolving, for an
  // unrecognized/missing role, or for a deactivated account — see
  // resolvePrivilegedRole(). It is never anything other than null,
  // "seller", or "platformAdmin".
  const [role, setRole] = useState(null);
  // Which store a seller runs; null for everyone else, and for a seller
  // promoted before stores existed. Product writes need it, and the rules
  // refuse them without it — see resolveStoreId().
  const [storeId, setStoreId] = useState(null);
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
    // The two used to race on a fresh sign-in, and this one usually won —
    // bouncing to Landing before Loginscreen could show its own notice in
    // the form. Loginscreen now holds this path for the few hundred ms of
    // its check (holdRevocationForSignIn below). Resist collapsing them into
    // one: dropping the screens' check reintroduces the flash of Home, and
    // dropping this one reopens mid-session revocation entirely.
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

  // Called by Loginscreen just BEFORE it signs in; returns the release.
  //
  // While a sign-in is being checked, Loginscreen is the one that refuses a
  // deactivated account — it signs out and says so in the form, where the
  // person is looking. Without the hold, this listener's first snapshot
  // usually won the race and reset to Landing mid-check, so the notice
  // appeared on a different screen from the one they had just used.
  //
  // Same one-shot flag as acknowledgeSelfDeactivation, but only for the
  // check: Loginscreen releases it once the account is let through, so a
  // deactivation later in the session is still revoked. A refused sign-in
  // signs out, which clears the flag anyway.
  const holdRevocationForSignIn = useCallback(() => {
    revocationHandled.current = true;
    return () => {
      revocationHandled.current = false;
    };
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
        setStoreId(null);
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
          const resolvedRole = resolvePrivilegedRole(snapshot);
          setRole(resolvedRole);
          setStoreId(resolveStoreId(snapshot, resolvedRole));

          // A document that does not exist is NOT a deactivated account.
          // It is the gap between creating an auth user and writing the
          // user doc at signup, and treating it as revocation would sign
          // people out of accounts they had just created.
          const active = snapshot.exists()
            ? snapshot.data().isActive !== false
            : null;
          setAccountActive(active);
          setAdminLoading(false);

          // REVOKE ONLY ON A SERVER-CONFIRMED SNAPSHOT.
          //
          // onSnapshot fires immediately from Firestore's local cache
          // before the server answers — latency compensation — and that
          // cache belongs to the Firestore instance, so it OUTLIVES a
          // sign-out. Without this check the sequence was:
          //
          //   1. account deactivated, revoked correctly, signed out
          //   2. the cache still holds isActive: false
          //   3. an admin reactivates the account
          //   4. the customer signs in — and the fresh listener's first
          //      snapshot is the stale cached one, so they are signed
          //      straight back out again
          //
          // A reactivated account could not log in at all until the app
          // was killed and relaunched, which empties the cache. Restarting
          // Metro "fixed" it, which is what made it look like a tooling
          // problem rather than this.
          //
          // Same principle as the error handler below: revocation is
          // destructive and irreversible from the user's side, so it acts
          // only on a fact the server has confirmed. A cached value is not
          // a confirmation, exactly as an error is not a deactivation.
          //
          // Note this gates ONLY the revocation. role and accountActive
          // still update from cache, because being fast and occasionally
          // stale is right for rendering and wrong for ejecting someone.
          if (active === false && !snapshot.metadata.fromCache) revokeSession();
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
          setStoreId(null);
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
    setStoreId(null);
    setAdminLoading(false);
  };

  const isSeller = role === 'seller';
  const isPlatformAdmin = role === 'platformAdmin';

  return (
    <AdminContext.Provider value={{
      role,
      storeId,
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
      holdRevocationForSignIn,
      loginAsAdmin,
      logoutAsAdmin,
    }}>
      {children}
    </AdminContext.Provider>
  );
};
