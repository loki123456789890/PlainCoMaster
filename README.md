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
- **Firebase Web SDK** — Auth (email/password, AsyncStorage persistence),
  Firestore, and Cloud Storage, called directly from the device.
- **Cloud Functions** ([functions/](functions/)) for the three things a
  client provably cannot be trusted with: placing an order (prices and
  totals are computed server-side, never accepted from the request), and
  the two transactional emails. Everything else is still enforced
  declaratively in [firestore.rules](firestore.rules) — the functions
  codebase is deliberately small, and adding to it should need the same
  justification the first one did.
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

## Enabling Cloud Storage

**Also required on a new Firebase project.** Product photos upload to
Cloud Storage, and the bucket has to be provisioned in the console before
anything — including `npm run storage:deploy` — can touch it. Deploying
rules to a project without Storage set up fails with *"Firebase Storage
has not been set up on project ..."*.

1. Firebase Console → **Build → Storage → Get started**.
2. Pick a location if you are offered one. Storage shares the default GCP
   resource location with Firestore, so if Firestore already exists the
   location is inherited and there is no choice to make. Where there is
   one, `asia-southeast1` (Singapore) is nearest to a Philippine
   audience. **The choice is permanent.**
3. The starting-rules prompt (test mode vs. locked) does not matter —
   `npm run storage:deploy` replaces them immediately.
4. Confirm the bucket name matches `storageBucket` in
   [firebaseConfig.js](firebaseConfig.js). New projects get
   `<project>.firebasestorage.app`; some older ones get
   `<project>.appspot.com`. If they differ, update the config — uploads
   fail silently against a bucket that does not exist.
5. `npm run storage:deploy`

Note that `storageBucket` being present in `firebaseConfig.js` does not
mean the bucket exists. It was declared long before anything used it.

## Cloud Functions

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```

Three functions, all in **`asia-southeast1`**:

| Function | Trigger | What it does |
| --- | --- | --- |
| `placeOrder` | callable | The whole of checkout. Reads prices from the product documents, computes the total, decrements stock, writes the order, clears the cart — all in one transaction. |
| `sendOrderConfirmation` | order created | Emails the customer their receipt. |
| `notifySupportRequest` | support request created | Emails the store so Help's "within 24 hours" promise has something behind it. |

**The region is not arbitrary and must not be changed casually.** It
matches the Firestore database's location. A v2 Firestore trigger
*cannot* deploy to any other region, and `placeOrder` would pay a
cross-region round trip on every read if it did. If you change it, change
`REGION` in [functions/index.js](functions/index.js), the constant of the
same name in [functions/emails.js](functions/emails.js), **and** the
region passed to `getFunctions()` in [firebaseConfig.js](firebaseConfig.js)
together. Miss the last one and checkout fails with a bare `not-found`
that says nothing about regions.

### Email credentials

Sending goes through Gmail SMTP. Both secrets live in Secret Manager and
must be set before the first deploy, or it will fail:

```bash
firebase functions:secrets:set GMAIL_USER          # the full gmail address
firebase functions:secrets:set GMAIL_APP_PASSWORD  # 16-char App Password
```

`GMAIL_APP_PASSWORD` is **not** the account password. Generate one at
Google Account → Security → App passwords; that page only exists once
2-Step Verification is switched on.

Gmail was chosen over a transactional provider because those require a
verified sending domain and PlainCo does not own one. The trade-offs
(~500 recipients/day, weaker deliverability, no bounce handling) are
written up at the top of [functions/mailer.js](functions/mailer.js).
Swapping providers means rewriting `sendMail()` there and nothing else.

### Previewing the emails

```bash
npm run preview:email
```

Renders every template — including the awkward fixtures (markup in a
product name, a line with no size or colour, a support request from an
account with no email) — into `.email-preview/`. No credentials needed
and nothing is sent.

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
