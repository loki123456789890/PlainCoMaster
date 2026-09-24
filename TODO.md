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
- [ ] Confirm on the second platform. No iOS device or simulator is
      available (Windows machine), so this was closed in code instead of
      by observation: an unidentified type used to be relabelled
      `image/jpeg`, and since storage.rules checks the declared
      contentType rather than the bytes, a HEIC would have been stored
      looking correct to the iPhone that sent it and broken on every
      Android. `mimeTypeFromUri()` now names HEIC/HEIF so they are
      REFUSED, and the early guard no longer skips itself when the picker
      reports no mimeType. Worst case on iOS is now a clear
      "unsupported format" message rather than a silently corrupt photo.

      What is still unverified is whether upload SUCCEEDS on iOS at all —
      that needs a real handset (Expo Go on a borrowed one would do it)
      and is not blocking, since failure there is loud rather than silent.
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
- [ ] iOS/HEIC photo upload: the silent-corruption half is closed in code
      (see Batch 4). Only the does-it-work-at-all half is open, and it
      needs a physical iPhone.
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

- [x] The dashboard card and the mail log now share one definition of
      "undelivered" (`constants/mail.js`), and the log can no longer hide
      an entry the card counts.

      Found by the user: the card said "1 email didn't send" and opened a
      screen saying "Everything sent". Investigating turned up two real
      defects. ONLY THE FIRST IS CONFIRMED to have been active — see the
      note under (2).

      1. Two hand-written copies of the status list. Adding 'retrying'
         updated the log's and not the card's. `DRIFT-2` now fails on
         exactly that drift, and also pins the invariant neither list
         stated alone: anything resendable must also count as a problem,
         or the button sits on a row the filter hides.

      2. The card queries by status; the log sorted by `recordedAt`, and
         Firestore's `orderBy` OMITS documents lacking the sort field —
         silently. Any entry written before `recordedAt` was added to
         every path was permanently counted and permanently invisible.
         The log's own comment warned about this hazard and the screen
         was not defended against it, which is the lesson: a comment
         describing a trap is not a guard against it. There is now a
         second listener keyed on status, merged in, so anything
         countable is showable. Entries with no timestamp sort to the top
         and read "Time not recorded" rather than "Just now".

         FIXED ON SUSPICION, NOT ON EVIDENCE. It was the best explanation
         for a card counting something the log could not show, but when
         the fix shipped no hidden entry appeared — the card simply went
         to zero. So this was latent, not what the user hit. It stays
         because the Firestore behaviour is real and this project did
         once write recordedAt on only some paths (see the mailLog
         reader entry above), but it should not be recorded as a
         diagnosis that was confirmed.

         What the user actually hit was almost certainly (1), with the
         entry mid-retry — 'retrying' then 'sending' — at the moment they
         looked, which is exactly the state the two screens disagreed
         about. That is inference: the state was transient and is gone,
         so it cannot now be reproduced.

      NOT covered by any suite — it is client query behaviour, and the
      emulator suites reach rules and functions only. Same blind spot as
      the session paths.

## Sandbox payment gateway ✅

- [x] **Payment options now do something.** Selecting GCash, Maya, or Card
      opens `SandboxPaymentScreen` and runs a simulated authorisation the
      SERVER decides, inside the existing `placeOrder` transaction. The
      order carries `paymentStatus`, `paymentRef` and `paymentSandbox`
      instead of only a method string.

      WHY THE GATEWAY RUNS INSIDE THE TRANSACTION rather than in a second
      callable after the order exists: a decline must not leave a written
      order and a spent stock decrement to unwind. Throwing from inside
      the transaction aborts the whole thing — no order, no stock moved,
      cart intact — which is what makes "try a different method" work.
      CHECKOUT-15 is that guarantee.

      WHY THE CLIENT PICKS THE OUTCOME, and why it is not the hole it
      resembles: real sandboxes work this way (Stripe and PayMongo both
      decline on a designated test card). The scenario is an INPUT to a
      test gateway, not a claim about money. The boundary that matters is
      untouched — `firestore.rules` has no order-create rule for anyone,
      so a client still cannot mark itself paid. CHECKOUT-16 covers the
      caller that skips the payment screen entirely.

      NO CARD FIELDS EXIST ANYWHERE. This is deliberate and is why the
      screen asks for a scenario rather than drawing a card form: the
      deleted `PaymentScreen.js` was flagged in SRS_AUDIT.md for carrying
      invented saved cards that contradicted the app's own "No Card Info
      Stored" claim. HelpScreen's FAQ and Checkout's trust copy were
      rewritten to say "sandbox", because a payment step that genuinely
      runs is the first place this app could overstate itself.

- [x] **Swap in a real gateway.** PayMongo hosted checkout (GCash, Maya,
      Card), built 2026-09-24 and switched by one document:
      `config/payments.gateway` is `'sandbox'` (or missing) or
      `'paymongo'`. Server and app both read it; only the console writes
      it. The emulator has no such document, so it keeps the sandbox.

      HOW IT WORKS. With PayMongo on, `placeOrder` prices the cart,
      HOLDS the stock and writes `checkouts/{checkoutId}`, but NOT
      orders; then it opens a PayMongo session and returns its URL.
      `OnlinePaymentScreen` opens that page in an auth-session browser
      (`expo-web-browser`). The orders are written only when the money
      is confirmed: by `paymongoWebhook` (`checkout_session.payment.paid`,
      signature checked against the raw body), or by `resolveCheckout`
      asking PayMongo directly. Whichever comes first writes, and the
      rest see `status: 'paid'` and do nothing. Backing out calls
      `resolveCheckout` with `abandon`, which checks for a payment,
      expires the session, then gives the stock back.
      `expireUnpaidCheckouts` does the same every 5 minutes for holds
      older than 30 minutes.

      WHY ORDERS ARE NOT WRITTEN AS "UNPAID" FIRST. Every order consumer
      (the confirmation email trigger, the manager's list, the status
      rules, reviews) assumes an order is something to pack. Writing it
      only once paid means none of them needed a guard. It also means
      `paymentStatus: 'failed'` is still never written.

      Tests: checkout 22 → 39 (PAY-1…17, with a fake PayMongo, so no
      account is needed), rules 130 → 133.

- [ ] **Go live with PayMongo.** In this order:
      1. PayMongo dashboard → Developers: copy the test secret key.
         `firebase functions:secrets:set PAYMONGO_SECRET_KEY`.
      2. `firebase functions:secrets:set PAYMONGO_WEBHOOK_SECRET` with a
         placeholder for now. `placeOrder`, `resolveCheckout`,
         `expireUnpaidCheckouts` and `paymongoWebhook` bind these
         secrets, so **`firebase deploy --only functions` refuses until
         both exist.**
      3. `npm run indexes:deploy` (new `checkouts` status + expiresAt
         index; the scheduler's query fails without it), then
         `npm run rules:deploy`, then deploy functions.
      4. PayMongo → Webhooks: add
         `https://asia-southeast1-plainco-c3edc.cloudfunctions.net/paymongoWebhook`
         for `checkout_session.payment.paid`. Put the whsk_… secret it
         shows into `PAYMONGO_WEBHOOK_SECRET` and redeploy the functions.
      5. Ship an app build that has `expo-web-browser` (a new native
         module: Expo Go has it, a dev or store build must be rebuilt).
      6. Firestore console: create `config/payments` = `{ gateway: 'paymongo' }`.
         Nothing a customer sees changes until this step, and setting it
         back to `'sandbox'` undoes it.
      7. Pay once with each of GCash, Maya and a test card, and back out
         once. Check the webhook deliveries in PayMongo's dashboard.
- [ ] **Not yet built for PayMongo:** refunds. A checkout marked
      `needsReview: 'refund-owed'` (paid after its hold was released) or
      `'amount-mismatch'` is only logged and flagged, so someone has to
      refund it from the PayMongo dashboard. There is no admin screen
      listing these yet.
- [ ] **HelpScreen's FAQ still says "sandbox"** for the online methods.
      That is correct until step 6 above; rewrite the two answers when
      production switches. (Checkout's note under the methods already
      follows the setting.)
- [ ] **Not driven in the running app yet.** The server paths are
      covered by tests, and the Android bundle compiles, but
      OnlinePaymentScreen has not been opened against a real PayMongo
      test session. Do that during step 7.

### Two bugs the sandbox flow only showed when the app was actually run ✅

Both were invisible to `test:checkout`, which calls the handler directly
and never navigates. They appeared on the first real click-through, and
they are the reason running the app is not the same as running the tests.

- [x] **Checkout resumed with an empty basket.** Returning from
      `SandboxPaymentScreen` REMOUNTS CheckoutScreen rather than restoring
      it, so `route.params.orderItems` was gone and the order went to the
      server with no lines. It was refused — correctly — as "An order needs
      at least one item", which reached the customer as a generic "Could
      not place your order" immediately after they had approved a payment.

      Fixed by round-tripping the lines: checkout hands `orderItems` to the
      sandbox and the sandbox hands them back. A `useRef` was tried first
      and does NOT work, because a remount rebuilds the ref too.

- [x] **The chosen payment method was lost the same way.** `selectedPayment`
      is state, and the remount reset it to null — the next symptom after
      the lines were fixed was "Choose a payment method" over a choice the
      customer had plainly made. The method now travels back in the result
      and is passed to `submitOrder` as an argument rather than read from
      state; it is also restored into the picker so a refused payment
      leaves the method visibly selected.

      WHY NOT FIX THE REMOUNT ITSELF: it is navigator behaviour, it differs
      by platform, and a checkout that depends on a screen staying mounted
      is fragile whatever the navigator does today. Carrying what the
      submission needs makes the question moot.

### SRS updates still owed for the sandbox payment

The code is done; the SRS still describes the old behaviour. Each item
below is a place the document currently says something the app no longer
does. Same treatment as `SRS_UPDATE_NOTES.md` — the SRS is the thing a
panel reads, so a gap here reads as a gap in the system.

- [ ] **Constraint: "payment options are included in the UI design and
      not yet integrated."** No longer accurate. Replace with something
      like:

      > GCash, Maya, and Card run through a sandbox payment gateway. The
      > customer selects a simulated gateway response; the server
      > authorises or refuses the order accordingly. No real money moves,
      > no live gateway is contacted, and no card details are collected.
      > Cash on Delivery is the only method that settles real money.

- [ ] **Functional requirements — checkout.** Add the payment step
      between choosing a method and the order being placed:
      - Online methods (GCash, Maya, Card) open the Sandbox Payment screen.
      - The customer chooses one of four gateway responses: Payment
        succeeds, Declined by the bank, Not enough balance, No response
        at all.
      - A successful payment places the order marked **Paid**, with a
        sandbox reference (`SBX-…`).
      - Any other response **refuses the order entirely** — no order is
        recorded and no stock is deducted. The cart is kept so the
        customer can retry or choose another method.
      - Cash on Delivery skips the payment step and is recorded as
        **Pay on delivery**.

- [ ] **Security / business rules.** The payment outcome is decided by
      the server (`placeOrder`), never written by the app. Customers
      cannot create or edit order documents directly, so they cannot mark
      an order as paid. A payment refusal and the order write happen in
      one transaction, so a failed payment can never leave a half-placed
      order or deducted stock.

- [ ] **Data dictionary — `orders`.** Three new fields:

      | Field | Type | Meaning |
      | --- | --- | --- |
      | `paymentStatus` | string | `paid` (online, approved) or `unpaid` (COD). `failed` is reserved for a future real gateway. |
      | `paymentRef` | string / null | Sandbox reference such as `SBX-A9BBIEQPFP`; null for COD. |
      | `paymentSandbox` | boolean | `true` on every online-method order, so no report or screen can mistake a simulated payment for a real one. |

- [ ] **Module / screen list.** Add **Sandbox Payment** (customer side).
      Note that Order Confirmation, Order Details, and the Store Manager's
      order view now show payment status and the sandbox reference.

- [ ] **Help / FAQ content.** Two answers changed — "What payment methods
      do you accept?" and "Is my payment information secure?" — to say
      the online methods run in sandbox mode. Update any copy of the FAQ
      in the SRS appendix to match `screens/HelpScreen.js`.

- [ ] **Testing section.** `test:checkout` grew from 12 to 17 cases:
      CHECKOUT-13 approved payment marked paid, 14 COD unpaid and never
      enters the sandbox, 15 a declined payment writes nothing, 16 an
      online order cannot skip the payment step, 17 COD carrying a
      sandbox outcome is refused. Also worth stating the sandbox was
      verified in the running app, where two navigation bugs surfaced
      that the tests could not see (above).

- [ ] **Limitations / future work.** State plainly that payments are
      simulated, and that a real gateway (PayMongo, whose test mode
      covers GCash, Maya, and Card) is the planned next step — the order
      fields and the server-decides boundary are already shaped for it.

## Multi-store — a real requirement, deliberately deferred

A panellist raised it. It is not optional, and it is not what
`SRS_UPDATE_NOTES.md` §9 currently says: that section states in writing
that "PlainCo is not a multi-vendor marketplace — there is one store".
That paragraph has to be rewritten as part of this work, not quietly
contradicted by the code.

DEFERRED PAST THE UAT ON PURPOSE. The approved questionnaire describes a
single store throughout — "stock updates made by *the* store", "*the*
product catalog" — and Section 5 item 5 uses the title's own plural in
the sense of *stores as a category of business that would adopt this*
("acceptable for use BY Ukay-Ukay and Ready-to-Wear clothing stores").
Shipping multi-store before the session would have meant surveying an app
the instrument does not describe, and would have put checkout — the most
rated flow in the questionnaire — through an untested refactor hours
before respondents used it.

The order below matters: each step leaves the app working, and the risky
one comes after the boundary it depends on is solid.

- [x] `stores/{storeId}`; `products.storeId`; `users/{uid}.storeId` for
      sellers. A Platform Admin assigns a manager to a store, which is
      the model ROLES.md already uses — access granted, never
      self-registered. *(branch `feature/multi-store`: Edit User has a
      store picker that can open a new store in the same batch;
      `scripts/migrate-to-stores.mjs` assigns pre-store products and
      managers, rehearsed on the emulator.)*
- [x] Rules ownership for **products**: `managesStore()` replaces
      `isSeller()` on product create/update/delete, storeId is immutable,
      and the cancellation stock restore is per-store as a result. Rules
      suite 83 → 99. Orders, support, reviews and logs are still
      any-manager; they follow from the order split below.
- [ ] Before this branch ships (after the UAT), in this order:
      `npm run indexes:deploy` and wait for the indexes to finish
      building; run the migration against production; deploy functions
      and rules; then ship the app. Rules before the migration freezes
      the live catalogue; the app before the indexes shows managers a
      failed-query error instead of their orders.
- [x] Order splitting in `placeOrder`: one checkout writes one order per
      store, in the same transaction. The riskiest step — two managers
      sharing one status field means neither owns it — so it lands after
      the rules are right, with its own tests. *(Each order carries
      storeId, storeName and a shared checkoutId; one sandbox payment and
      one paymentRef cover the whole checkout; a decline or a short store
      writes nothing for any store. Order status updates and cancellation
      are now `managesStore()`. Confirmation lists one number per store,
      My Orders and Order Details name the store, receipts say "Sold by".
      Checkout suite 17 → 22, rules 99 → 102; a two-store COD checkout
      driven in the web build against the emulators. The migration now
      stamps pre-store orders too.)*
- [x] Scope the admin screens (Products, Orders, Reviews, Activity) to
      the signed-in manager's store. *(Rules now refuse another store's
      orders, review moderation and activity entries, and refuse an
      unfiltered order or log query outright; the screens query
      `where('storeId', '==', …)`. Reviews carry the order's storeId,
      checked by the rule. Three composite indexes and a collection-group
      field override added to firestore.indexes.json — the emulator does
      not enforce indexes, so `indexes:deploy` must precede the app.
      Rules 102 → 109; each manager driven in the web build sees only
      their own store.)*
- [x] Support requests and the mail log, routed by order (decided
      2026-09-22): the Help form offers the customer's recent orders; a
      question about one goes to that order's store, a general one
      (`storeId: null`) to the Platform Admin via an "Open questions"
      card in Manage Users. Rules check the order is the customer's and
      the store is its store; the mail log and retryMail follow the same
      routing. Rules 109 → 114, email 19 → 20. Driven in the web build
      with the functions emulator OFF, so no real email was sent.
- [x] Store pages in Shop: browse by store, store profile. Shop gains a
      "Shop by store" row (stores with at least one item) and a store
      line on each card; a store's page is the Shop narrowed to it, with
      a profile of what it sells (read off its own listings) and when it
      opened. Product pages say "Sold by <store>" and link there. Store
      names come from a new StoreContext. The emulator seed's product
      types were 'ukay'/'ready', which no screen matches — now the real
      'ukay-ukay'/'ready-to-wear'. No rules change: /stores was already
      readable by any signed-in account. Driven in the web build.
- [x] Seller ratings — the thing the panellist actually asked for in §9,
      refused at the time because one seller is one number with nothing
      to compare it against. A store's rating is its own verified-purchase
      reviews summarised (useStoreRatings, last 100, hidden ones left
      out): stars and count on the "Shop by store" row, stars, count and
      "% said the item matched its description" on the store's page, and
      a line under "Sold by" on each product. The no-reviews fallback on
      a product page now quotes its seller's record, not all of PlainCo's.
      No new collection or rules: reviews already carried a checked
      storeId (step 4). Hiding a review moves the number live. Also fixed
      the last card of an odd count stretching across both columns.
      Driven in the web build; rules 114/114.
- [x] SRS_UPDATE_NOTES.md: §9 rewritten (seller ratings exist; customer
      ratings still declined, with the reason), new §10 Multi-store (scope
      wording, what changed per SRS area, data model, out of scope), and
      §1, §4, §5, §7, §8 brought in line. Marked as post-UAT.

OUT OF SCOPE unless someone asks: payouts, commissions, vendor
self-signup, per-store shipping rates. Those make it a marketplace to
operate rather than a marketplace to demonstrate.
