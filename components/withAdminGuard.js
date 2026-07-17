import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useAdmin } from '../context/AdminContext';

// Wraps an admin screen so it can only ever render for someone whose
// AdminContext isAdmin flag is true — which only ever becomes true via
// AdminLoginScreen's verified Firebase Auth + Firestore role check.
//
// This is a UI-level guard, not the actual security boundary — Firestore
// rules already block a non-admin's reads/writes regardless of what this
// does. Its job is narrower: stop the admin screen shell itself from
// rendering for someone who reached the route without going through
// login, e.g. a stray navigate() call from unrelated code, or a future
// deep link.
export default function withAdminGuard(ScreenComponent) {
  return function GuardedScreen(props) {
    const { isAdmin, adminLoading } = useAdmin();
    const { navigation } = props;

    useEffect(() => {
      // Don't redirect until AdminContext's persisted-session check has
      // actually resolved — redirecting while adminLoading is still true
      // is exactly the bug this guards against (bouncing a
      // still-authenticated admin before their role has been confirmed).
      if (adminLoading) return;
      if (!isAdmin) {
        navigation.replace('AdminLogin');
      }
    }, [isAdmin, adminLoading]);

    // Same loading view for both "still checking" and "confirmed not
    // admin, waiting for the redirect above to take effect" — matches
    // the original guard's behavior for the latter case exactly.
    if (adminLoading || !isAdmin) {
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