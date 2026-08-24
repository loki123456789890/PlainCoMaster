# PlainCo

A mobile-first marketplace for secondhand (*ukay-ukay*) and ready-to-wear
clothing in the Philippines. Both sit side by side in **one catalog**,
distinguished by a type badge rather than split into separate tabs or
sections — see [PRODUCT.md](PRODUCT.md) for the positioning and
[DESIGN.md](DESIGN.md) for the design system.

## Stack

- **Expo SDK 54** / React Native 0.81 / React 19
- **React Navigation** (native stack) — a single flat navigator in
  [App.js](App.js). This is *not* an expo-router app; there is no `app/`
  directory and no file-based routing.
- **Firebase Web SDK** — Auth (email/password, AsyncStorage persistence)
  and Firestore, called directly from the device. There are **no Cloud
  Functions and no server**; every security guarantee lives in
  [firestore.rules](firestore.rules).
- **Reanimated** for motion, gated throughout on `useReducedMotion()`.

## Setup

```bash
npm install
npx expo start
```

Firebase config is currently hardcoded in
[firebaseConfig.js](firebaseConfig.js) against the `plainco-c3edc`
project. There is no staging project yet.

## Creating the first Platform Admin

**Read this before deploying to a new Firebase project — the app is
unusable without it.**

PlainCo has three roles: `customer`, `seller` (shown as "Store Manager"),
and `platformAdmin`. They are **granted, never self-registered**: the
`users` create rule in [firestore.rules](firestore.rules) uses a key
allowlist that omits `role` and `isActive` entirely, so a new account is
structurally always a customer. That is deliberate — it is what stops a
stranger from signing up with staff access.

The consequence is that the *first* privileged account cannot be created
from inside the app. Bootstrap it by hand:

1. Sign up in the app like any customer.
2. In the Firebase Console → Firestore → `users/{your-uid}`, add a field
   `role` (string) with the value `platformAdmin`. Console and Admin SDK
   writes bypass security rules, which is why this works and the in-app
   path does not.
3. Sign in through the **Staff Portal** (not the customer login — the
   customer screen deliberately bounces staff accounts).

From there that account can grant `seller` and `platformAdmin` to anyone
else via the Users screen. You will want at least one `seller` too:
Store Manager and Platform Admin are **siblings, not a hierarchy** — a
seller runs products/orders/support/reviews and cannot touch accounts; a
platformAdmin manages accounts and cannot touch the store. See
[ROLES.md](ROLES.md).

**Keep at least two active Platform Admins.** Only that role can
reactivate a deactivated account, so if the last active one is
deactivated or loses access to their email, account management can only
be restored by editing Firestore in the console. The app warns about
this but cannot prevent it.

## Firestore rules and indexes

```bash
npm run rules:deploy      # firebase deploy --only firestore:rules
npm run indexes:deploy    # firebase deploy --only firestore:indexes
```

[firestore.indexes.json](firestore.indexes.json) declares the
collection-group index on `orders` that the admin order screens require.
Deploy it before using the Store Manager dashboard on a fresh project,
or those screens will fail to load.

## Rules test suite

```bash
npm run test:rules
```

Runs ~128 assertions against the Firestore emulator. **Requires a JDK** —
the emulator is a Java process. [scripts/run-rules-tests.mjs](scripts/run-rules-tests.mjs)
locates a JDK itself and puts it on `PATH` for the child process only, so
a freshly opened terminal that predates your JDK install still works.

The suite deliberately seeds privileged accounts with rules bypassed,
because the rules under test forbid creating a document that already
carries a role — the same restriction described in the bootstrap section
above.

## Layout

```
App.js                  single stack navigator, role guards wired here
firebaseConfig.js       Firebase init (Auth + Firestore)
firestore.rules         the actual security boundary — read this first
context/                AdminContext (roles), Product, Cart, Favorites
screens/                customer screens
screens/admin/          Store Manager + Platform Admin screens
components/ui/          Button, Card, Badge, Input, EmptyState, …
constants/theme.ts      design tokens (Clay / Moss / Gold / Canvas)
constants/roles.js      role values and their user-facing labels
utils/                  stock arithmetic, reviews, activity log, alerts
```

## Conventions

- Reuse `components/ui/` and `constants/theme.ts`; don't hand-roll styles.
- Use `showAppAlert()` from [utils/appAlert.js](utils/appAlert.js), not
  `Alert.alert` — the OS alert can't be themed.
- Stored role values (`customer`, `seller`, `platformAdmin`) are
  load-bearing; `firestore.rules` matches them literally. Only the
  labels in [constants/roles.js](constants/roles.js) are user-facing.
