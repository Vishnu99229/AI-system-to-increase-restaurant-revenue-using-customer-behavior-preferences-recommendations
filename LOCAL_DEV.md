# Local Development Guide

## Prerequisites

- Node.js v18 or later (v20+ recommended for the `--watch` flag)
- Two `.env` files: one at the repo root and one inside `server/`
- A Firebase project with phone authentication enabled
- Access to the production Postgres `DATABASE_URL` and your OpenAI API key

## First Time Setup

1. Install frontend dependencies from the repo root:

   ```bash
   npm install
   ```

2. Install backend dependencies:

   ```bash
   cd server && npm install
   ```

3. Copy the example env files and fill in real values:

   ```bash
   cp .env.example .env
   cp server/.env.example server/.env
   ```

4. Open each `.env` file and replace the placeholder values with your actual credentials.

## Running Locally

Start the backend first, then the frontend. Both must be running at the same time.

**Backend (Express server on port 3001):**

```bash
cd server && npm run dev
```

This uses `node --watch` to auto-restart the server when you save changes.

**Frontend (Vite dev server):**

```bash
npm run dev
```

Vite will start on `http://localhost:5173` by default. If port 5173 is already in use, Vite will pick the next available port (usually 5174). Check the terminal output for the exact URL.

The frontend uses a hardcoded fallback of `http://localhost:3001` for API requests when `VITE_API_BASE_URL` is not set, so you do not need to configure that variable locally.

## Verification Checklist

After starting both servers, confirm the following:

- [ ] Open the browser DevTools Console and look for the Firebase Debug log confirming initialization
- [ ] Open the Network tab and verify that API requests are hitting `localhost:3001`, not a Render URL
- [ ] The menu loads without errors
- [ ] Phone verification modal opens and connects to Firebase

## Smoke Test Before Pushing

Before pushing any changes, manually verify these four critical flows:

1. **Menu loading** -- The menu screen renders items from the backend without errors
2. **Phone auth via Firebase OTP** -- The phone verification modal sends and verifies a code through Firebase
3. **Upsell modal with AI recommendations** -- Adding items to the cart and proceeding to checkout triggers the upsell modal with a GPT-ranked recommendation
4. **Checkout and order submission** -- Completing the checkout flow successfully submits the order to the backend

## Important Notes

- The local backend connects to the same production Postgres database via `DATABASE_URL`. Do not place real-looking test orders, as they will appear in production data.
- Never commit `.env` files. They are already listed in `.gitignore`.
- Firebase handles phone OTP verification, not Twilio. Any Twilio-related variables in `server/.env` are stale and can be ignored or removed.
