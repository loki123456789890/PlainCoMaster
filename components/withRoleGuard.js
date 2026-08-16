import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAdmin } from '../context/AdminContext';

// Wraps a privileged screen so it can only ever render for someone whose
// AdminContext role is one of allowedRoles — which only ever gets set via a
// verified Firebase Auth + Firestore role check (see AdminContext's
// onAuthStateChanged listener and loginAsAdmin()), never from anything
// cached client-side.
//
// allowedRoles defaults to both privileged roles ("seller",
// "platformAdmin") so every call site that hasn't been updated yet to name
// a specific role keeps guarding exactly as it did before the role split —
// per-role screen reassignment happens in a later step, not here. Pass a
// single role string or an array of role strings to narrow it.
//
// This is a UI-level guard, not the actual security boundary — Firestore
// rules already block a role's reads/writes it isn't entitled to,
// regardless of what this does. Its job is narrower: stop the guarded
// screen shell itself from rendering for someone who reached the route
// without the right role, e.g. a stray navigate() call from unrelated
// code, or a future deep link.
const DEFAULT_ALLOWED_ROLES = ['seller', 'platformAdmin'];

export default function withRoleGuard(ScreenComponent, allowedRoles = DEFAULT_ALLOWED_ROLES) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return function GuardedScreen(props) {
    const { role, adminLoading } = useAdmin();
    const { navigation } = props;
    // role is null while unresolved AND when confirmed unprivileged — the
    // adminLoading check below is what tells these two apart.
    const isAllowed = role !== null && roles.includes(role);

    useEffect(() => {
      // Don't redirect until AdminContext's persisted-session check has
      // actually resolved — redirecting while adminLoading is still true
      // is exactly the bug this guards against (bouncing a
      // still-authenticated seller/platformAdmin before their role has
      // been confirmed).
      if (adminLoading) return;
      if (!isAllowed) {
        navigation.replace('AdminLogin');
      }
    }, [isAllowed, adminLoading]);

    // Same loading view for both "still checking" and "confirmed not
    // allowed, waiting for the redirect above to take effect" — matches
    // the original guard's behavior for the latter case exactly. Never
    // render the guarded screen optimistically while the role is
    // unresolved.
    if (adminLoading || !isAllowed) {
      return (
        <View style={styles.container}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      );
    }

    return <ScreenComponent {...props} />;
  };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});
