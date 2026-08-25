# TODO

Working backlog from the codebase audit. Batches are ordered by
risk-to-fix, not by size — earlier ones are mechanical, later ones need
design or a server.

## Batch 1 — repo hygiene ✅

- [x] Declare `@react-navigation/native-stack`; drop unused deps and the
      dead `expo-router` / `expo-web-browser` app.json plugins
- [x] Delete the three orphaned Expo-starter hooks
- [x] Brand the `withRoleGuard` loading screen (was iOS blue on white)
- [x] Commit `firestore.indexes.json` + wire into `firebase.json`
- [x] Rewrite README; document the first-Platform-Admin bootstrap
- [x] `npm install` to resync `package-lock.json`

## Batch 2 — user-facing bugs ✅

- [x] **Cartscreen** gated on the products listener too, so a full cart
      no longer renders as "No longer available" while it loads. Failed
      catalog loads get their own retry state.
- [x] **Checkoutscreen** catches listings the stock rule will refuse
      (non-numeric or absent `stock`) before the transaction, and names
      them instead of failing generically

## Batch 3 — remaining correctness bugs

- [x] Dead `featuredProducts` sort removed (the query already orders)
- [x] Profile name edit now syncs the Auth `displayName` that
      WriteReviewScreen stamps onto reviews
- [x] Shop pull-to-refresh spinner clears for signed-out viewers
- [x] Activity-log summaries name only the fields that actually changed
- [x] Cart quantity caps share a product's stock across its lines
- [x] `parseStock` / `parseStockLimit` split by name
- [x] Signup writes `createdAt` as a server timestamp; `formatDate`
      accepts both shapes
- [x] All `react/no-unescaped-entities` errors cleared (source is at
      zero lint errors)
- [ ] **Unblocked, not yet done:** persisted sessions still land on
      Landing. The blocker is gone — AdminContext now exposes
      `accountActive`, which is exactly the state auto-routing needed, and
      a deactivated session is signed out on sight rather than being
      carried into the app. What remains is the routing decision itself:
      where a returning signed-in customer should land, and how to avoid a
      flash of Landing before the redirect. Treat `accountActive === null`
      as "not known yet" and wait, never as inactive.
- [x] Order status transitions: decided to keep backward moves allowed
      and make them deliberate instead. Forward-only would have made a
      one-tap mis-tap permanent, and it protects nothing — the only
      transition with a physical consequence (cancel) was already
      constrained, and staff cannot write reviews. Backward moves now
      confirm first and are marked "Step back" in the picker; the
      activity log is what makes them accountable.

## Batch 4 — Tier 1 features

- [x] `storage.rules` + `firebase.json` wiring — the bucket was
      configured but ungoverned by anything in this repo
- [x] Storage SDK init and `utils/imageUpload.js` (no schema change —
      the download URL goes in the existing `imageUrl` field)
- [x] Picker UI in AdminAddProductScreen and AdminEditProductScreen —
      take/choose a photo, added alongside the URL field so products
      hosted elsewhere keep working
- [x] Cloud Storage provisioned (US-EAST1, the no-cost location) and
      `storage.rules` deployed. The cross-service IAM grant the CLI
      prompts for is required — `isSeller()` reads the Firestore user
      doc, and without it every upload fails.
- [x] Verified on device: permissions, upload, progress, and the
      resulting URL rendering in the preview all work.
- [ ] Confirm on the second platform. HEIC is iOS-specific, so if the
      device test was Android only, whether iOS actually yields JPEG is
      still unverified.
- [x] Live product subscription on Productscreen — was a frozen nav
      param, so stock and price went stale while a shopper read the page
- [x] Order confirmation screen, with the order number the customer
      previously never saw
- [x] Low-stock alerts on the Store Manager dashboard, tapping through
      to a filtered product list
- [x] "Duplicate product" action
- [x] `expo-image` for disk caching, replacing four drifted copies of
      the same fade-in wrapper
- [ ] ~~Firestore offline persistence~~ — **not possible as scoped, and
      the audit was wrong about this.** The JS SDK's
      `persistentLocalCache` is IndexedDB-backed and React Native has no
      IndexedDB; the RN build exports the function but ships none of the
      storage layer behind it (`SimpleDb`,
      `IndexedDbOfflineComponentProvider` are absent from
      `index.rn.js`). Calling it would fail or silently do nothing.

      What the app actually has today: an in-memory cache per session, so
      repeated reads within one session are served locally and writes
      queue while offline until the app is killed. What it lacks is
      survival across restarts.

      Real options, none of them small:
      - `@react-native-firebase/firestore` (native SDK) has real disk
        persistence on by default, but it is a different API surface, a
        full migration, and needs a custom dev build — no Expo Go.
      - Hand-roll an AsyncStorage cache for the catalog specifically.
      - Accept it. Note the practical gap is now much smaller than the
        audit implied: `expo-image` caches the photos, which are the
        overwhelming majority of the bytes. What is left uncached is
        JSON, which is small.

## Batch 5 — the server

One project, not four — they all need the same Cloud Functions
deployment:

- [x] Server-side order total verification (totals are client-supplied
      and unvalidated) — `placeOrder` in functions/index.js
- [x] Close the unconstrained product stock decrement — any signed-in
      account can zero out the catalog — customer branch removed from
      firestore.rules; stock is written only by the server or a seller
- [x] Transactional email — Help promises a 24h reply with no pipeline —
      `notifySupportRequest` now emails the store on every request, and
      `sendOrderConfirmation` sends the customer a receipt
- [ ] ~~Firebase App Check~~ — **NOT DOABLE ON THIS STACK.** Not a
      scheduling problem, an SDK one: `@firebase/app-check` ships no
      React Native build, its only two providers are reCAPTCHA ones that
      write to `document`, and `CustomProvider` needs an attestation
      token that only native DeviceCheck / Play Integrity can mint.
      Getting it would mean adopting `@react-native-firebase`, whose App
      Check state the Web SDK cannot see — so in practice, migrating the
      whole app off the Web SDK. Reconsider only if that migration
      happens for other reasons.
- [x] Per-user rate limiting inside `placeOrder` — the nearest available
      answer to what App Check would have covered. Eight attempts per ten
      minutes, counted in `rateLimits/{uid}`. Counts ATTEMPTS in its own
      transaction, not orders in the order's: fold it in and a refused
      order rolls the counter back, letting an attacker loop for free on a
      deliberately out-of-stock item. Covered by `npm run test:rate-limit`
      (pure arithmetic, no emulator) and `RATE-1` in the rules suite, which
      pins that no client can reset its own counter.

## Batch 6 — session revocation (H8)

- [x] Deactivation now takes effect mid-session. AdminContext's one-shot
      `getDoc` on the user document became an `onSnapshot`, so a
      deactivated account is signed out on sight instead of discovering
      the fact through a string of denied writes. The listener's error
      path deliberately does NOT revoke — offline and a backend blip both
      land there, and ejecting someone mid-checkout over a dropped
      connection is worse than the bug being fixed.
- [x] `accountActive` exposed from AdminContext, kept separate from
      `role`. `resolvePrivilegedRole` collapses "no document", "unknown
      role" and "deactivated" into one null, which is right for the role
      question and wrong for revocation — only the third means sign out.
- [x] `SPLIT-8` pins the rule the whole mechanism rests on: a deactivated
      account can still READ its own document. Gate that on `isActive` and
      revocation stops working silently, because the listener would take
      the error path, which does not revoke.
- [x] Self-deactivation from ProfileScreen suppresses the notice via
      `acknowledgeSelfDeactivation()` — the write is identical to an
      admin's, and without it someone closing their own account would be
      told to contact support about a mistake they made on purpose.

### Known gaps in what shipped

- [ ] The email triggers have no test coverage. `scripts/test-rules.mjs`
      exercises firestore.rules, and these bypass rules entirely; the
      templates are checked by eye via `npm run preview:email`.
- [ ] `formatOrderNumber` now exists in three places —
      OrderConfirmationScreen, OrderDetailsScreen, and functions/mailer.js.
      The first two could move to `constants/`; the third cannot follow,
      because functions/ is a separate CommonJS package. Same drift shape
      that justified constants/payment.js.
- [x] ~~Nothing reads `mailLog`~~ — AdminMailLogScreen does now, reached
      from a Store Manager dashboard card that appears only when something
      failed. `mailLog` gained a read rule for `isSeller()` and no write
      rule for anyone (MAIL-1, MAIL-2).
- [ ] Nothing RETRIES a failed email — still true, and now visible rather
      than silent. Retrying means re-invoking the mailer, which the client
      cannot do; it would take a callable that re-sends one `mailLog`
      entry, guarded so it cannot be used to spam an address. The screen
      deliberately offers no fake substitute (no "mark as handled"), since
      that would turn a record of what happened into a record of what
      someone clicked.
