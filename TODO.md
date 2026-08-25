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
- [x] Persisted sessions now skip Landing. Requires `accountActive ===
      true` exactly — null (unknown, or no user document yet) and false
      (deactivated, already being signed out by AdminContext) both fall
      through to Landing rather than carrying a doubtful session inward.
      Destination comes from `getHomeRouteForRole()` in constants/roles.js,
      now shared with AdminLoginScreen instead of duplicated.
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

- [x] `firebase-functions` upgraded 6.6.0 → 7.3.2. The CLI warned about it
      on every deploy. All five v7 breaking changes were checked against
      actual usage first and none applied: Node 16 dropped (we run 22),
      `functions.config()` removed (never used — secrets come from the
      `params` module), TypeScript/ES2022 target (this is plain CommonJS
      JS), emulator error handling for async `onRequest` (no `onRequest`
      anywhere), and v1 `Event` renamed to `LegacyEvent` (v2 API only).

- [x] End-to-end coverage of `placeOrder` — `npm run test:checkout`, 12
      tests against the emulator with nothing mocked. This was the seam
      three suites each stopped short of: test-rules proves no client can
      write orders, test-rate-limit proves the arithmetic in isolation, and
      test-email starts from an order that already exists. Server-side
      pricing, the stock decrement, the legacy string migration, cart
      clearing, every refusal path, and the rate limiter actually being
      wired to the endpoint are all exercised here.

### Still needs a device or an account, not code

- [x] A real order placed through the app — **verified 2026-08-25**.
      Confirmation screen rendered, and the dashboard mail-log card
      appeared. Production logs show the full chain with no errors:
      `placeOrder` invoked, `"verifications":{"app":"MISSING","auth":
      "VALID"}`, then `sendOrderConfirmation` firing two seconds later and
      logging `mail order-NoMd… not sent: GMAIL_USER is unset or still the
      placeholder` — which is the designed behaviour, not a fault.

      `"app":"MISSING"` is worth noting: that is the App Check field, and
      it confirms empirically what the SDK analysis concluded. Requests
      reach this callable with no attestation, which is why the per-user
      rate limit is the compensating control rather than a nice-to-have.

- [x] Order-number search verified 2026-08-25, after the fix in f373d85 —
      the displayed `#NOMDQMGO` form now finds the order, which is what a
      customer actually quotes. It did not before, silently.

- [x] Mid-session revocation verified on device 2026-08-25 — the notice
      appeared and the session ended. Reviewing the screenshot found a
      follow-up: resetToLanding() hung off the OK button, and AppAlertHost
      sets onRequestClose, so Android BACK dismissed the notice without
      navigating. Reset now runs before the alert, independent of how it
      is closed.

- [x] Steps 8-9 verified on device 2026-08-25 — persisted session skips
      Landing, logout stays on Landing.

- [x] Reactivation after deactivation — found by the user, fixed the same
      day. `onSnapshot` fires from a local cache that OUTLIVES sign-out, so
      a reactivated account was ejected by a stale snapshot the instant it
      signed in, and could not log in at all until the app was killed.
      Revocation now requires `!snapshot.metadata.fromCache`. Restarting
      Metro emptied the cache and hid it, which is what made it look like a
      bundler problem rather than a bug.

      Fix verified on device 2026-08-25: reactivate in the console, sign
      in without restarting Metro, works.

      Worth remembering as a class, not an incident: every path here that
      does something IRREVERSIBLE now demands a server-confirmed fact. An
      error is not a deactivation; a cached value is not a confirmation.

- [ ] The session paths have no automated coverage and cannot get any
      from the current suites — they are client timing questions, and the
      emulator suites only reach rules and functions. All four are verified
      by hand as of 2026-08-25; a regression would be silent.
- [ ] iOS/HEIC photo upload confirmation, if the device test was Android
      only.
- [x] Real Gmail credentials set and verified 2026-08-25. Both secrets are
      at version 2 in Secret Manager (version 1 is still the placeholder,
      enabled but unused); `sendOrderConfirmation` and
      `notifySupportRequest` were redeployed to bind them, since secrets
      bind at deploy time and setting them alone changes nothing.

      Verified by a real support request rather than an order: both paths
      share `sendMail()`, so either proves the credentials, but
      supportRequests has `allow delete: if isSeller()` while orders have
      no delete rule for anyone and an order would also decrement stock.
      Production logs show `mail support-5p5P8… sent`, and the mail
      landed.

      NOTE the side effect, which is the retry item below becoming real
      rather than theoretical: the one order receipt logged `unconfigured`
      before this is now stuck that way permanently, so the dashboard's
      "1 email didn't send" card is lit for good. A conditional alarm that
      never clears is worse than no alarm — it trains the reader to ignore
      the thing that is supposed to catch a genuine failure.

### Known gaps in what shipped

- [x] The email triggers have test coverage — `npm run test:email`, 8
      tests against the Firestore emulator with only SMTP faked, so the
      one-shot claim is exercised as a real create/contention race. It
      found a live bug on first run: `recordOutcome` uses
      `set({merge:true})`, which CREATES the document, so the unconfigured
      path did consume the claim and every receipt missed while the mailbox
      was unconfigured would have been permanently unsendable.
- [x] `formatOrderNumber` was in FOUR places, not three — AdminOrdersScreen
      held an undocumented fourth copy that had already drifted (no `#`, no
      null guard, because it stores the bare value to search against). The
      three app copies now share `utils/orderNumber.js`, which exports both
      shapes: `orderNumber()` bare for storing and searching,
      `formatOrderNumber()` prefixed for display. functions/mailer.js still
      cannot import across the package boundary, so its copy stays — but
      `DRIFT-1` in `npm run test:email` asserts the two agree on every id
      including the falsy ones, which makes the comment a check.
- [x] ~~Nothing reads `mailLog`~~ — AdminMailLogScreen does now, reached
      from a Store Manager dashboard card that appears only when something
      failed. `mailLog` gained a read rule for `isSeller()` and no write
      rule for anyone (MAIL-1, MAIL-2).
- [x] Failed email can be retried — `retryMail`, a callable, plus a "Send
      again" button on every resendable entry in AdminMailLogScreen.

      THE DESIGN DECISION WORTH KEEPING: the callable takes a `mailLog`
      entry id and NOTHING else. Recipient, subject and body are all
      re-derived from the order or support request that produced the
      message. The obvious shape — accept an address and a body — is an
      open relay wearing a Firebase badge, able to send from the store's
      authenticated Gmail account to anywhere with the store's name on the
      From line. The seller check limits who may press the button; taking
      no address limits what pressing it can do, which is the stronger of
      the two. RETRY-4 pins it by passing a hostile payload and asserting
      the mail still goes to the order's own address.

      Guards: active Store Manager only (re-checked server-side, since the
      function bypasses rules); `sent` is never resendable; `sending` is
      not either, so a crashed send stays stuck rather than risking a
      duplicate; three attempts per entry; a key containing `/` is
      refused before it reaches `doc()`; an unsendable entry (deleted
      order, no address) refuses WITHOUT consuming an attempt.

      Still no "mark as handled", deliberately — the entry changes because
      the send changed it, never because someone clicked.

      RETRY-5 found a live bug while being written: `claimOnce` used
      `tx.set()` with no merge, a full document replacement, so every
      claim reset `retryCount` to zero. The cap was unreachable and
      retries were effectively unbounded. The counter is now carried
      across explicitly, which is the general hazard with an overwriting
      write — anything that must outlive one attempt has to be named.
