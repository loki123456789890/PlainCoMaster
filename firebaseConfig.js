// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
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
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(ReactNativeAsyncStorage)
});
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