// tradio-pwa/src/firebase.js
// Firebase config is loaded from environment variables (VITE_FIREBASE_*).
// For local dev, fill these in .env (gitignored).
// On Vercel, add them under Project → Settings → Environment Variables,
// then REDEPLOY (env vars are inlined at build time by Vite).
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

// Vite inlines these as `undefined` (or the literal string "undefined")
// when the env vars were not set at build time.
const missingVars = Object.entries(firebaseConfig)
  .filter(([k, v]) => !v || v === "undefined")
  .map(([k]) => k);

const firebaseReady = missingVars.length === 0;

if (!firebaseReady) {
  console.warn(
    `[T-Radio] Firebase not initialised — missing: ${missingVars.join(', ')}. ` +
    'Set VITE_FIREBASE_* env vars and REDEPLOY. The app still works, ' +
    'but listener tracking is disabled.'
  );
}

let app = null;
let analytics = null;
if (firebaseReady) {
  app = initializeApp(firebaseConfig);
  try {
    analytics = getAnalytics(app);
  } catch {
    analytics = null; // analytics unavailable in this environment
  }
}
export { app, analytics, firebaseReady };

export const db = firebaseReady ? getDatabase(app) : null;

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
