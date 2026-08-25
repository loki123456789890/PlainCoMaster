// A navigation handle for code that runs outside the navigator.
//
// Screens get `navigation` as a prop and should keep using it — this is not
// a general-purpose shortcut, and reaching for it from a screen means
// giving up the type-checking and the scoping that come with the prop.
//
// It exists for exactly one caller: AdminContext, which detects that an
// account has been deactivated and has to send the user back to Landing.
// AdminProvider is mounted ABOVE NavigationContainer in App.js (it has to
// be — ProductProvider and CartProvider read the role, and they wrap the
// navigator too), so it has no navigation prop and no useNavigation() to
// call. Signing someone out without this would leave them sitting on
// whatever screen they were on, now signed out, with every read failing.
//
// isReady() matters: navigation actions dispatched before the container has
// mounted are dropped silently. Deactivation can be observed during the
// very first snapshot after a cold start, which is exactly when that race
// is live, so every call here has to be guarded.
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

// Sends the user back to the first screen, clearing history so Back cannot
// return them to a signed-in screen they no longer have access to. Returns
// false when the container is not mounted yet, so the caller can decide
// whether that is worth reporting.
export function resetToLanding() {
  if (!navigationRef.isReady()) return false;
  navigationRef.reset({ index: 0, routes: [{ name: 'Landing' }] });
  return true;
}
