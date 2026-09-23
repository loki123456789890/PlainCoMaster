// Import the functions you need from the SDKs you need
import { Platform } from "react-native";
import { initializeApp } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  browserLocalPersistence,
  getReactNativePersistence,
  connectAuthEmulator,
} from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCkJSzPnZOuE64ZjmtM2eTFQKSC85JlLsQ",
  authDomain: "plainco-c3edc.firebaseapp.com",
  projectId: "plainco-c3edc",
  storageBucket: "plainco-c3edc.firebasestorage.app",
  messagingSenderId: "67563837487",
  appId: "1:67563837487:web:eeb4c6bfd4534f3a414eda"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
// PlainCo ships iOS and Android; web is not a target and never will be
// without a real design pass. This branch exists for ONE reason: so the
// app can be opened in a browser and driven — screenshotted, clicked
// through, checked against the emulators — when verifying a change that
// only the running app can show.
//
// getReactNativePersistence lives only in the SDK's React Native build.
// Calling it under react-native-web throws "is not a function" at import
// time, which kills the bundle before a single screen renders — so the
// branch has to be here rather than anywhere later.
//
// Nothing about the native path changes: Platform.OS is 'ios' or
// 'android' on a device, and AsyncStorage persistence is selected exactly
// as before.
export const auth = Platform.OS === 'web'
  ? getAuth(app)
  : initializeAuth(app, {
      persistence: getReactNativePersistence(ReactNativeAsyncStorage)
    });
if (Platform.OS === 'web') {
  // getAuth() defaults to in-memory on web, so a reload would sign the
  // tester out mid-flow. Set explicitly rather than relying on a default.
  auth.setPersistence(browserLocalPersistence).catch(() => {});
}
export const db = getFirestore(app);
// Product photography. The bucket was already declared in the config
// above but never actually used — products took a pasted image URL — so
// nothing here initialised it. Governed by storage.rules.
export const storage = getStorage(app);
// Must match REGION in functions/index.js. A mismatch does not fail
// loudly — the SDK calls a URL in the region named here, and a function
// deployed elsewhere simply is not at it, so checkout would report
// "not-found" rather than anything about regions.
//
// asia-southeast1 because that is where this project's Firestore lives,
// and placeOrder reads several documents before writing.
export const functions = getFunctions(app, "asia-southeast1");
// LOCAL EMULATORS, opt-in and off by default.
//
// Why this exists: placeOrder is a Cloud Function, so the app exercises
// whatever is DEPLOYED, not what is in the working tree. Verifying a
// change to it by running the app meant either deploying to production
// first or not verifying at all — and the checkout path is the one place
// where "try it and see" against production writes real orders and
// decrements real stock.
//
// Guarded by an env var rather than __DEV__ so that ordinary development
// still talks to the real project, which is what everyone expects when
// they run `npm start`. Only `npm run start:emulator` opts in.
//
// EXPO_PUBLIC_ prefix is required — Expo inlines only that prefix into the
// client bundle, and a bare name would read as undefined here and silently
// leave the app pointed at production, which is the one failure this block
// must not have.
if (process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATOR === '1') {
  const host = process.env.EXPO_PUBLIC_EMULATOR_HOST || 'localhost';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectFunctionsEmulator(functions, host, 5001);
  connectStorageEmulator(storage, host, 9199);
  // Deliberately loud, and on every start. A session that thinks it is
  // talking to production while writing to an emulator wastes an
  // afternoon; a session told otherwise loses one line of console.
  console.warn(
    `[PlainCo] Firebase EMULATORS at ${host} — auth:9099 firestore:8080 functions:5001 storage:9199. No production data is being read or written.`
  );
}
