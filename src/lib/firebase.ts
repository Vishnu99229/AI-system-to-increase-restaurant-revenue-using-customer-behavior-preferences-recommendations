import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// --- Step 2: Debug log raw env values BEFORE init ---
console.log("[Firebase Debug] Config:", {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
});

// --- Step 3: Validation guard ---
if (
    !import.meta.env.VITE_FIREBASE_API_KEY ||
    !import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    !import.meta.env.VITE_FIREBASE_PROJECT_ID
) {
    console.error(
        "CRITICAL: Firebase env variables missing. " +
        "Ensure VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID " +
        "are set in .env (local) or Vercel Environment Variables (production)."
    );
}

// --- Step 4: authDomain format check ---
const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "";
if (authDomain && !authDomain.endsWith(".firebaseapp.com")) {
    console.warn(
        `[Firebase] WARNING: authDomain "${authDomain}" does not end with .firebaseapp.com. ` +
        `Expected format: "<project-id>.firebaseapp.com"`
    );
}

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

