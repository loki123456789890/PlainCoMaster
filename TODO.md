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
- [ ] `npm install` to resync `package-lock.json`

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
- [ ] **Deferred:** persisted sessions still land on Landing. Auto-routing
      them makes a case newly reachable that isn't today — a customer
      deactivated since their last launch, since a persisted session
      bypasses the login check. Needs AdminContext to expose
      account-active state; belongs with session revocation below.
- [ ] **Deferred, needs a decision:** order status transitions are
      unconstrained apart from cancel. Should a Store Manager be able to
      walk `delivered` back to `pending` to undo a mis-tap, or should
      transitions be forward-only?

## Batch 4 — Tier 1 features (in progress)

- [x] `storage.rules` + `firebase.json` wiring — the bucket was
      configured but ungoverned by anything in this repo
- [x] Storage SDK init and `utils/imageUpload.js` (no schema change —
      the download URL goes in the existing `imageUrl` field)
- [ ] **BLOCKED on `npm install expo-image-picker`** — picker UI in
      AdminAddProductScreen and AdminEditProductScreen
- [ ] Storage rules have no emulator coverage; `npm run test:rules` is
      Firestore-only
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
