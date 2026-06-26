// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
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