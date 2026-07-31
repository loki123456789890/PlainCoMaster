---
name: PlainCo
description: A mobile-first marketplace where ukay-ukay and ready-to-wear share one warm, plainspoken catalog.
colors:
  clay: "#C4623E"
  moss: "#5B6B4F"
  gold: "#846B1A"
  ink: "#1C1B1A"
  canvas: "#FAF7F2"
  line: "#E8E1D5"
  ash: "#6B655C"
  rust: "#C4463E"
typography:
  display:
    fontFamily: "System (iOS) / Roboto (Android)"
    fontSize: "28-32px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  headline:
    fontFamily: "System (iOS) / Roboto (Android)"
    fontSize: "17-20px"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "System (iOS) / Roboto (Android)"
    fontSize: "14-16px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "System (iOS) / Roboto (Android)"
    fontSize: "13-14px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "System (iOS) / Roboto (Android)"
    fontSize: "10-12px"
    fontWeight: 600
    letterSpacing: "normal"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.clay}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.clay}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  button-danger:
    backgroundColor: "{colors.rust}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "12px 24px"
  card-elevated:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
  card-flat:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  input-field:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  badge:
    rounded: "{rounded.pill}"
    padding: "4px 8px"
---

# Design System: PlainCo

## 1. Overview

**Creative North Star: "The Neighborhood Thrift Counter"**

PlainCo reads like a trusted local shop, not a marketplace app fighting for a tap. The palette is warm without being precious — clay, moss, and gold sit on a soft canvas instead of stark white, but the warmth is carried by accent color and typography, never by decoration. Every screen — from the customer shop floor to the admin dashboard — shares the same handful of components (Button, Input, Card, Badge, EmptyState), so the system feels consistent whether you're browsing ukay-ukay finds or an admin is reviewing orders.

The system explicitly rejects generic marketplace clutter: no countdown timers, no stacked discount badges, no red/orange flash-sale banners competing for attention. It also rejects sterile minimalist tech — PlainCo should feel human and a little unhurried, not clinical. Surfaces stay flat by default (a 1px line, not a shadow) because a thrift counter doesn't need to shout about depth; it needs to be legible and calm.

**Key Characteristics:**
- Warm, restrained palette: one clay accent for primary actions, moss and gold reserved for secondary/semantic roles
- Flat-by-default surfaces — a hairline border does the separating, not elevation
- One shared component vocabulary across customer and admin surfaces
- Native system type (San Francisco on iOS, Roboto on Android) — no custom display font
- Native, dual-target platform: the same brand system renders on iOS and Android; OS conventions are respected in behavior (gestures, safe areas), not overridden in look

## 2. Colors

Four named hues carry the whole system: clay for action, moss for the secondary accent (and for "everything's fine"), gold for money and warmth, and a warm-neutral ink/canvas/line family for structure.

### Primary
- **Clay** (`#C4623E`): the one color used for primary actions — buttons, active nav/tab states, links, selected states, focused icons. Reused at `20%`/`15%` opacity for tinted backgrounds behind an active or highlighted element (e.g. a selected filter chip, an icon circle).

### Secondary
- **Moss** (`#5B6B4F`): the Ukay-Ukay category accent and the semantic "success" color — reused as-is, not a separate green. Reinforces that secondhand isn't a lesser category; it gets the same considered accent as ready-to-wear gets clay.

### Tertiary
- **Gold** (`#846B1A`, darkened from an earlier `#C9A227` for text contrast — same hue/saturation, ~4.8:1 on Canvas): reserved for money — product prices, order totals, "average response time" reassurance notes. Used sparingly; if gold shows up outside a price or a genuinely positive note, it's probably misused.

### Neutral
- **Ink** (`#1C1B1A`): primary text and icons that need full contrast (headers, titles, body copy, active nav labels).
- **Canvas** (`#FAF7F2`): the base background for screens, cards, inputs, and buttons that need to read as "not filled." Also the dark theme's ink value inverted — see the Dark Mode note below.
- **Line** (`#E8E1D5`): every hairline border, divider, and disabled/neutral background tint. This is what separates a card from the canvas — not a shadow.
- **Ash** (`#6B655C`): secondary text — placeholders, meta labels, timestamps, helper copy, inactive nav icons. This is the single most-used non-ink text color in the app.

### Semantic
- **Rust** (`#C4463E`): danger — delete actions, deactivate/error states, destructive confirmation buttons. Distinct from Clay despite the similar warmth, so a destructive action never reads as a primary one.
- Moss doubles as **success** (see Secondary above) — there's no separate green token.

### Named Rules
**The One Accent Rule.** Clay is the only color used for primary calls-to-action and active/selected states. Moss and Gold have their own dedicated jobs (category, money) — they never substitute for Clay on a button.

**The No-Shout Rule.** Warmth comes from Clay, Moss, and Gold used deliberately (a button, a price, a category tag) — never from tinting the whole background warm "for elegance." Canvas stays a true off-white; the accent colors carry the personality.

**The Dark Mode Note.** `constants/theme.ts` defines a complete `Colors.dark` palette (ink/canvas inverted, brightened clay/moss/gold), but no screen in the current codebase reads it — every screen imports `Colors.light` directly with no theme-switching logic. Treat `Colors.light` as the only shipped theme until a dark-mode toggle is actually wired up; don't design against `Colors.dark` values as if they're live.

## 3. Typography

**Body Font:** System (San Francisco on iOS) / Roboto (Android) — the platform default, not a bundled custom font.

**Character:** Plainspoken and steady. One system sans carries every role from hero title to badge label; there's no display/body pairing to manage, which matches a product register where the interface should disappear into the task.

### Hierarchy
- **Display** (700, 28–32px, tight leading): Once per screen at most — auth screens' "Hello there, / Welcome back", "Create Account", Landing's hero headline. Never used inside a list or card.
- **Headline** (600, 17–20px): Header bar titles, modal titles, section titles ("Frequently Asked Questions", "Order Summary").
- **Title** (600, 14–16px): Card and list-item primary text — product names, user names, item names.
- **Body** (400–500, 13–14px): Descriptions, form field values, paragraph copy. Cap prose at 65–75ch where it wraps.
- **Label** (600, 10–12px): Badges, stat labels, timestamps, meta text — almost always paired with Ash or a semantic color, rarely Ink.

### Named Rules
**The One Family Rule.** There is no second typeface anywhere in the app. Hierarchy is built entirely from size and weight (400/500/600/700), never from a display font swapped in for hero moments.

## 4. Elevation

PlainCo is flat by default. The overwhelming majority of cards, list rows, and containers separate from the canvas with a single `1px` `Line` (`#E8E1D5`) border and nothing else — no shadow, no elevation. A true drop shadow (`Shadow.card` in `constants/theme.ts`) exists as a token and is used on exactly three surfaces (Cart, Checkout, Shop) where a card needs to visually lift off a busier background. It is the exception, confirmed deliberately, not a shadow system half-rolled-out — the shared `Card` component makes the exception explicit via `variant="elevated"` (its default) vs. `variant="flat"` (what every other card in the app passes).

### Shadow Vocabulary
- **card** (`shadowColor: #1C1B1A, offset: 0 2px, opacity: 0.08, radius: 8px, elevation: 3`): reserved for cards that need to lift off a denser background (Cart, Checkout, Shop). Not the default card treatment.

### Named Rules
**The Flat-By-Default Rule.** A card is a bordered rectangle, not a shadowed one. Reach for `Card`'s `elevated` variant (`Shadow.card`) only when a surface genuinely needs to separate from a busy background, not as a default "make it look premium" move. Every other card in the app passes `variant="flat"` explicitly.

## 5. Components

Buttons, cards, and inputs all read as steady and plainspoken — confident tap targets with no bounce, no flourish, and no motion beyond what a state change needs.

### Buttons
- **Shape:** `12px` corner radius (`Radius.md`) on every variant.
- **Primary:** Clay background, white text, `12px`/`24px` padding — the only button style used for the main action on a screen (Sign In, Add to Cart, Place Order).
- **Secondary:** Canvas background with a Line border, Ink text — used for "Cancel" and other non-destructive secondary actions.
- **Outline:** Transparent background, Clay border and text — used sparingly, mostly for less common actions or dark-surface contexts (over a hero photo).
- **Danger:** Rust background, white text — delete/deactivate confirmations only.
- **States:** `loading` swaps the label for a spinner in the button's own text color; `disabled` drops opacity to `0.5`. Every button in the codebase supports both.

### Chips / Badges
- **Style:** Pill-shaped (`999px` radius), background = role color at `20%` opacity, text = the same role color at full opacity (e.g. a Moss badge is `moss20%` background with solid Moss text).
- **State:** Category and status badges (order status, user role, product type) all use this same tinted-pill pattern — never a solid fill.

### Cards / Containers
- **Corner Style:** `16px` radius (`Radius.lg`) via the `Card` component; list-row cards elsewhere in the app commonly use `12px`.
- **Background:** Canvas.
- **Shadow Strategy:** none by default — see Elevation. The shared `Card` component takes a `variant` prop: `flat` (`Radius.md`, no shadow — the app's standard) and `elevated` (`Radius.lg` + `Shadow.card`, the default parameter value, kept for the three surfaces that were already using it before `flat` existed). Every card and card-shaped list row in the app now goes through this component instead of a hand-rolled bordered `View`.
- **Border:** `1px` Line.
- **Internal Padding:** `16px` (`Spacing.md`) by default; a handful of denser list rows override it to `12px` via `style`.

### Inputs / Fields
- **Style:** Canvas background, `1px` Line border, `12px` radius, `12px`/`16px` padding, Ink text, Ash placeholder — all via the shared `Input` component.
- **Focus:** No custom focus ring defined yet; relies on the platform default. Worth a deliberate pass later.
- **Error:** Border switches to Rust; a Rust helper line appears below the field.
- **Multiline exception:** the Product forms' Description field stays a hand-rolled `TextInput` (not the `Input` component) because `Input` forwards `style` in a way that would fully replace its base field style rather than merge with it — there's no safe way to widen it into a textarea through the component today.

### Navigation
- **Bottom tab bar** (customer): Canvas background, `1px` Line top border, active icon/label in Clay, inactive in Ash. A pill-shaped Rust cart-count badge (white text, `10px`/`700`) overlays the cart icon.
- **Header bars:** every screen repeats the same pattern — a `40×40` back button (Ink or Clay arrow depending on context), a centered Headline-weight title, and an optional trailing action icon.
- **Hero overlays:** two treatments currently coexist — Home's hero photo uses a flat `rgba(0,0,0,0.55)` black scrim; Landing's uses a Clay-tinted gradient (`rgba(196,98,62,0.3)` → `rgba(120,55,30,0.85)`). Landing's is the more on-brand of the two; treat it as the reference when touching Home's hero next.

## 6. Do's and Don'ts

### Do:
- **Do** use Clay (`#C4623E`) as the only primary-action color — buttons, active states, selected filters.
- **Do** default every card and list row to a `1px` Line border with no shadow; reach for `Shadow.card` only on a surface that truly needs to lift.
- **Do** keep Moss as both the Ukay-Ukay category accent and the success color — don't introduce a second green.
- **Do** keep type to one system family, building hierarchy from size and weight only (Display 700/28–32px down to Label 600/10–12px).
- **Do** use the shared `Button` / `Input` / `Badge` / `Card` / `EmptyState` components on new screens. A tappable card is `TouchableOpacity` wrapping `<Card variant="flat">`, not a hand-rolled bordered `View`.

### Don't:
- **Don't** ship Shopee/Lazada-style marketplace clutter — no countdown timers, no stacked discount badges, no red/orange flash-sale banners competing for attention.
- **Don't** tint the base Canvas background warm "for elegance." Canvas stays a true off-white; warmth comes from Clay/Moss/Gold accents, not a warm-tinted body.
- **Don't** reach for a gradient text fill, a colored side-stripe border, or glassmorphism as decoration — none of these appear in the system today and none should.
- **Don't** design against `Colors.dark` as if it's live — it's defined in `constants/theme.ts` but no screen currently switches to it.
- **Don't** let a destructive action borrow Clay. Rust is the only color for delete/deactivate/error, specifically so it never reads as a primary action.
