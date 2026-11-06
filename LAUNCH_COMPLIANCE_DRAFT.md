# AL SHAMI launch and privacy preparation (draft)

This file is a working draft for owner review. It is not a completed DPC registration and is not a published privacy notice.

## App data inventory observed in the repository

- Customer account: name, email and/or phone number, authentication identifiers, and account session.
- Order: selected products, quantity, price, order type, delivery address and map coordinates, notes, scheduled time, receipt/loyalty/referral details where used.
- Delivery: rider account and active assigned-order details; the rider app shares GPS location while delivery tracking is active.
- Customer features: reviews, loyalty/referral activity, and push-notification token where enabled.
- Staff operations: staff account/profile details, role, phone, attendance and related operational records.
- Browser/PWA: sign-in session is persisted in browser storage; the service worker caches app files.

The app currently takes cash payments. Do not describe online payment processing as active.

## Service providers to disclose and verify

- Supabase Auth and database; the live project is in the eu-west-1 region.
- Arkesel for SMS OTP when the phone-auth flow is approved and enabled.
- Google Maps Platform for route/ETA requests where enabled.
- OpenStreetMap tiles and Nominatim search/reverse-geocoding for map display and address lookup.
- Browser/platform push services when push notifications are enabled.

Before publication, confirm each provider's exact data role, locations, retention, and applicable transfer safeguards from the actual account agreements and settings.

## Draft notice topics

The public notice should identify the registered data controller (not only the restaurant trading name), explain the categories and purposes above, who receives data (including assigned riders and service providers), the user's access/correction/objection/consent-withdrawal and complaint routes, the retention criteria, security/contact route, and how location and notification permissions can be turned off. Do not claim that data is sold, deleted on a fixed schedule, or stored only in Ghana unless verified.

## DPC registration information still required

Fill from the official business records and current operations before submitting:

- Registered legal entity name, company registration number, tax identifier, registered address and Ghana digital address.
- Authorized representative's official name and contact details.
- Data Protection Supervisor name, appointment and training evidence.
- Employee count, annual turnover, data-subject count, and sector(s) needed for the portal's fee tier.
- Exact categories of customer, rider and staff data; purposes; recipients; provider countries; and security measures.
- Data-retention periods or documented retention criteria for orders, accounts, location events, reviews, staff and accounting records.
- Any required supporting company documents and the assigned registration fee.

DPC guidance states that controllers/processors must register, renew every two years, appoint/train a Data Protection Supervisor, and publish an organizational privacy policy. Confirm the current application fields, fee and filing status in the DPC portal before submission.

## Current launch blockers (refreshed 6 November 2026)

The website/PWA is deployed; the current Pages deployment and static application validation passed. The live customer, admin and rider entry pages load. These checks do not prove an authenticated order works end to end.

1. Supabase leaked-password protection is reported disabled. Enable it in Auth settings if the project plan supports it.
2. DPC registration and a finalized public privacy notice are incomplete. The draft still lacks verified controller identity, retention/provider details and filing status.
3. The public username-registration Edge Function creates Auth users through the Admin API and has no durable per-IP limiter or CAPTCHA. Verify Auth's built-in limits and add abuse protection to this admin path before broad promotion.
4. A real customer → admin → rider → completion → customer-history test has not been performed. Run it with dedicated test accounts and a non-production test order.
5. Confirm iPhone rider location freshness while the app is foregrounded. Background GPS is not claimed.
6. Google Play release is not ready: the latest successful Android preview was built on the separate `mobile-store-prep` branch on 24 October. Its workflow builds a debug APK and a release bundle but contains no production signing step. iOS has only an unsigned simulator preview.
7. The customer app has no account-deletion flow. Play requires an accessible deletion route and deletion of associated data; design this only after retention/legal obligations are defined.

The legacy order RPC permission fix is now applied to production and recorded in the repository migration history. Phone/SMS sign-in and electronic payments are excluded from this release gate; keep them disabled until their own provider and end-to-end checks pass.
