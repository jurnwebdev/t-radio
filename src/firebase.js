// tradio-pwa/src/firebase.js
// Firebase config is loaded from environment variables (VITE_FIREBASE_*).
// For local dev, fill these in .env (gitignored).
// On Vercel, add them under Project → Settings → Environment Variables.
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAnalytics, logEvent } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

if (!firebaseConfig.apiKey || firebaseConfig.apiKey === 'undefined') {
  console.warn(
    '[T-Radio] Firebase env vars missing — set VITE_FIREBASE_* in .env or Vercel. ' +
    'Listener tracking will be disabled until they are set.'
  );
}

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

/* ---------- Firebase Analytics (visitor tracking) ---------- */
// GA4 measurementId is configured in the Firebase console.
// View visitors/sessions in: Firebase console -> Analytics.
let analytics = null;
try {
  analytics = getAnalytics(app);
} catch {
  analytics = null; // unsupported environment (no cookies, etc.)
}
export { analytics };

/**
 * Safely log a GA4 event. No-op if analytics is unavailable, so
 * tracking never breaks the player.
 */
export function logAppEvent(name, params = {}) {
  if (!analytics) return;
  try {
    logEvent(analytics, name, params);
  } catch {
    // never let analytics break playback
  }
}
