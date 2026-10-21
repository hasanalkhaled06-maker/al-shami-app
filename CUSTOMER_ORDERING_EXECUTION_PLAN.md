# AL SHAMI Customer Ordering — 50-Item Execution Plan

## Rules
- Scope is exactly the 50 customer-ordering items in `IMPROVEMENT_BACKLOG.md` (items 1–50), not the entire 270-item product backlog.
- Execute in order. Each item must have a code change or a documented finding, plus its own acceptance check before its status changes to **Verified**.
- A static source check is not an end-to-end browser test. Clearly record which type of test was run.
- Preserve all existing orders and customer records. Do not run a real customer order during development. Cash remains the only checkout payment method; electronic payments are out of scope.
- A shared code change may support multiple items, but each item is checked off separately only when its own acceptance condition is met.
- Status vocabulary: **Not started**, **Implemented — awaiting test**, **Verified**, **Blocked**. Do not mark an item Verified from code inspection alone if its acceptance condition requires runtime behavior.

## Phase A — Checkout and order submission

### 1. Guest checkout without mandatory account
- **Requirement:** A customer can order without creating an account or completing SMS OTP.
- **Likely files:** `index.html`, `customer.js`.
- **Acceptance:** With a signed-out fresh browser session, add an item, fill valid checkout data, and submit; no login/OTP gate appears. Confirm by inspecting the live form and exercising a non-production/mock path before any real order.

### 2. Remember customer name and phone only with consent
- **Requirement:** Save name and phone on the current device only when the explicit checkbox is checked; remove saved details when unchecked.
- **Likely files:** `index.html`, `customer.js`.
- **Acceptance:** Unchecked values do not persist after refresh; checked values persist locally; unchecking removes the saved record; no customer detail is sent to a new analytics service.

### 3. Validate Ghana phone numbers before submission
- **Requirement:** Accept supported local/international Ghana formats and normalize valid numbers to `+233XXXXXXXXX`.
- **Likely files:** `customer.js`.
- **Acceptance:** Test `0241234567`, `+233241234567`, `233241234567`, and `00233241234567` as valid equivalents; reject missing, too-short, too-long, and alphabetic values; verify normalization occurs before RPC invocation.

### 4. Keep checkout fields after a network error
- **Requirement:** A failed request leaves customer input, order type, address, notes, and cart intact.
- **Likely files:** `customer.js`.
- **Acceptance:** Simulate an RPC/network failure; verify all fields and cart quantities remain unchanged, an actionable error is announced, and no form reset or success state occurs.

### 5. Prevent duplicate submissions while an order is processing
- **Requirement:** Only one in-flight submission is allowed.
- **Likely files:** `customer.js`.
- **Acceptance:** Double-click/submit twice rapidly in a controlled test; only one RPC invocation occurs and the submit control stays disabled while pending.

### 6. Show a clear order reference after successful save
- **Requirement:** Show the reference returned by the database only after the RPC confirms success.
- **Likely files:** `customer.js`, `index.html`.
- **Acceptance:** Mock a successful RPC with a known order reference and verify it appears; mock an error and verify no success/reference is shown. If the RPC does not return a stable reference, document that server-side dependency.

### 7. Offer WhatsApp contact after order success
- **Requirement:** Provide a WhatsApp help/contact action in the success state.
- **Likely files:** `index.html`, `customer.js`.
- **Acceptance:** Successful test order displays a working `wa.me` link to the restaurant; link opens safely in a new tab/window and contains no customer data by default.

### 8. Show delivery and pickup choices clearly
- **Requirement:** Make the two order types visible and understandable.
- **Likely files:** `index.html`, `style.css`.
- **Acceptance:** Both options are keyboard accessible and visually readable at desktop and mobile widths; selection updates address requirements and delivery fee.

### 9. Require address only for delivery
- **Requirement:** Delivery requires an address; pickup does not.
- **Likely files:** `customer.js`, `index.html`.
- **Acceptance:** Pickup removes the required constraint and submits null address; delivery requires non-whitespace address. Switch between modes repeatedly and ensure the state stays correct.

### 10. Explain address and landmark format
- **Requirement:** Provide a realistic example and guidance for Ghana delivery addresses.
- **Likely files:** `index.html`, `customer.js`.
- **Acceptance:** Address field shows an example covering house/street/landmark or nearby landmark; helper text is present, readable, and not sent as the actual address.

## Phase B — Cart and total calculation

### 11. Accessible quantity controls
- **Requirement:** Increase/decrease controls identify the item and action.
- **Likely files:** `customer.js`.
- **Acceptance:** Screen-reader accessible names include the product name (and action); controls work by keyboard; quantity remains between 1 and 99 while present.

### 12. Remove individual cart items
- **Requirement:** A customer can remove one selected line without clearing the whole cart.
- **Likely files:** `customer.js`, `index.html`, `style.css`.
- **Acceptance:** Removing an item deletes just that row, persists the updated cart, and recalculates subtotal, fee, and total.

### 13. Confirm clearing a non-empty cart
- **Requirement:** Clearing the entire cart requires confirmation, but an empty cart does not trigger a pointless dialog.
- **Likely files:** `customer.js`.
- **Acceptance:** Cancel leaves cart unchanged; confirm clears it; empty cart and in-flight submission cannot clear unexpectedly.

### 14. Persist cart across refreshes
- **Requirement:** Store cart quantities locally and restore them after refresh.
- **Likely files:** `customer.js`.
- **Acceptance:** Add multiple items, refresh, and verify only IDs/quantities are restored and prices are recalculated from the current menu data.

### 15. Restore only cart IDs still present in menu
- **Requirement:** Drop stale/deleted product IDs and invalid quantities.
- **Likely files:** `customer.js`.
- **Acceptance:** Provide saved-cart test data containing valid, deleted, malformed, zero, negative, and over-limit quantities; only valid current IDs and quantities survive after menu load.

### 16. Recalculate after each quantity change
- **Requirement:** Every add, decrease, increase, and removal updates amounts immediately.
- **Likely files:** `customer.js`.
- **Acceptance:** Verify line amount and subtotal against quantity × current price after each control operation.

### 17. Consistent subtotal, delivery fee, and total
- **Requirement:** Use one calculation rule: subtotal + delivery fee for delivery; subtotal only for pickup.
- **Likely files:** `customer.js`, `index.html`.
- **Acceptance:** Compare displayed total with the submitted expected total for delivery and pickup, including a zero-fee setting and a configured non-zero fee.

### 18. Explain cash payment
- **Requirement:** Tell customers cash is paid at delivery or pickup and do not imply online payment exists.
- **Likely files:** `index.html`, `customer.js`.
- **Acceptance:** Payment explanation is visible before submit in English, Arabic, and Twi; no electronic payment option is presented.

### 19. Show minimum order before checkout
- **Requirement:** Show the configured minimum and enforce it before sending an order.
- **Likely files:** `customer.js`, `index.html`.
- **Acceptance:** Configured minimum appears; below-minimum attempt makes no RPC call; equal/above-minimum order may proceed.

### 20. Disable checkout when cart is empty
- **Requirement:** Empty basket prevents checkout; in-flight state also prevents checkout.
- **Likely files:** `customer.js`.
- **Acceptance:** Button disabled with empty cart, enabled when a valid item is added, disabled while submitting, and re-evaluated after success/failure.

## Phase C — Validation, loading, and search

### 21. Inline field validation
- **Requirement:** Invalid name, phone, and delivery address are explained next to checkout feedback.
- **Likely files:** `customer.js`, `index.html`.
- **Acceptance:** Each invalid case provides a specific message, and valid corrections clear stale errors.

### 22. Focus the first invalid field
- **Requirement:** Keyboard focus moves to the earliest invalid input.
- **Likely files:** `customer.js`.
- **Acceptance:** Empty name, invalid phone, and missing delivery address tests focus the corresponding field in validation order.

### 23. Protect against double-click submissions
- **Requirement:** Guard both the handler and button while pending.
- **Likely files:** `customer.js`.
- **Acceptance:** Automated/mock double-submit produces one in-flight RPC; this is checked separately from visual disabled state (item 20).

### 24. Useful offline/network errors
- **Requirement:** Explain connectivity failure in plain language without claiming the order was saved.
- **Likely files:** `customer.js`, `index.html`.
- **Acceptance:** Simulated offline/fetch/RPC errors render an accessible message, preserve form and cart, and do not show the success modal.

### 25. Menu loading state
- **Requirement:** The menu communicates loading while data is being fetched.
- **Likely files:** `index.html`, `customer.js`.
- **Acceptance:** A visible loading status appears during a delayed mocked response and disappears on success or failure; status is exposed to assistive technology.

### 26. Retry menu load
- **Requirement:** A visible retry action re-runs safe menu/settings reads after load failure.
- **Likely files:** `index.html`, `customer.js`.
- **Acceptance:** Simulate one read failure then success; activating Retry fetches again and renders data. Retry must not call order creation.

### 27. Search menu by name
- **Requirement:** Search by product name, description, and category with case-insensitive matching.
- **Likely files:** `customer.js`.
- **Acceptance:** Search terms with mixed case match expected rows; unrelated search returns empty state.

### 28. Category filtering
- **Requirement:** Category chips filter visible products.
- **Likely files:** `customer.js`.
- **Acceptance:** Each category shows only matching products; All restores all available products subject to search.

### 29. Compatible search and category filters
- **Requirement:** Search and selected category combine with AND logic.
- **Likely files:** `customer.js`.
- **Acceptance:** Applying a search within a category returns only rows matching both; changing one filter preserves the other.

### 30. Helpful empty search results
- **Requirement:** Distinguish “no search matches” from an empty/unavailable menu and tell users how to recover.
- **Likely files:** `customer.js`.
- **Acceptance:** No-match state is specific and suggests clearing search/changing category; genuine empty menu has separate wording.

## Phase D — Menu items and offers

### 31. Sort by price and popularity
- **Requirement:** Price ascending, price descending, and popularity options work without losing filters.
- **Likely files:** `customer.js`, `index.html`.
- **Acceptance:** Dataset with known prices/popularity sorts correctly, with search/category still applied. If popularity data is absent, behavior is documented and deterministic.

### 32. Mark unavailable items clearly
- **Requirement:** A temporarily unavailable item is not silently treated as orderable.
- **Likely files:** `customer.js`, possibly `index.html`.
- **Acceptance:** Query can identify unavailable items without exposing private columns; UI clearly labels them and does not enable add-to-cart.

### 33. Prevent adding unavailable items
- **Requirement:** UI and cart restoration reject unavailable items; server remains authoritative.
- **Likely files:** `customer.js`.
- **Acceptance:** Clicking a disabled/unavailable item cannot change cart; a saved cart containing an unavailable ID drops it or marks it non-orderable. Server RPC enforcement must be separately confirmed.

### 34. Consistent descriptions
- **Requirement:** Every menu card has a safe description fallback.
- **Likely files:** `customer.js`.
- **Acceptance:** Null/blank description shows a meaningful fallback without displaying “undefined” or unsafe HTML.

### 35. Image fallback
- **Requirement:** Missing/broken images leave a stable image placeholder.
- **Likely files:** `customer.js`, `style.css`.
- **Acceptance:** Empty URL, 404, and valid image tests show no broken-image icon or layout collapse; fallback does not loop recursively.

### 36. Lazy-load menu images
- **Requirement:** Menu card images use native lazy loading.
- **Likely files:** `customer.js`.
- **Acceptance:** Rendered images include `loading="lazy"`; checked source markup does not eagerly preload every card image.

### 37. Responsive image dimensions
- **Requirement:** Image elements have stable, responsive containers and avoid overflow/layout shift.
- **Likely files:** `customer.js`, `style.css`.
- **Acceptance:** Images stay inside card at 320, 390, 768, and desktop widths; set dimensions/aspect-ratio or fixed image container avoids severe layout shift.

### 38. Offer dates
- **Requirement:** Show start/end or expiry information when an offer has configured dates.
- **Likely files:** `customer.js`, `index.html`.
- **Acceptance:** Dated offer displays valid local-formatted date/expiry; undated offer does not invent one; invalid date fails safely.

### 39. Hide inactive promotions
- **Requirement:** Inactive, not-yet-started, and expired offers are not shown as active.
- **Likely files:** `customer.js`.
- **Acceptance:** Test inactive flag, future start, past end, and currently active intervals against a fixed test clock. Server-side offer eligibility is outside this UI check.

### 40. Readable mobile offers
- **Requirement:** Offers wrap and remain readable on narrow screens.
- **Likely files:** `style.css`, `customer.js`.
- **Acceptance:** Offer title/details fit without horizontal page scrolling at 320px and 390px; long text wraps.

## Phase E — Confirmation, accessibility, mobile, and contact

### 41. Order summary before final submit
- **Requirement:** Customer reviews item names, quantities, order type, and total before confirmation.
- **Likely files:** `customer.js`.
- **Acceptance:** Confirmation reflects current cart and delivery/pickup total, uses real line breaks, and Cancel produces no RPC call.

### 42. Clear button labels
- **Requirement:** All action buttons have clear visible text or specific accessible names.
- **Likely files:** `customer.js`, `index.html`.
- **Acceptance:** Quantity controls name the product and action; remove/clear/place/retry/success actions can be understood without icon-only cues.

### 43. Keyboard operation
- **Requirement:** All customer ordering actions work without a pointer.
- **Likely files:** `index.html`, `customer.js`, `style.css`.
- **Acceptance:** Tab/Shift+Tab/Enter/Space can reach and operate language, filters, cart, form, retry, dialogs, and contact links with visible focus.

### 44. Announce cart changes to screen readers
- **Requirement:** Adding/removing/changing quantities produces a short status announcement.
- **Likely files:** `index.html`, `customer.js`.
- **Acceptance:** A dedicated polite live region announces changes and does not repeatedly read the entire cart on every render.

### 45. Reduced motion
- **Requirement:** Respect `prefers-reduced-motion: reduce` for animations/transitions.
- **Likely files:** `style.css`, `index.html`.
- **Acceptance:** CSS disables/reduces customer-facing splash, modal, hover, and loading motion under the preference.

### 46. Usable at 320px
- **Requirement:** Core menu, basket, form, and success dialog work at 320 CSS pixels.
- **Likely files:** `style.css`, `index.html`.
- **Acceptance:** No horizontal document overflow; required controls and total remain visible/readable in a 320px viewport.

### 47. Tap-friendly controls
- **Requirement:** Touch targets are comfortably usable on phones.
- **Likely files:** `style.css`, `customer.js`.
- **Acceptance:** Primary ordering controls and quantity buttons have at least about 44px target height/area where practical and do not crowd one another.

### 48. Restaurant phone links
- **Requirement:** Both restaurant phone numbers use working `tel:` URIs.
- **Likely files:** `index.html`.
- **Acceptance:** Number digits match the supplied official contacts and each link uses its E.164 Ghana number.

### 49. WhatsApp links to both restaurant numbers
- **Requirement:** Both supplied contacts have WhatsApp links.
- **Likely files:** `index.html`, `customer.js`.
- **Acceptance:** Each link contains the correct Ghana digits without plus/spaces and new-window links use `rel="noopener noreferrer"`.

### 50. Copyable address/location
- **Requirement:** Restaurant address is easy to locate and copy; don't invent an unverified map pin.
- **Likely files:** `index.html`, `customer.js`.
- **Acceptance:** The displayed address can be selected/copied and a Copy address action works with Clipboard API plus a graceful fallback/message when clipboard access is blocked.

## Per-item execution ledger
The ledger below starts unverified. Update each row only after applying the code change and running the acceptance check described above.

| Item | Status | Evidence / commit / test |
|---:|---|---|
| 1 | Not started | — |
| 2 | Not started | — |
| 3 | Not started | — |
| 4 | Not started | — |
| 5 | Not started | — |
| 6 | Not started | — |
| 7 | Not started | — |
| 8 | Not started | — |
| 9 | Not started | — |
| 10 | Not started | — |
| 11 | Not started | — |
| 12 | Not started | — |
| 13 | Not started | — |
| 14 | Not started | — |
| 15 | Not started | — |
| 16 | Not started | — |
| 17 | Not started | — |
| 18 | Not started | — |
| 19 | Not started | — |
| 20 | Not started | — |
| 21 | Not started | — |
| 22 | Not started | — |
| 23 | Not started | — |
| 24 | Not started | — |
| 25 | Not started | — |
| 26 | Not started | — |
| 27 | Not started | — |
| 28 | Not started | — |
| 29 | Not started | — |
| 30 | Not started | — |
| 31 | Not started | — |
| 32 | Not started | — |
| 33 | Not started | — |
| 34 | Not started | — |
| 35 | Not started | — |
| 36 | Not started | — |
| 37 | Not started | — |
| 38 | Not started | — |
| 39 | Not started | — |
| 40 | Not started | — |
| 41 | Not started | — |
| 42 | Not started | — |
| 43 | Not started | — |
| 44 | Not started | — |
| 45 | Not started | — |
| 46 | Not started | — |
| 47 | Not started | — |
| 48 | Not started | — |
| 49 | Not started | — |
| 50 | Not started | — |
