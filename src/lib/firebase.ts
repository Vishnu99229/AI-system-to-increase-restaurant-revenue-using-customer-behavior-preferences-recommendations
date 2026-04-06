import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";

/**
 * Centralized Firebase configuration guard.
 *
 * Reads env vars, validates them, and only initializes Firebase if ALL
 * required values are present. When Firebase is not configured, the app
 * boots normally with phone auth disabled — no crashes, no white screens.
 */

const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;

const isConfigValid =
    typeof apiKey === "string" && apiKey.length > 0 &&
    typeof authDomain === "string" && authDomain.length > 0 &&
    typeof projectId === "string" && projectId.length > 0;

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;

if (isConfigValid) {
    firebaseApp = initializeApp({ apiKey, authDomain, projectId });
    firebaseAuth = getAuth(firebaseApp);
} else {
    console.warn(
        "Firebase not configured. Phone auth disabled. " +
        "Set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID in .env to enable."
    );
}

/** true when Firebase was successfully initialized */
export const isFirebaseConfigured: boolean = isConfigValid && firebaseApp !== null;

/** Firebase Auth instance — null when not configured */
export const auth: Auth | null = firebaseAuth;

/** Firebase App instance — null when not configured */
export { firebaseApp };
