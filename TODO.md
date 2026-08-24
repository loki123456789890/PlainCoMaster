# TODO

Working backlog from the codebase audit. Batches are ordered by
risk-to-fix, not by size — earlier ones are mechanical, later ones need
design or a server.

## Batch 1 — repo hygiene (in progress)

- [x] Declare `@react-navigation/native-stack`; drop unused deps and the
      dead `expo-router` / `expo-web-browser` app.json plugins
- [x] Delete the three orphaned Expo-starter hooks
- [x] Brand the `withRoleGuard` loading screen (was iOS blue on white)
- [x] Commit `firestore.indexes.json` + wire into `firebase.json`
- [x] Rewrite README; document the first-Platform-Admin bootstrap
- [ ] `npm install` to resync `package-lock.json`

## Batch 2 — user-facing bugs

- [ ] **Cartscreen** consumes only `products` from `useProducts()`, not
      its `loading` flag — so a full cart briefly renders every row as
      "No longer available", subtotal ₱0.00, checkout disabled
- [ ] **Checkoutscreen** passes its own stock check for legacy
      string-typed `stock`, then gets denied by rules (which require a
      number) with an unactionable generic error

## Batch 3 — remaining correctness bugs

- [ ] `featuredProducts` sort in Homescreen is a no-op — `new Date()` on
      a Firestore `Timestamp` is `Invalid Date`; only looks right because
      the query is already ordered
- [ ] Editing your name in Profile doesn't update the Auth `displayName`
      that WriteReviewScreen stamps onto reviews
- [ ] Shop pull-to-refresh spinner never clears for a signed-out viewer
      (effect keyed on a `loading` value that never changes)
- [ ] Activity-log summaries list every field on every product edit,
      because AdminEditProductScreen always sends the full document
- [ ] Persisted sessions still land on Landing — no auth check there
- [ ] Cart quantity caps are per-line, not per-product; two lines of the
      same item can each reach full stock
- [ ] Order status transitions are unconstrained apart from cancel
      (`delivered → pending` is currently allowed)
- [ ] Three divergent `parseStock` implementations with opposite failure
      directions (utils, Cartscreen, Productscreen)
- [ ] Signup writes `createdAt` as an ISO string while everything else
      uses `serverTimestamp()`

## Batch 4 — Tier 1 features

- [ ] **Image upload to Firebase Storage** + `storage.rules` — the
      seller flow is currently impossible without it (products take a
      pasted URL). Biggest single unlock.
- [ ] Live product subscription on Productscreen (currently a frozen
      nav param, so stock and price go stale)
- [ ] Order confirmation screen — the order number is never shown
- [ ] Low-stock alerts on the Store Manager dashboard
- [ ] "Duplicate product" action
- [ ] Firestore offline persistence
- [ ] Swap image rendering to `expo-image` for disk caching

## Batch 5 — the server

One project, not four — they all need the same Cloud Functions
deployment:

- [ ] Server-side order total verification (totals are client-supplied
      and unvalidated)
- [ ] Close the unconstrained product stock decrement — any signed-in
      account can zero out the catalog
- [ ] Firebase App Check (needs `initializeAppCheck` + a custom dev
      build; not a console checkbox on React Native)
- [ ] Transactional email — Help promises a 24h reply with no pipeline
