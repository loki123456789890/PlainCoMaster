# SRS Audit — PlainCo

Read-only audit of the codebase against `1_SRS TEMPLATE.txt`. No application
code was modified to produce this report. Findings are ordered within each
category by how likely a panelist is to notice them live (demo-visible
first, internal/code-only details last).

---

## CATEGORY A — SRS promises it, the app does not do it

### A1. "Strict data type enforcement on the backend to prevent XSS" does not exist
**SRS (Security, p.29):**
> "Because Cloud Firestore is a NoSQL database, it is immune to traditional SQL
> injection attacks. However, the system will still implement strict data type
> enforcement on the backend to prevent cross-site scripting (XSS)
> vulnerabilities through stored text data."

**Code:** [firestore.rules](firestore.rules)
- `products/{productId}` create: `allow create, delete: if isAdmin();` (line 75) — no field-level or type validation of `name`, `description`, `imageUrl`, etc. The *only* type check anywhere in the rules is the numeric `stock` comparison used for the checkout decrement (lines 91-99), which doesn't apply to creation at all.
- `users/{userId}` create: `allow create: if isOwner(userId);` (line 26) — no validation on `name`/`email` field types or content.
- `supportRequests/{requestId}` create: `allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;` (lines 102-103) — no validation on `message` content/type.

A panelist can open `firestore.rules` and ask "where is the backend data-type
enforcement the SRS promises?" — beyond the one narrow stock-number check,
it is not implemented anywhere.

### A2. Audit logging of user activities does not exist
**SRS (Constraints 2.4.5, "Audit Functions"):**
> "The system should maintain logs of user activities (product updates and
> order transactions) to assist store managers in monitoring operations and
> resolving transaction-related concerns."

**Code:** No audit/activity-log collection exists anywhere in the app. A
search across `screens/`, `context/`, and `firestore.rules` turns up no
`activityLog`/`auditLog` writes. The only "logging" in the codebase is
`console.error(...)` calls scattered through the screens (e.g.
[ProductContext.js:80](context/ProductContext.js#L80),
[Checkoutscreen.js:353](screens/Checkoutscreen.js#L353)) — client-side,
developer-console-only, not persisted, and never surfaced to a Store
Manager anywhere in the Admin Portal (`AdminDashboardScreen.js`,
`AdminProductsScreen.js`, `AdminOrdersScreen.js` have no "activity" or
"history" view). If a panelist asks "show me the log of who edited this
product and when," there is nothing to show.

---

## CATEGORY B — The app does it, the SRS never mentions it

### B1. Forgot Password / reset-by-email flow
[ForgotPasswordScreen.js](screens/ForgotPasswordScreen.js) — a full email-based
password reset flow (`sendPasswordResetEmail`), reachable from both the
customer Login screen and Admin Login is referenced from it, with its own
validation, offline handling, and enumeration-safe messaging. Module 1 of
the SRS only documents Registration and Login/Logout; password reset is
never mentioned anywhere in the document, even though `HelpScreen.js`'s own
FAQ (`a1`, line 138) tells users to use it.

### B2. Admin can set an order status of "Cancelled"
[AdminOrdersScreen.js:42](screens/admin/AdminOrdersScreen.js#L42) —
`STATUS_OPTIONS = ['pending', 'processing', 'shipped', 'delivered', 'cancelled']`,
with a dedicated "Cancelled" stat card, tab, and color treatment, and
`OrderDetailsScreen.js` / `OrdersScreen.js` both render a cancelled state on
the customer side. The SRS only discusses cancellation from the customer's
side ("Customer order cancellation is intentionally not supported," Security
section) and never states whether an admin can cancel an order. This is a
reasonable feature but is entirely undocumented — and notably, cancelling an
order this way does **not** restore the decremented stock (no compensating
transaction anywhere in `AdminOrdersScreen.js`), which the SRS also never
addresses.

### B3. Admin can edit a user's name, not just role/status
**SRS (Scope, User characteristics 2.2):** "edit user roles and status."
**Code:** [AdminUsersScreen.js:656-663](screens/admin/AdminUsersScreen.js#L656)
— the "Edit User" modal lets an admin change a user's `name` in addition to
`role`. Editing another user's display name is not listed anywhere in the
SRS's admin privileges.

### B4. Multi-channel support contact + FAQ system beyond "searchable FAQ"
**SRS (Scope):** "Customers can browse a searchable FAQ and submit a support
request from the Help screen."
**Code:** [HelpScreen.js](screens/HelpScreen.js) implements substantially more
than that: four direct contact channels with real values (email, phone,
WhatsApp, Facebook Messenger — lines 160-193), a "Common Issues" quick-fill
picker (lines 196-221), an app-share action (`handleShare`, line 344), and
published support hours with an average-response-time SLA ("Monday - Friday:
9:00 AM - 8:00 PM... Average response time: 2-4 hours," lines 693-710) — none
of which appear in the SRS.

### B5. Dead/orphaned screens not wired into navigation
See the dedicated list at the bottom of this report — `BonusScreen.js` and
`PaymentScreen.js` are acknowledged as unfinished in `TODO.md`; `Notificationscreen.js` has no
corresponding TODO entry and appears to be leftover scaffolding. None of
the three are reachable from any screen the app actually renders (confirmed
against `App.js`'s `Stack.Navigator`), and none are mentioned in the SRS.

---

## CATEGORY C — Both mention it, but describe it differently

### C1. Signup postcondition: "redirected to the login page" vs. actual behavior
**SRS (3.2, Transaction 1.1, Postconditions):**
> "The user is registered and redirected to the login page."

**Code:** [Signupscreen.js:308-311](screens/Signupscreen.js#L308) — on
success, the app shows a "Success" alert and calls
`navigation.navigate('Home')`, not the Login screen. This is because
`createUserWithEmailAndPassword` auto-authenticates the new user, so the app
takes them straight into the authenticated app rather than back to Login.
This is a real, demo-visible difference from the documented step-by-step
flow, even though the end result (an account that can subsequently sign in)
is achieved.

### C2. "Out of Stock notification" vs. a disabled button + badge
**SRS (3.2, Transaction 2.2, Extension 5a):**
> "If the selected size or quantity is unavailable, the system displays an
> 'Out of Stock' notification and prevents the addition to the cart."

**Code:** [Productscreen.js](screens/Productscreen.js) — there is no alert or
toast. Out-of-stock is instead communicated passively: a static "Out of
Stock" `Badge` on the product image and price area (lines 342-346,
368-371), and the **Add to Cart button is simply `disabled`**
(line 476) so the tap never fires at all. The prevention happens, but not
via the "notification" the SRS describes — a panelist tapping a disabled
button will see nothing happen, not a message.

### C3. "Invalid Quantity" extension can never actually occur
**SRS (3.2, Transaction 2.2, Extension 3a):**
> "If the user attempts to input a quantity of zero or a negative number,
> the system prevents the action and displays an error message."

**Code:** [Productscreen.js:436-459](screens/Productscreen.js#L436) — there is
no quantity text field to type into; quantity is a stepper whose decrement
button is `disabled` once `quantity <= 1` (line 439/443). Zero/negative
input is structurally impossible rather than caught-and-rejected, so the
"error message" branch this SRS extension describes has no code path that
can ever trigger it.

### C4. "View-only" profile is true for customers, but admins can edit a peer's name
**SRS (Scope):** "Editing personal profile information (name, email) after
registration is not currently supported — the Profile screen is view-only."
**Code:** Read literally (without the "Profile screen" qualifier the SRS
itself supplies), this could mislead a reader into thinking name-editing is
absent from the whole app. In fact [AdminUsersScreen.js](screens/admin/AdminUsersScreen.js)
lets an admin change *another user's* `name` (though not their own, and not
email — see B3 above). The SRS's own Profile screen claim is accurate for
`Profilescreen.js` (confirmed view-only, no edit controls at
[Profilescreen.js:264-452](screens/Profilescreen.js#L264)); the ambiguity is
only that the sentence could be read as a whole-app claim.

### C5. Order-status vocabulary differs between customer and admin views
Admin orders use five distinct statuses — `pending`, `processing`, `shipped`,
`delivered`, `cancelled` — each with its own color
([AdminOrdersScreen.js:53-62](screens/admin/AdminOrdersScreen.js#L53)). The
customer-facing `OrdersScreen.js`/`OrderDetailsScreen.js` intentionally
collapse `pending` and `processing` into one visual "Processing" bucket
(comment at [OrdersScreen.js:36-40](screens/OrdersScreen.js#L36)). The SRS
never enumerates status values for either audience, so this isn't a
violation, but it means the same order can display differently depending on
which screen a panelist is shown — worth knowing before a live demo of
Module 4.1/4.2.

---

## Screens with no corresponding mention in the SRS

All three are also unreachable — none is registered in `App.js`'s
`Stack.Navigator`, so they cannot be opened from any in-app flow:

| File | Status |
|---|---|
| [screens/BonusScreen.js](screens/BonusScreen.js) | Full loyalty-points/rewards-redemption screen with hardcoded sample data. `TODO.md` explicitly lists "Update App.js to import and add new screens to navigator" as unchecked. Not mentioned anywhere in the SRS (no loyalty/points/rewards program is in scope). |
| [screens/PaymentScreen.js](screens/PaymentScreen.js) | A "saved payment methods" screen with **hardcoded fake stored card data** (`Visa •••• 4242`, `Mastercard •••• 5555`, cardholder "John Doe", lines 20-42). This directly contradicts the SRS's own security claim elsewhere ("we never ask for or store card numbers... Online payment processing is still being integrated," `HelpScreen.js` FAQ `a3`) and Landing's own marketing copy ("No Card Info Stored"). Because it is unreachable, the *running app* doesn't violate the claim — but the dead code sitting in the repo is a real risk if a reviewer greps the source. |
| [screens/Notificationscreen.js](screens/Notificationscreen.js) | Static hardcoded notifications list. No corresponding TODO entry, no SRS mention, unreachable from any screen. |

---

## What already matches well (not re-litigated above)

For context on scope, the following core flows were checked in detail and
found to match the SRS accurately, so they are not repeated as findings:
Signup/Login validation and error paths, admin-vs-customer login
segregation, the atomic Firestore stock-decrement transaction on checkout
(SRS Assumption 3), the single-saved-address checkout requirement (SRS
Dependency 5), the `expo-location` "Use Current Location" fallback chain
(GPS → last-known → manual entry), account deactivation semantics (SRS
Constraint 2.4.1), the two-phase signup rollback for orphaned Auth accounts
(SRS Security), RBAC via `firestore.rules` + `withAdminGuard`, offline
network-loss messaging matching the SRS's exact wording, per-color image
absence (SRS Dependency 4), and the Admin Dashboard's "Total Order Value"
naming (SRS Module 4.1).
