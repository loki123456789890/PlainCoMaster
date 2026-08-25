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
- **Cloud Functions** ([functions/](functions/)) for the things a client
  provably cannot be trusted with: placing an order (prices and totals are
  computed server-side, never accepted from the request), the two
  transactional emails, and re-sending one that failed. Everything else is
  still enforced declaratively in [firestore.rules](firestore.rules) — the
  functions
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

Four functions, all in **`asia-southeast1`**:

| Function | Trigger | What it does |
| --- | --- | --- |
| `placeOrder` | callable | The whole of checkout. Reads prices from the product documents, computes the total, decrements stock, writes the order, clears the cart — all in one transaction. |
| `sendOrderConfirmation` | order created | Emails the customer their receipt. |
| `notifySupportRequest` | support request created | Emails the store so Help's "within 24 hours" promise has something behind it. |
| `retryMail` | callable | Sends one logged message again, for the Store Manager's "Send again" button. Takes a `mailLog` entry id and **never a recipient** — the address and body are re-derived from the order or support request, so it cannot be aimed anywhere. Active Store Manager only; refuses anything already sent; three attempts per entry. |

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

## Test suites

```bash
npm run test:rules       # 83 — firestore.rules, every role
npm run test:checkout    # 12 — placeOrder end to end
npm run test:email       # 19 — the mail triggers and the retry callable
npm run test:rate-limit  #  9 — the order throttle's arithmetic
npm run test:order-number #  8 — the one string that crosses every boundary
npm run preview:email    #      renders the templates for eyeballing
```

The first three need the Firestore emulator, and therefore **a JDK** — the
emulator is a Java process. [scripts/run-rules-tests.mjs](scripts/run-rules-tests.mjs)
locates one itself and puts it on `PATH` for the child process only, so a
freshly opened terminal that predates your JDK install still works. The
last two need nothing.

**Each covers a boundary the others cannot reach**, which is why there are
four rather than one:

- `test:rules` runs against the security rules, so it can only see what a
  *client* may do. The Cloud Functions bypass rules entirely and are
  invisible to it.
- `test:checkout` calls the real `placeOrder` handler against the emulator
  with nothing mocked — server-side pricing, the stock decrement, the
  legacy string-to-number migration, cart clearing, every refusal, and the
  rate limiter actually being wired up.
- `test:email` fakes SMTP and nothing else, so the one-shot claim that
  stops a customer receiving two receipts is exercised as a genuine
  Firestore race rather than a simulated one. Its `RETRY-*` cases also
  cover `retryMail`, including the one that matters most: RETRY-4 hands
  the callable a hostile payload naming another recipient, subject and
  body, and asserts the mail still goes to the address on the order.
- `test:rate-limit` is pure arithmetic, which is the only way to walk a
  ten-minute window without waiting ten minutes.

The rules suite deliberately seeds privileged accounts with rules
bypassed, because the rules under test forbid creating a document that
already carries a role — the same restriction described in the bootstrap
section above.

None of them touch the app itself. See the manual checklist at the end of
this file for what still needs a device.

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

## Manual test checklist

The four suites cover the server. Nothing in them exercises the app
itself, so these are the paths that still need a device — and the order
below is deliberate: each step sets up the next, so one pass covers all
of them.

**Place a real order.**

1. Sign in as a customer with a saved delivery address.
2. Add two items to the cart, then check out with Cash on Delivery.
3. Confirm the confirmation screen shows an order number, and that the
   total reads "To pay on delivery" rather than "Total".
4. Reopen the product you bought — stock should have dropped by the
   quantity ordered.
5. Check the cart is empty.

**Then, as a Store Manager:**

6. The order appears in Orders with the same number the customer saw,
   character for character. Paste it into the search box INCLUDING the
   leading "#", exactly as a customer would quote it — that is the form
   every screen and the receipt email show them, and it must match.
7. The receipt arrives, and the mail log records it. Open Email Delivery
   from the dashboard and confirm an **Order receipt** entry with status
   **Sent**.

   **The dashboard card is a filter, not a banner.** It only appears when
   something failed, and tapping it opens Email Delivery *pre-filtered to
   problems only* — so a successful send is hidden by the very card you
   arrived through, and the screen can look empty when everything worked.
   Clear the filter with the **×** on the red chip to see all mail. If you
   see no entry either way, the trigger did not fire or `recordedAt` is
   missing — check `firebase functions:log`.

   Any entry that did not send offers **Send again**, which calls
   `retryMail`. Tapping it on the old `unconfigured` receipt should turn
   it **Sent** and clear the dashboard card. Tapping it on an entry that
   already sent is impossible — the button is not drawn — and the server
   refuses it regardless.

**Session behaviour** (needs a second account):

8. Force-quit and reopen the app while signed in. It should go straight to
   Home (or the dashboard for staff), never to the Landing screen.
9. Log out. You should land on Landing and stay there.
10. **Mid-session revocation.** The thing being tested is that a session
    already open is ended, so the customer must stay signed in and in the
    foreground while the flag flips. Signing out of the customer account
    to go and deactivate it tests nothing — there is no live session left
    to revoke, and the app will correctly do nothing.

    With one device, use the console rather than a second account:

    a. Sign in as a customer and leave the app open on any screen.
    b. In the Firebase Console → Firestore → `users/{that-uid}`, set
       `isActive` to `false`. Console writes bypass security rules, so
       this is exactly what a Platform Admin's deactivation writes.
    c. Watch the device. Within a second or two it should return to
       Landing with an "Account Deactivated" notice over it.

    Dismiss that notice with Android's BACK gesture rather than the OK
    button. You should still be on Landing — the navigation does not
    depend on which way the notice is closed.

    d. Then set isActive back to true in the console and sign in again,
       WITHOUT restarting the app or the Metro bundler. It must work.

       This is the step that matters most and the one nothing tested for
       a long time. Firestore's listener fires from a local cache that
       survives sign-out, so a reactivated account used to be ejected the
       instant it signed in, by a stale snapshot saying it was still
       deactivated. Killing the app cleared the cache and hid it. If this
       fails, that is what regressed.


    With two devices, Platform Admin → Users on the second works the same
    way — the point is only that the first session stays live.

    If nothing happens, check that the app was in the FOREGROUND. A
    backgrounded app has its Firestore listeners suspended by the OS, so
    revocation lands when it next resumes rather than immediately.

**Photo upload**, if the earlier test was Android only:

11. Add a product on iOS using a photo from the library, and confirm the
    stored `imageUrl` renders. HEIC is iOS-specific and `storage.rules`
    accepts only JPEG, PNG and WebP, so this is the one path that could
    fail on iOS while passing on Android.
