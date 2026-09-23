# SRS Update Notes — PlainCo

What changed in the system and therefore needs changing in the SRS.
Organised by the SRS section it affects. Written to be pasted or
paraphrased into the document.

Companion files: [ROLES.md](ROLES.md) (full detail),
[SRS_AUDIT.md](SRS_AUDIT.md) (what was out of sync, and what's now fixed).

---

## 1. User characteristics / Scope — THREE roles, not two

The single "admin" role has been split into two **non-overlapping** roles.
Neither is a superset of the other; they are siblings, not a hierarchy.

| Stored value | Called | Can do | Cannot do |
|---|---|---|---|
| `customer` (or field absent) | Customer | Browse every store, order from several at once, favourite, submit support requests, review items they have received | Reach any staff screen |
| `seller` | **Store Manager** | **One store's** products, orders, support requests, review moderation | Read or modify user accounts, or anything of another store |
| `platformAdmin` | **Platform Admin** | User accounts: grant roles, activate/deactivate; open stores and assign their managers; answer general questions not about an order | Any store's products, orders, order questions, reviews |

Suggested wording:

> PlainCo defines three user roles. Customers browse, purchase from one
> or more stores, and may review items they have received. Each Store
> Manager operates one store — its products, orders, support requests,
> and review moderation — and cannot see any other store's. Platform
> Admins manage user accounts and roles, open stores, and answer general
> questions that are not about an order. The two staff roles are
> deliberately non-overlapping: a Store Manager has no access to user
> accounts, and a Platform Admin has no access to store data. This
> separation is enforced by Cloud Firestore security rules, not merely by
> hiding screens in the interface.

Anywhere the SRS says "admin", decide which of the two it means and say
that instead. The word "admin" alone is now ambiguous. Likewise "the
store": PlainCo has several now (section 10).

---

## 2. Authentication — one staff login, role-based routing

- Staff sign in through a single **Staff Portal**. The account's role
  decides the destination: Store Manager → dashboard, Platform Admin →
  Manage Users.
- The customer login **rejects staff accounts** and redirects them to the
  Staff Portal.
- Deactivated accounts (`isActive: false`) are refused at staff sign-in.

---

## 3. Staff account provisioning — NEW, previously undocumented

The SRS never stated where staff accounts come from. It should.

> Staff accounts are **granted, never self-registered.** There is no staff
> signup. A prospective staff member registers as an ordinary customer,
> and an existing Platform Admin then assigns them the Store Manager or
> Platform Admin role from the Manage Users screen.
>
> This is enforced, not conventional: security rules forbid the `role` and
> `isActive` fields from being set when a user document is created, so no
> account can be registered with a privileged role at any value. The only
> code path that can write `role` is a Platform Admin's update, and that
> path cannot target the Platform Admin's own document.
>
> The first Platform Admin is established by hand in the Firebase console.
> This is a one-time act and the system's root of trust, in the same way
> the first administrator of any permission system is created
> out-of-band.

Why there is no "create account" form, if asked: a client application
cannot create another person's Firebase Auth account —
`createUserWithEmailAndPassword` signs the *caller* in as the new user.
Doing it on someone's behalf requires the Firebase Admin SDK running
server-side, which this project does not use. Promotion also has a
security advantage: the staff member sets and owns their own password, so
it is never known to or transmitted by the Platform Admin.

---

## 4. Security — data type enforcement is now real (SRS Security, p.29)

The SRS already claims "strict data type enforcement on the backend."
Previously the only type check in the rules was the numeric comparison
guarding the checkout stock decrement. It is now implemented across every
writable collection:

- **`users` create** — exact key allowlist, string types, length caps,
  `uid` bound to the authenticated caller, and `role`/`isActive` excluded
  entirely.
- **`products` create** — exact key allowlist, types, non-empty name,
  non-negative price and stock, list types for colours and sizes,
  server-set `createdAt`. **Updates** are validated against the resulting
  document.
- **`supportRequests` create** — exact key allowlist, non-empty message
  capped at 2000 characters, `status` forced to `open`. Staff updates are
  confined to the `status` field only.
- **`orders` create** — no client may create an order at all. Orders are
  written only by the server (the `placeOrder` Cloud Function), which
  prices the cart from the database, deducts stock, and always writes
  `status: 'pending'`, one order per store (section 10). See section 9
  for why "no order can arrive already Delivered" matters more than it
  looks.
- **`orders` update** — only by the Store Manager of the order's own
  store, confined to the `status` field, restricted to the five known
  statuses, and the transition to `cancelled` is allowed only
  from `pending` or `processing`. See section 4a.
- **`reviews` create** — exact key allowlist, `userId` bound to the
  caller, `rating` an integer 1–5, `matchedDescription` a boolean, text
  capped at 1000 characters, `hidden` forced to `false`, server-set
  `createdAt`, and the document id required to match the `orderId` and
  `productId` inside it, and `storeId` required to match the order's
  store. Updates are split into two disjoint branches: the author may
  revise rating, answer, and text and nothing else; the selling store's
  manager may set `hidden` and nothing else. No role may delete. See
  section 9.
- **Activity log collections** — see section 5.

### 4a. Order cancellation restores stock

Checkout decrements product stock in an atomic transaction. Cancelling an
order is now the mirror of it: each line's quantity is added back to its
product's stock **in the same transaction that writes the new status**, so
the two either both land or neither does.

- **Which orders may be cancelled** — `pending` and `processing` only. Past
  that point the goods are with the courier or the customer, and restoring
  stock would invent inventory that doesn't physically exist; a returned
  parcel is a returns flow, not a cancellation. The staff status picker
  disables the Cancelled option for those orders rather than letting a
  manager pick a choice the backend will refuse.
- **No double-restoration** — `cancelled` is not itself a permitted source
  status, so a second cancellation is refused. This is enforced in the
  rules, not just the client, so a double tap, a stale screen, and two
  managers racing each other all land on the same denial. Because the stock
  restore is atomic with the status write, a refused transition rolls the
  restore back with it.
- **No product-rule loosening was needed.** A Store Manager could already
  write stock through the existing seller branch (that is what Edit Product
  does), and the result still has to be a well-typed, non-negative number.
  The customer branch is untouched and still admits decrements only.

**Honest limitation, stated here because the rules cannot close it:**
Firestore evaluates each write in a transaction independently, against its
own document. A rule on `products/{productId}` has no view of the sibling
order write, so "this increment must equal the quantity on the order being
cancelled" is not expressible in rules. It is enforced by the two
properties that are: the transaction computes the amount from the order's
own line items (never from client input), and the order rule admits at most
one `pending`/`processing` → `cancelled` transition per order. What remains
outside that fence — a Store Manager setting stock directly through Edit
Product — is a granted power of the role, recorded in the activity log.
Closing it would require a server-side trigger (Cloud Functions), the same
boundary section 5 draws for the audit log.

**Recommended qualification to add**, because it is more accurate than the
current claim:

> Type and length enforcement bounds what can be stored but does not
> sanitise markup. The cross-site scripting risk described here is a
> web-application concern that does not transfer directly to React Native:
> text is rendered through `<Text>` components, which never interpret
> HTML, so stored markup has no execution path in this application.

---

## 5. Audit functions — now implemented (SRS Constraint 2.4.5)

The SRS asks for logs of user activities (product updates and order
transactions) to help store managers monitor operations. Previously no
such logging existed. It now does, in two collections split along the
same line as the roles:

| Collection | Written by | Records | Readable by |
|---|---|---|---|
| `activityLogs` | Store Manager | Product create / edit / delete, order status changes, review moderation — per store | That store's Store Manager |
| `accountLogs` | Platform Admin | Role grants, account activation / deactivation | Platform Admin |

Both are surfaced in a single Activity screen that selects its collection
from the signed-in role. Store Managers open it from a dashboard tile;
Platform Admins from Manage Users.

Security rules enforce four properties on every entry:

1. **Append-only** — creation is the only permitted write, for every role.
   No entry can be edited or deleted, including by its own author.
2. **Truthful attribution** — the recorded actor must be the
   authenticated caller.
3. **Honest timestamps** — the timestamp must be the server's, so entries
   cannot be back- or post-dated.
4. **Fixed shape** — exactly seven fields, with length caps.

**State this limitation explicitly in the SRS:**

> Log entries are written by the client immediately after the action they
> describe. Security rules can guarantee that an entry is well-formed,
> correctly attributed, and never altered, but cannot compel a modified
> client to write one. This is therefore an operational activity log for
> monitoring, as this document specifies, and not a tamper-proof audit
> trail for dispute resolution. Producing the latter would require
> server-side database triggers.

---

## 6. Account deactivation — add the sole-admin consideration

Existing behaviour is unchanged: accounts are deactivated
(`isActive: false`), never deleted, so completed sales remain auditable
(SRS §2.4). Worth adding:

> Because only a Platform Admin can restore an account, the last active
> Platform Admin is a single point of failure: if that account is lost,
> account management cannot be recovered from within the application.
> Security rules prevent a Platform Admin from deactivating themselves
> through the Manage Users screen, and the interface warns whenever only
> one active Platform Admin exists. **The operational requirement is to
> maintain at least two active Platform Admin accounts.**

---

## 7. New screen to add to the module list

**Activity Log screen** — one screen serving both staff roles, showing
each its own log (Store Activity or Account Activity). Includes search and
a chronological list with actor and timestamp.

**Write a Review screen** (customer) — reached from a delivered order,
one review per item on that order. See section 9.

**Reviews screen** (Store Manager) — the moderation queue for their own
store, opening on the reviews that reported an item did not match its
description. See section 9.

**Store page** (customer) — one store's catalogue with its profile and
seller rating, opened from the Shop's "Shop by store" row or a product's
"Sold by" line. Technically the Shop screen narrowed to one store rather
than a separate screen. See section 10.

**Stores in Edit User** (Platform Admin) — not a new screen: choosing
Store Manager in Edit User now also asks which store, with "Open a new
store". See section 10.

**Order Chat screen** (customer and Store Manager) — one conversation per
order, opened from Order Details ("Message \<store\>") or Manage Orders
("Message Buyer"). See section 11.

**Store Profile screen** (Store Manager) — the store's logo and
description, from a new dashboard tile. See section 12.

---

## 8. Verification — worth a short section if the SRS has one

The security rules have an automated test suite: **130 tests** run against
the Firestore emulator via `npm run test:rules`. Coverage includes
privilege escalation attempts, role separation in both directions, field
validation, checkout stock rules, order cancellation, audit log
integrity, order creation, the verified-purchase chain behind reviews,
store separation (section 10), order chat (section 11) and profiles
(section 12).
Notable cases:

- A signup cannot set a privileged role.
- A customer cannot promote themselves or anyone else.
- A Store Manager cannot read user accounts.
- A Platform Admin cannot modify products or read orders.
- Cancelling an order restores its stock; cancelling it twice does not.
- Cancelling a shipped or delivered order is rejected outright.
- Log entries cannot be forged, backdated, edited, or deleted.
- An order cannot be created already marked Delivered.
- A product that was not on the order cannot be reviewed through it.
- A review cannot be written against another customer's order.
- A Store Manager may hide a review but cannot edit or delete one.
- A Store Manager cannot read, change or cancel another store's products
  or orders, and cannot move a product to another store.
- A review must name the store that sold the item.
- A support request goes to the store of the order it names, or to the
  Platform Admin, and the rules check that routing against the order.
- Only an order's customer and its store can read or send in its chat;
  a message cannot be deleted, edited after 15 minutes, or sent in
  someone else's name.

---

## 9. Reviews and seller ratings — from panel feedback

A panellist asked for "reviews for seller and customer". PlainCo now has
the first of those and deliberately not the second.

**How the answer changed.** When reviews were first built PlainCo was a
single store, and this section said so: a seller rating would have been
one number with nothing to compare it against, so the feature was built
as product reviews only. PlainCo is now multi-store (section 10), which is
what the title always described — "Ukay-Ukay and Ready-to-Wear *Stores*".
With several stores a seller rating finally carries information, so it has
been added. It is built from the same product reviews rather than from a
separate form; see "Seller ratings" below.

**Customer ratings are still declined.** A store accepts every order, so a
rating of buyers would feed no decision any store makes, while publishing
reputation data about consumers. If the SRS needs a sentence:

> PlainCo does not rate customers. Stores accept every order, so a buyer
> rating would inform no decision, and it would publish reputation data
> about private individuals.

Suggested wording for the feature:

> Customers may review a product they have purchased, once the order
> containing it has been marked Delivered. A review records a 1–5 star
> rating, an answer to "did the item match its description?", and optional
> free text. Reviews are visible to all signed-in users on the product
> page. Each review is filed with the store that sold the item, and a
> store's seller rating is the summary of those reviews: its average
> rating, how many reviews it has, and the share of buyers who said the
> item matched its description. The seller rating is shown on the store's
> page, beside the store in the Shop, and under "Sold by" on each of its
> products.

**The verified-purchase chain.** "Verified" is enforced in
`firestore.rules`, not asserted by the interface, and it is a chain of
four links:

1. Orders are created only by the server (the `placeOrder` Cloud
   Function), always in status `'pending'`. No client can create an order
   at all, so none can create one that arrives already Delivered.
2. Only the Store Manager of the store that sold an order may move it to
   `'delivered'`.
3. A review is accepted only against the author's **own** order, in status
   `'delivered'`, containing the product being reviewed.
4. The review must name the store on that order. A review cannot be filed
   against a different store's rating.

Without link 1, a client could mint its own proof of purchase and review
any product it named. Without link 4, a buyer from one store could lower
another store's rating.

**One review per order line** is structural rather than conventional: the
review's document id is derived as `orderId_productId` and the rule
requires it to match the fields inside, so a duplicate is a write to a
document that already exists. Buying the same item again on a later order
earns a second review, which is correct.

**Seller ratings.** There is no "rate this seller" form. A store's rating
is its product reviews summarised, which gives it three properties a
separate seller review would not have:

- **Only real buyers count.** Every review behind it passed the chain
  above, so every one is from a delivered order from that store.
- **One store's record never leans on another's.** Each review carries
  the store that sold the item, checked against the order.
- **It is recent, and says so.** The rating is computed from the store's
  most recent 100 reviews. Once a store has more than that, the app says
  "last 100 reviews" rather than implying that is the full history.

The average is shown with its review count beside it, so a perfect score
from one review cannot pass for a perfect score from a hundred.

**The ukay-ukay problem, and why "did it match the description?" exists.**
Secondhand pieces are frequently one of a kind — stock 1, sold once — so a
per-product average is a permanent sample of one, and most product pages
would read "No reviews yet" forever. "Did it match the description?" is
the same question about every listing a store makes, so it aggregates
across the store and says something useful about an item nobody has
reviewed yet. A product with no reviews of its own shows **its seller's**
figure instead of an empty state ("Across Tindahan ni Lola's 12 reviews,
92% said the item matched its description"). It is the seller's figure
and not the whole platform's, because one store's honesty about condition
says nothing about another's.

**Moderation is hiding, never deletion.** Only the Store Manager of the
store that sold the item may set a review's `hidden` flag, and nothing
else — the rules grant no delete on reviews to any role, no write to a
review's rating or text, and no moderation to other stores or to the
Platform Admin. Hidden reviews are left out of the seller rating, and the
rating updates immediately when one is hidden or restored. This mirrors
the existing decision that accounts are deactivated rather than deleted
(SRS §2.4), and for the same reason: a store that can erase reviews can
erase the unflattering ones, and no reader could tell a clean record from
a cleaned one. Every hide and restore is written to that store's activity
log.

State this plainly in the SRS, since it is the obvious objection: a store
can hide reviews of its own items, and hiding does lift its rating. What
the design guarantees is that the review itself survives unaltered, and
that every hide is recorded under the manager's name in the store's
activity log. Taking moderation away from the store — to the Platform
Admin, say — is the stronger answer, and a reasonable future change.

**Privacy.** A review displays the author's first name and last initial
("Hans V."), abbreviated at write time so the full name is never stored in
a document other shoppers can read.

**Honest limitations:**

- Ratings are computed on the device from the reviews themselves, not
  stored as counters on the product or store. A server-side trigger
  maintaining those counters is the production answer; the project now has
  Cloud Functions, so it is buildable, but it has not been built. A
  client-maintained counter would be tamperable, so none is kept.
- Firestore rules cannot inspect a query's filters, so a hidden review is
  still fetchable by a client querying the collection directly. The app
  leaves hidden reviews out of every list and every rating it shows, and
  the rules guarantee that hiding is the only moderation available and
  that it is logged.
- Orders placed before reviews existed carry no `productIds` field, and
  their lines cannot be reviewed. Failing in that direction is deliberate:
  the alternative would make the check optional for any write that
  omitted the field.

### 9a. New use case — Write a Review

For the SRS's use-case section, in the same shape as the existing entries:

> **Use case:** Write a Review
> **Actor:** Customer
> **Precondition:** The customer is signed in, and an order belonging to
> them containing the item has status Delivered.
> **Trigger:** The customer opens the order under My Orders and selects
> "Write a review" on one of its items.
>
> **Main flow:**
> 1. The system displays the purchased item, marked Verified purchase.
> 2. The customer selects a rating of 1 to 5 stars.
> 3. The customer answers whether the item matched its description.
> 4. The customer optionally writes up to 1000 characters of detail.
> 5. The customer submits.
> 6. The system stores the review, filed with the store that sold the
>    item, and confirms.
>
> **Postcondition:** The review is visible on the product page to all
> signed-in users, attributed to the author's first name and last initial,
> and counts toward the selling store's seller rating. The order line now
> offers "Edit your review" instead.
>
> **Alternate flows:**
> - *Already reviewed* — the form opens pre-filled with the existing
>   review and submitting replaces it, rather than refusing the customer a
>   second attempt to say something more useful.
> - *Incomplete* — submission stays disabled until both the rating and the
>   description question are answered; the free text is optional. The
>   button states which of the two is still missing.
> - *Rejected by the backend* — the customer is told reviews are limited to
>   items from a delivered order, in those terms rather than as a
>   permissions error.
> - *Offline* — submission is refused with the app's standard
>   no-connection message and nothing is written.

**Note on step 3.** The description question is a required answer with no
default, and "not yet answered" is held distinct from "no" in the
interface. A field this central must not be able to record a complaint the
customer never made by leaving it untouched.

There is no separate use case for seller ratings: nobody writes one. It is
a display that follows from Write a Review, and belongs in the Browse
Products / View Store description (section 10).

### 9b. Data model — one new collection, one changed field

**New collection: `reviews/{orderId}_{productId}`.** The document id is
derived rather than random; see the note on one review per order line
above.

| Field | Type | Notes |
|---|---|---|
| `orderId` | string | The delivered order the review was earned on. Immutable after creation. |
| `productId` | string | The item reviewed. Immutable after creation. |
| `storeId` | string | The store that sold the item. Must equal the order's `storeId`; immutable. What the seller rating is grouped by. |
| `productName` | string ≤ 120 | Snapshot at write time — a product can be renamed after the sale. |
| `userId` | string | The author. Bound to the authenticated caller; immutable. |
| `userName` | string ≤ 60 | First name and last initial. Snapshot, because `/users` is unreadable to other shoppers. |
| `rating` | integer 1–5 | Whole stars only. |
| `matchedDescription` | boolean | "Did the item match its description?" |
| `text` | string ≤ 1000 | Optional free text. |
| `hidden` | boolean | Moderation flag. Always `false` at creation; only the selling store's manager may change it. |
| `createdAt` | timestamp | Server-set; cannot be backdated. |
| `updatedAt` | timestamp | Present only on a revised review. Server-set. |

**Changed collection: `orders`** — one field added for reviews (the
multi-store fields are in section 10).

| Field | Type | Notes |
|---|---|---|
| `productIds` | array of string | The flat list of product ids appearing in `items[]`. |

This is denormalised rather than derived because Firestore security rules
cannot read a field out of each map in a list, so "is this product on this
order?" is unanswerable against `items[]` alone. The review rule needs
exactly that question answered, and membership of a flat array is the only
form the rules language can evaluate. It duplicates data already present
in `items[]`, and that duplication is the price of making the check
enforceable on the backend rather than trusting the client.

---

## 10. Multi-store — NEW, from panel feedback

The title promises an e-commerce app "for Ukay-Ukay and Ready-to-Wear
**Stores**", plural, and a panellist asked for it. PlainCo is now
multi-store: several stores sell through one app, each run by its own
Store Manager, and a shopper can buy from several in one checkout.

> **Status (23 Sep 2026): LIVE.** Kept out of the UAT build on purpose,
> and released to production after the UAT: indexes, data migration,
> rules, Cloud Functions and the web app, in that order. Sections 9 and 10
> describe the system as deployed. The UAT itself was run on the
> single-store build, so any SRS text describing *what was tested in the
> UAT* should still say single store.
>
> **The live stores.** The catalogue that existed before the release was
> split by product type into two stores, named after common Filipino
> shop names rather than the app:
>
> | Store | Sells | Manager |
> |---|---|---|
> | Ukay-Ukay ni Aling Nena | the 7 ukay-ukay listings | the three original Store Managers |
> | Divisoria RTW Hub | the 8 ready-to-wear listings | estes@gmail.com |
>
> Past orders went with their items: an order of only ready-to-wear
> pieces moved to Divisoria RTW Hub, and every other order stayed with
> Ukay-Ukay ni Aling Nena. Done by a one-time script
> (`scripts/split-stores.mjs`), which shows what it will change before
> changing it and is safe to run twice.

**Replace every sentence in the SRS that says PlainCo is a single store.**
Earlier drafts of these notes said so in writing (the old section 9); the
phrases to look for are "the store", "one store", and "the seller".

Suggested wording for the scope:

> PlainCo is a multi-store platform. Independent ukay-ukay and
> ready-to-wear stores each list and sell their own products through one
> shared app. Each store is run by a Store Manager, who manages that
> store's products, orders, customer questions and reviews, and cannot see
> or change any other store's. A Platform Admin opens stores and assigns
> their managers. Customers browse all stores together or one store at a
> time, and may buy from several stores in a single checkout.

### What changed, by SRS area

**Roles (section 1).** A Store Manager now runs **one** store, named on
their account, rather than "the shop". The Platform Admin additionally
opens stores and answers general questions that are not about any store's
order. Both are still enforced in `firestore.rules`, not by hiding
screens.

**Opening a store.** Stores are opened by a Platform Admin, from the same
Edit User form that makes someone a Store Manager: choose Store Manager,
then pick an existing store or "Open a new store" and name it. The store
and its first manager are saved in one write, so there is never a store
without a manager or a manager without a store. There is **no vendor
self-signup**, for the same reason there is no staff signup (section 3).
Stores can be renamed, never deleted, because products and past orders
point at them.

**Products.** Every product belongs to the store that listed it. A Store
Manager can add, edit, restock and delete only their own store's
products, and a product cannot be moved to another store.

**Browsing (customer).** The Shop lists every store's products together,
each marked with its store, and has a "Shop by store" row showing each
store with its item count and seller rating. Tapping a store opens its
page: the same catalogue narrowed to that store, with search and filters,
and a short profile — what it sells (Ukay-Ukay, Ready-to-Wear or both,
worked out from its own listings), when it joined PlainCo, and its seller
rating. Every product page says "Sold by" and links to its store.

**Checkout: one order per store.** A cart holding items from several
stores checks out once, with one payment, and becomes **one order per
store**. This is what lets each store see and fulfil only its own part.
The split is done on the server by the `placeOrder` Cloud Function in a
single transaction:

- Every store's order is written, and every item's stock deducted, or
  nothing is. One store being short on stock stops the whole checkout,
  rather than charging the customer for half a cart.
- A declined payment writes nothing for any store.
- The orders share a checkout reference, and one payment covers them all.
- The confirmation screen and the email receipt name the store beside
  each order number, and list each store's items separately.
- Shipping is currently free and is recorded per store's order, so per-
  store shipping rates can be added later without changing the order
  shape.

Suggested addition to the Checkout use case:

> **Alternate flow — items from several stores:** the system places one
> order per store, each with its own order number, under a single payment.
> If any item is out of stock, no order is placed for any store.

**Orders (staff).** A Store Manager sees only their own store's orders,
and only they may change an order's status or cancel it. Cancelling
restores stock only to their own store's products (section 4a is
unchanged otherwise). The customer still sees all their orders together,
each labelled with its store.

**Support: routed by order.** The Help form asks "Is this about an
order?" and lists the customer's recent orders. A question about an order
goes to **that order's store**. A general question goes to the
**Platform Admin**, who answers it from an "Open questions" card in Manage
Users. The rules check that the order named really is the customer's and
really belongs to that store, so a question cannot be routed into another
store's inbox. Email notifications and "Send again" follow the same
routing.

Suggested wording:

> Customers may attach a support request to one of their orders, in which
> case it is delivered to the store that fulfilled that order. Requests
> not about an order are delivered to the Platform Admin.

**Reviews and ratings.** Section 9.

**Audit (section 5).** The store activity log is kept per store: each
entry records its store, and a Store Manager reads only their own store's
entries. The account log is unchanged.

### Data model changes

**New collection: `stores/{storeId}`.**

| Field | Type | Notes |
|---|---|---|
| `name` | string, 1–60 | Shown to shoppers. Only a Platform Admin may set or change it. |
| `createdAt` | timestamp | Server-set. Shown as "On PlainCo since". |

**New field `storeId` on existing collections.**

| Collection | Meaning | Rule |
|---|---|---|
| `users` | The store a Store Manager runs | Required for a Store Manager, absent for everyone else; set only by a Platform Admin. |
| `products` | The store that listed it | Must be the listing manager's own store; cannot change afterwards. |
| `orders` | The store fulfilling this order (also `storeName`, and `checkoutId` linking orders paid together) | Written by the server at checkout. |
| `reviews` | The store that sold the item | Must equal the order's store. |
| `activityLogs` | The store the entry is about | Must be the writer's own store. |
| `supportRequests` | The store the question is for, or `null` for the Platform Admin | Checked against the named order. |
| `mailLog` | The same routing as the request or order it is about | Written by the server. |

**Existing data.** Accounts, products and orders created before stores
existed have no `storeId`, and the rules leave them untouched rather than
guess an owner. A one-time script (`scripts/migrate-to-stores.mjs`)
assigns them to a first store. It shows what it will change before it
changes anything, and running it twice changes nothing the second time.

### Out of scope, and worth saying so in the SRS

Payouts to stores, platform commissions, vendor self-signup and per-store
shipping rates. Those make PlainCo a marketplace to *operate* rather than
one to *demonstrate*, and each is a business decision as much as a
technical one. Suggested wording:

> Payment is collected by the platform on behalf of all stores. Settlement
> between the platform and individual stores, commissions, and store
> self-registration are outside the scope of this project.

### Verification

Every rule above is covered by the automated rules test suite (section
8), including: a manager cannot change, cancel or read another store's
products, orders or activity log; a product cannot be moved between
stores; only a Platform Admin can open a store, and stores cannot be
deleted; a review must name the store that sold the item, and another
store cannot hide it; and a support request is routed by its order, and
cannot be moved into another store's inbox. The checkout tests cover the
split: a two-store cart becomes one order per store under one payment,
and a decline, or one store being short on stock, writes nothing for
either store.

---

## 11. Order chat — NEW, added after the UAT

Before this, a customer could send a store a support request, and the
store could only mark it resolved; any reply happened outside the app.
Order chat closes that gap, modelled on the buyer–seller chat in TikTok
Shop and on Messenger's message actions. It suits secondhand stock in
particular: every ukay-ukay piece is one of a kind, so a seller can send
a photo of the exact item before it ships, and a buyer can show how it
arrived.

> **Status (23 Sep 2026):** built and tested; security rules deployed to
> production. The screens reach the live web app and the APK with the
> next release (version 1.1.0, build 2).

### Scope — suggested wording

> Each order has a private conversation between the customer who placed
> it and the Store Manager of the store fulfilling it. Either party may
> send text and photos. Messages appear in real time while the
> conversation is open, and both order lists mark orders that have an
> unread message. A participant may react to any message with one of six
> emoji, reply to a specific message, copy a message's text, edit their
> own message within 15 minutes of sending it, and unsend their own
> message. No one else — not other stores, and not the Platform Admin —
> can read or write a conversation.

### Functional requirements

| # | Requirement |
|---|---|
| FR-C1 | The customer can open a conversation with the fulfilling store from Order Details ("Message \<store\>"). |
| FR-C2 | The Store Manager can open the same conversation from the order in Manage Orders ("Message Buyer"). |
| FR-C3 | Either party can send a text message of up to 1000 characters, a photo (JPEG, PNG or WebP, up to 5 MB), or a photo with a caption. |
| FR-C4 | New messages appear without refreshing, and the list stays on the newest message. |
| FR-C5 | An order with a message the viewer has not read shows "New message" in My Orders (customer) and in Manage Orders (Store Manager). Opening the conversation clears it. |
| FR-C6 | Long-pressing a message opens a menu with six reactions (❤️ 😆 😮 😢 😠 👍) and the actions that apply to that message. |
| FR-C7 | **React:** each participant may set one reaction per message, and change or remove it. |
| FR-C7a | **See and remove reactions:** tapping the reactions under a message lists who reacted with which emoji; the participant's own reaction has a Remove button. The long-press menu also offers "Remove your \<emoji\> reaction", and choosing the highlighted emoji again removes it. |
| FR-C8 | **Reply:** the new message shows a quote of the message it answers. |
| FR-C9 | **Copy text:** copies the message's text to the device clipboard. |
| FR-C10 | **Edit:** the sender may change the text of their own message within 15 minutes of sending it. The message is then labelled "Edited". |
| FR-C11 | **Unsend:** the sender may unsend their own message after confirming. It is replaced for both parties by "You unsent a message" / "\<name\> unsent a message". |
| FR-C12 | Tapping a photo opens it full screen. |

### New use case — Message about an Order

> **Use case:** Message about an Order
> **Actors:** Customer, Store Manager
> **Precondition:** The actor is signed in, and is either the customer who
> placed the order or the Store Manager of the store fulfilling it.
> **Trigger:** The customer selects "Message \<store\>" on Order Details,
> or the Store Manager selects "Message Buyer" on an order.
>
> **Main flow:**
> 1. The system shows the conversation for that order, newest message at
>    the bottom, and marks it read for the actor.
> 2. The actor types a message, optionally attaching a photo from the
>    camera or photo library.
> 3. The actor sends it.
> 4. The system stores the message and shows it to both parties. The
>    other party's order list shows "New message" until they open the
>    conversation.
>
> **Alternate flows:**
> - *Long-press actions* — the actor long-presses a message and chooses a
>   reaction, Reply, Copy text, Edit or Unsend (FR-C6 to FR-C11). Edit and
>   Unsend are offered only on the actor's own messages, and Edit only
>   within 15 minutes.
> - *Photo refused* — a photo over 5 MB or in an unsupported format is
>   refused before upload, with the reason.
> - *Offline* — the send button is disabled and a banner says messages
>   cannot be sent.
> - *Not a participant* — the backend refuses the read or write; the
>   screen reports that messages could not be loaded or sent.

### Business rules / security (enforced by security rules, not the UI)

- Only the customer who placed the order and the Store Manager of its
  store can read or send messages in its conversation.
- A message is stamped with the sender's account and side (customer or
  store) and the server's time; no one can send as someone else.
- Messages can never be deleted. **Unsend** removes the content but
  leaves a visible placeholder, and **Edit** leaves an "Edited" label, so
  a conversation about a disputed order remains a record of what was
  said.
- Editing is allowed only within 15 minutes, measured on the server's
  clock so a device cannot fake it.
- A participant can set or remove only their own reaction, and only one
  of the six offered.
- Opening a conversation marks it read only for the actor's own side,
  and cannot change anything else on the order (status, total, address).
- Chat photos are stored per order and can be uploaded only by the two
  participants.

### Data model changes

**New subcollection: `users/{uid}/orders/{orderId}/messages/{messageId}`.**

| Field | Type | Notes |
|---|---|---|
| `senderId` | string | The sender's account. Must be the signed-in user. |
| `sender` | `'customer'` or `'store'` | Which side sent it. |
| `text` | string, ≤ 1000 | May be empty only when there is a photo. Emptied on unsend. |
| `imageUrl` | string, optional | Download URL of the photo. Removed on unsend. |
| `createdAt` | timestamp | Server time. |
| `replyTo` | map, optional | `{ id, text (≤ 200), sender, hasImage }` — the quoted message. |
| `reactions` | map, optional | `{ <uid>: <emoji> }`, one entry per participant. |
| `editedAt` | timestamp, optional | Set when edited. |
| `deleted`, `deletedAt` | boolean, timestamp | Set when unsent. |

**New fields on `orders`** (for the "New message" marker):

| Field | Type | Notes |
|---|---|---|
| `lastMessageAt` | timestamp | Time of the latest message. |
| `lastMessageBy` | `'customer'` or `'store'` | Who sent it. |
| `customerReadAt` | timestamp | When the customer last opened the conversation. |
| `storeReadAt` | timestamp | When the store last opened it. |

**New Storage path:** `chat/{customerId}/{orderId}/{file}` for chat
photos.

### Screens — add to the module list (section 7)

- **Order Chat** (customer and Store Manager) — one screen used by both.
  Reached from Order Details ("Message \<store\>") and from Manage
  Orders ("Message Buyer").
- **Order Details** (customer) — gains the "Message \<store\>" card.
- **My Orders** / **Manage Orders** — gain the "New message" marker.

### Limitations — for the Limitations / Future Work section

- **No push notifications.** Messages arrive in real time only while the
  app is open; the phone is not notified otherwise. The "New message"
  marker is how an unread message is noticed.
- **An unsent photo is unlinked, not destroyed.** It disappears from the
  conversation, but the file stays in cloud storage, where no one can
  reach it through the app.
- A conversation shows its latest 200 messages.
- Chat is per order. Asking a store a question before buying is not
  supported; the Help screen covers general questions.

### Verification

The rules test suite (section 8) grew from 114 to **127** tests. The
chat tests check that:
- only the two participants can read or send;
- nobody can send as someone else or as the other side;
- malformed, empty, oversized or backdated messages are refused;
- no one can delete a message outright;
- editing works only for the sender, only within 15 minutes, and is
  always marked;
- unsending leaves a placeholder and cannot be undone;
- reactions are limited to your own entry and the six emoji;
- the read markers cannot be used to change an order's status or total.

The full flow was also exercised in the app against the local emulators:
a customer messaged a store, the Store Manager saw "New message" and
replied with a photo, the marker cleared when the customer opened the
conversation, and react, reply, copy, edit and unsend each worked.
Sending and the on-screen keyboard behaviour were then checked on an
Android phone against production.

---

## 12. Profiles — customer photo and email verification, store profile

Before this, a customer could edit only their name, and a store was
known to shoppers only by its name, item count and rating.

> **Status (23 Sep 2026):** built and tested; reaches production with the
> next release (rules, storage rules, web app, APK).

### Customer profile — suggested wording

> A customer may add, change or remove a profile photo, taken with the
> camera or chosen from the photo library. The photo is shown on their
> profile and beside the reviews they write. The profile shows whether
> the customer's email address is verified; an unverified customer can
> request a verification link by email. The customer's phone number is
> kept with their saved delivery address, which the profile links to.

**Deliberately not collected: gender, birthday, bio.** PlainCo makes no
use of them — there are no birthday offers, no gender-based
recommendations, and customers have no public page for a bio. Under the
Data Privacy Act of 2012 (RA 10173), personal data collected must be
adequate, relevant and not excessive for its purpose, so fields with no
purpose are left out. Suggested wording:

> In line with the proportionality principle of the Data Privacy Act of
> 2012, PlainCo collects only the personal information needed to deliver
> orders and support the account: name, email address, an optional
> profile photo, and a delivery address with a contact number.

### Store profile — suggested wording

> Each store has a profile: a logo and a short description of up to 300
> characters, edited by that store's Store Manager from the Store Profile
> screen. The logo and description appear on the store's page, the logo
> in the Shop's "Shop by store" row and at the top of a customer's order
> chat with the store. A store's name can be changed only by a Platform
> Admin, because it is recorded on the store's past orders and reviews.

**Platform Admin:** no profile added. Platform Admins are never shown to
customers, and their account details are managed in Manage Users.

### Functional requirements

| # | Requirement |
|---|---|
| FR-P1 | A customer can add, change or remove their profile photo (camera or library; JPEG, PNG or WebP up to 5 MB). |
| FR-P2 | A customer's photo is shown beside reviews they write after setting it. |
| FR-P3 | The profile shows "Email verified" or "Not verified · Verify now"; Verify now sends a verification email. The status changes to "Email verified" by itself within seconds of the link being opened — on switching back to the app, or while the profile is open — without signing out. |
| FR-P4 | The profile links to the saved delivery address and phone number. |
| FR-S1 | A Store Manager can set, change or remove their store's logo and description from Store Profile, with a preview of how shoppers will see it. |
| FR-S2 | The store's logo and description appear on its store page; the logo also appears in "Shop by store" and in the customer's order chat header. |
| FR-S3 | A Store Manager cannot change the store's name, or another store's profile. |

### Business rules / security (enforced by security rules)

- A customer can change only their own `photoUrl`, and no other field in
  the same write.
- Only a store's own manager can change its `logoUrl` and `description`;
  only a Platform Admin can change its `name`.
- Profile photos can be uploaded only by the account they belong to;
  store logos only by that store's manager.

### Data model changes

| Where | New field | Notes |
|---|---|---|
| `users` | `photoUrl` (string, optional) | Set only by the account itself. |
| `stores` | `logoUrl` (string, optional), `description` (string ≤ 300, optional) | Set only by the store's manager. |
| `reviews` | `userPhotoUrl` (string, optional) | The author's photo, copied when the review is written, like `userName`. |
| Storage | `avatars/{uid}/…`, `stores/{storeId}/…` | Profile photos and store logos. |

### Screens — add to the module list (section 7)

- **Store Profile** (Store Manager) — new; reached from a new tile on the
  Store Manager dashboard.
- **Profile** (customer) — gains the photo, email verification status and
  the Delivery Address & Phone link.

### Limitations

- A review keeps the photo its author had when writing it; changing the
  profile photo later does not update old reviews.
- The Store Manager does not see the customer's photo in order chat:
  customer accounts are private to the customer.

### Verification

Rules test suite 127 → **130**: a customer can set and remove only their
own photo and cannot slip another field into the same write; a Store
Manager can edit only their own store's logo and description, not its
name, and not another store's; a deactivated manager cannot; a review
may carry the author's photo, within the length limit. The flows were
also run in the app against the local emulators: a customer set a photo
and requested verification, a Store Manager set a logo and description,
and a shopper saw them on the store page and in "Shop by store".

---

## 13. Onboarding redesign — icon, splash, landing, sign up, log in, password reset, Privacy Policy, Staff Portal

The first screens a new user sees were redesigned from approved HTML
previews, as one continuous flow rather than separate pages.

> **Status (23 Sep 2026):** built and tested against the local emulators;
> reaches production with the next release (web app and APK). No
> database, security-rule or Cloud Function changes.

### What changed — suggested wording

> **App icon.** A cream "P" on a Clay tile, on both iOS and Android
> home screens.
>
> **Launch splash.** The Clay tile appears on a cream background, shrinks
> to the left as the "plainco" wordmark slides out beside it, and the
> Clay dot drops onto the "i". For a signed-out user the logo then
> glides up to become the Landing screen's header; for a signed-in user
> the splash fades straight into Home.
>
> **Landing.** Under the logo: "Ukay-Ukay · Ready-to-Wear", the headline
> "Pre-loved finds. Brand-new styles. One app.", two category cards
> (Ukay-Ukay and Ready-to-Wear), **Get Started**, **Log In**, and a link
> to the Staff Portal. The logo stays in place when moving to Sign Up,
> Log In or Forgot Password; only the content below it changes.
>
> **Sign Up** checks each field as the user leaves it and shows the
> result under the field. **Create Account** stays disabled until every
> field is valid and the Privacy Policy is agreed to. On success the
> button shows "Account created" and the user is taken to Home.
>
> **Log In** reports problems in a notice above the form rather than a
> pop-up: incorrect email or password, a deactivated account, or a staff
> account (with a link to the Staff Portal).
>
> **Forgot Password** carries over the email typed on Log In, sends a
> reset link, and confirms with "Check your email". The confirmation is
> the same whether or not an account exists for that email.
>
> **Privacy Policy** opens as a sheet from Sign Up and from Profile, with
> jump-to-section chips and a reading-progress bar. From Sign Up it has
> an **I Agree** button that ticks the consent box.
>
> **Staff Portal** is the same sign-in form on a dark background, marked
> "Staff Portal", for Store Managers and Platform Admins. It reports
> problems above the form: incorrect email or password, a deactivated
> staff account, or a customer account (with a link back to the customer
> log in). On success it names the role ("Signed in as Store Manager" or
> "Signed in as Platform Admin") and opens the store dashboard or Manage
> Users. When a staff account is typed into the customer Log In, or a
> customer account into the Staff Portal, the link to the other screen
> carries the email over.

### Functional requirements

| # | Requirement |
|---|---|
| FR-O1 | On launch, the app plays the logo animation, then shows Landing to a signed-out user or Home to a signed-in one. |
| FR-O2 | Sign Up requires a full name (at least 2 characters), a valid email address, a password of **at least 8 characters**, a matching confirmation, and agreement to the Privacy Policy. Each field shows its own error or confirmation. |
| FR-O3 | If the email is already registered, Sign Up says so on the email field ("An account with this email already exists. Try logging in."). |
| FR-O4 | Log In shows, above the form: "Incorrect email or password" (and clears the password), "This account has been deactivated", or, for a Store Manager or Platform Admin account, that staff sign in through the Staff Portal, with a link to it. In each case the user is left signed out. |
| FR-O5 | Forgot Password sends a reset link and shows the same confirmation whether or not the email is registered. The link can be resent after 60 seconds. |
| FR-O6 | The Privacy Policy can be read before agreeing. **I Agree** ticks the consent box; closing it does not. The policy can be re-read from Profile at any time. |
| FR-O7 | Log In and Sign Up link to each other, and the back arrow on either returns to Landing. |
| FR-O8 | The Staff Portal admits only Store Manager and Platform Admin accounts that are active. It shows, above the form: "Incorrect email or password" (and clears the password), "This staff account has been deactivated", or, for a customer account, that customers sign in on the main log-in screen, with a link to it. In each case the user is left signed out. A Store Manager lands on the store dashboard and a Platform Admin on Manage Users. |

**Changed requirement — minimum password length is now 8 characters**
(was 6). This applies to new accounts only; existing accounts still log
in with their current passwords.

### Use-case updates

- **Register — alternate flow "Email already in use":** the error now
  appears on the email field and the form stays filled in, instead of a
  pop-up.
- **Log In — alternate flows "Invalid credentials", "Deactivated account"
  and "Staff account":** the message now appears in a notice above the
  form. The staff case offers a link to the Staff Portal.
- **New use case — Reset Password** (fills the gap listed in section 15):
  the user taps "Forgot password?" on Log In, enters their email and taps
  Send Reset Link. *Postcondition:* a reset email is sent if an account
  exists; the confirmation screen is identical either way, so the screen
  cannot be used to discover which emails are registered.
- **Staff Login — alternate flows "Invalid credentials", "Not a staff
  account" and "Deactivated account":** the message now appears in a
  notice above the form instead of a pop-up. The customer-account case
  offers a link to the customer log in. "Forgot password?" uses the same
  Reset Password use case as customers.

### The Privacy Policy text

The in-app policy follows the approved preview, with four corrections
made after checking each statement against the app:

1. **Payments:** the preview had a placeholder. The policy states that
   payments in this version are simulated: the user can choose GCash,
   Maya, Card or Cash on Delivery, no money is charged, and no card or
   e-wallet details are collected or stored.
2. **Contact:** the preview had a "[support email]" placeholder. The
   policy points to the Contact Support form in the Help Center, which
   is the channel the app actually provides.
3. **Added:** the optional profile photo, photos sent in order chat, the
   order-confirmation email, and Cloud Storage (where photos are kept).
4. **Review names:** the policy states that reviews show the author's
   first name and last initial (e.g. "Juan D.") and profile photo, not
   the full name, matching section 9.

Full text, for an appendix:

> **Privacy Policy** — Last updated: September 2026
>
> PlainCo connects you with local Ukay-Ukay and Ready-to-Wear stores.
> This policy explains what personal information we collect, why we need
> it, and the rights you have under the Data Privacy Act of 2012
> (Republic Act No. 10173).
>
> **1. Information we collect**
> - *Account details:* your name, email address, and password (passwords
>   are handled by Firebase Authentication and are never visible to
>   PlainCo or store staff).
> - *Profile photo (optional):* a picture you choose to add. It appears
>   on your profile and next to your reviews.
> - *Delivery details:* recipient name, phone number, street address,
>   city, province, and ZIP code.
> - *Location (optional):* only when you tap "Use Current Location," to
>   fill in your address. We do not track your location in the
>   background.
> - *Shopping activity:* your cart, favorites, orders, reviews, and the
>   messages and photos you send to a store about an order.
>
> **2. How we use your information**
> - To create and secure your account.
> - To process your orders and deliver them to you.
> - To email you a confirmation when you place an order.
> - To show your order status and let you message the store about an
>   order.
> - To display your reviews on products you have purchased.
>
> We do not sell your personal information or use it for advertising.
>
> **3. Who can see your information**
> When you place an order, the store you ordered from sees your name,
> delivery address, phone number, order details, and your messages about
> that order, so they can fulfil it. Stores cannot see your orders from
> other stores. PlainCo platform administrators can access account
> records to manage users and resolve issues. Your reviews are shown to
> other PlainCo shoppers with your first name and last initial (for
> example, "Juan D.") and your profile photo. Your full name is not
> shown.
>
> **4. Payments**
> Payments in this version are simulated. You can choose GCash, Maya,
> Card, or Cash on Delivery, but no money is charged in the app, and
> PlainCo does not collect or store card or e-wallet details.
>
> **5. How your data is stored and protected**
> Your data is stored on Google Firebase (Authentication, Cloud
> Firestore, and Cloud Storage for photos). Data is encrypted in transit,
> and access is limited by security rules so that each user and store
> can only reach the records they are allowed to see. Firebase servers
> may be located outside the Philippines.
>
> **6. How long we keep it**
> We keep your information while your account is active. If you
> deactivate your account, you can no longer sign in, but your past
> order records are kept for transaction history.
>
> **7. Your rights**
> Under the Data Privacy Act, you have the right to: be informed about
> how your data is processed; access the personal data we hold about
> you; correct inaccurate information; object to processing, or request
> that your data be blocked or erased, subject to legal and
> transaction-record requirements; obtain a copy of your data in a
> portable format; and file a complaint with the National Privacy
> Commission.
>
> **8. Contact us**
> For privacy questions or requests, send us a message through the
> Contact Support form in the Help Center (tap the ? at the top of your
> Profile). We will respond within a reasonable time.
>
> **9. Changes to this policy**
> If we make significant changes, we will update the date above and let
> you know in the app.

### Screens — module list (section 7)

No new screens. **Landing, Sign Up, Log In, Forgot Password and the
Staff Portal login** are redesigned; the **Privacy Policy** changes from a pop-up to a sheet.

### Limitations

- The animated splash and landing play in the web app and in Expo Go;
  the still splash image and the new home-screen icon appear only in an
  installed build (the APK).
- The resend cooldown is 60 seconds in the app; Firebase applies its own
  limit on top, and past it the screen says "Too many requests".

### Verification

Each screen was compared frame by frame with its approved preview in a
browser, then run against the local emulators with test accounts:
- Sign Up: all field errors; duplicate email; account creation reaching
  Home; the policy's I Agree ticking the box.
- Log In: wrong password; deactivated account; Store Manager account and
  its Staff Portal link; successful login reaching Home; switching to
  Sign Up and back; back arrow to Landing.
- Forgot Password: carried-over email; invalid email; an unregistered
  email receiving the same confirmation and countdown; Back to Log In.
- Staff Portal: invalid email; wrong password; deactivated Store
  Manager; customer account and its link back to Log In (email carried
  over); staff account on Log In reaching the portal with its email;
  Store Manager reaching the dashboard; Platform Admin reaching Manage
  Users; back arrow and footer link returning to Log In.

---

## 14. Home and Shop redesign, and the customer tab bar

> **Status (23 Sep 2026):** built and tested against the local emulators;
> reaches production with the next release (web app and APK). No
> database, security-rule or Cloud Function changes. Everything shown is
> read from the live catalogue, as before.

### What changed — suggested wording

> **Home** greets the customer by first name, with their profile photo
> (or initials) opening Profile. Below it: a search bar that opens Shop
> ready to type, the **Ukay-Ukay** and **Ready-to-Wear** tiles with live
> item counts, **New arrivals** (the six newest listings across all
> stores) and **Ukay finds** (up to ten ukay-ukay items). Each section's
> "See all" opens Shop on the matching category.
>
> **Shop** keeps its title, item count, search bar and category tabs
> (All, Ready-to-Wear, Ukay-Ukay) fixed at the top while the two-column
> grid scrolls. Each card shows the photo, an Ukay or RTW tag, a
> favorite heart, the name, the store and the price. An item whose stock
> is 0 is shown dimmed with a "Sold out" label and a struck-through
> price. A search with no results says so and offers to clear the search
> and filters. A store's own page works as before, with a back arrow.
>
> **Tab bar.** Home and Shop share a bottom tab bar: Home, Shop,
> Favorites, Cart (with the item count) and Profile.

### Functional requirements

| # | Requirement |
|---|---|
| FR-H1 | Home shows the number of ukay-ukay and ready-to-wear items currently listed, and each tile opens Shop filtered to that category. |
| FR-H2 | Home lists the six most recently added products and up to ten ukay-ukay products. |
| FR-H3 | Shop search matches the product name or its category, including the words "ukay", "secondhand", "thrift" and "rtw". Search and the category tab combine: a search never resets the selected tab. |
| FR-H4 | A product with a recorded stock of 0 is marked "Sold out" in Home and Shop. A product with no stock recorded is not. |
| FR-H5 | The tab bar on Home and Shop opens Home, Shop, Favorites, Cart and Profile. Choosing a screen that is already open returns to it rather than opening a second copy. |

### Differences from the previous version

- **Removed from Home:** the photo banner ("Looking for New Clothes in
  Minutes?" with Start Shopping) and the "pre-loved pieces getting a
  second life" strip. The ukay-ukay count now appears on the Ukay-Ukay
  tile, and the search bar and tiles take the banner's place as the way
  into Shop.
- **Featured Picks** is renamed **New arrivals** (same six newest items),
  and **Ukay finds** is added.
- **Favorites is now in the tab bar.** Before, Home's navigation had only
  Home, Shop, Cart and Profile.
- **Shop no longer has a back arrow or cart icon** when opened as a tab;
  the tab bar replaces both. A store's page keeps them.
- **Search words:** category search previously matched only the stored
  names ("ukay-ukay", "ready-to-wear").

### Screens — module list (section 7)

No new screens. **Home** and **Shop** are redesigned; the tab bar is a
shared component used by both.

### Limitations

- The tab bar appears on Home and Shop only. Favorites, Cart and Profile
  open as their own screens with a back arrow, as before.
- Home's rails are not paged: New arrivals shows the six newest items
  and Ukay finds the ten newest ukay-ukay items; "See all" opens the full
  list in Shop.

### Verification

Compared with the approved preview in a browser, then run against the
local emulators with a customer account, two stores and eight products
(one with stock 0, two without photos): Home counts and rails; the
search bar opening Shop focused; searching "denim"; a search with no
results and clearing it; the category tabs; a category search inside a
filtered tab; a store's page with its profile and sold-out item; the tab
bar returning to Home; and each category tile opening Shop filtered.

---

## 15. Still outstanding — SRS-side only, no code changes needed

From [SRS_AUDIT.md](SRS_AUDIT.md). Category A (things the SRS promised
that the app didn't do) is now empty. These remain, and are all
documentation gaps:

**Category B — the app does it, the SRS doesn't mention it**
- Password reset by email (a full flow exists; the SRS documents only
  registration and login/logout). Section 13 now gives a use case for it.
- A Store Manager can set an order status of "Cancelled", which restores
  the stock checkout decremented, and is permitted only from Pending or
  Processing. See section 4a — the SRS documents neither the restoration
  nor the restriction.
- The Help screen offers four contact channels, a common-issues picker,
  an app-share action, and published support hours, beyond the
  "searchable FAQ" the SRS describes.

**Category C — both mention it, but describe it differently**
- Signup postcondition: the SRS says the user is redirected to the login
  page; the app signs them in and goes to Home, because account creation
  authenticates them automatically.
- "Out of Stock notification": the app disables the Add to Cart button
  and shows a badge rather than displaying a message.
- "Invalid Quantity" error: quantity is a stepper with a disabled
  decrement, so zero or negative input is structurally impossible and the
  error branch the SRS describes cannot occur.
- Order status vocabulary differs between the staff view (five statuses)
  and the customer view (pending and processing collapsed into one).

Note also that the SRS's own audit report keeps the *original* findings
alongside the resolutions, so the historical text describes the system as
it was, not as it is.
