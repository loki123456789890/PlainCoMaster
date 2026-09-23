// utils/splashHandoff.js
//
// The launch splash and the Landing screen share one moment: the splash's
// logo lockup glides up and becomes Landing's header, and Landing's copy
// animates in under it on the splash's clock. They live in different
// parts of the tree (the splash is an overlay in App.js, Landing is a
// screen in the navigator), so this module is where they agree on:
//
//   - when the splash started, so Landing can time its entrance from it;
//   - whether Landing is actually showing its content — a signed-in user
//     skips Landing for Home, and then the lockup has nowhere to go, so
//     the splash fades instead of gliding;
//   - when the splash is gone, so Landing can show its own copy of the
//     lockup in the same frame the overlay's copy disappears.

let startedAt = null;
let active = true;
let landingReady = false;
const finishListeners = new Set();

export const splashHandoff = {
  markStarted() {
    startedAt = Date.now();
  },
  // Milliseconds since the splash animation began, or null if it never ran.
  elapsed() {
    return startedAt === null ? null : Date.now() - startedAt;
  },
  isActive() {
    return active;
  },
  setLandingReady(ready) {
    landingReady = ready;
  },
  isLandingReady() {
    return landingReady;
  },
  finish() {
    if (!active) return;
    active = false;
    finishListeners.forEach((listener) => listener());
    finishListeners.clear();
  },
  onFinish(listener) {
    if (!active) {
      listener();
      return () => {};
    }
    finishListeners.add(listener);
    return () => finishListeners.delete(listener);
  },
};
