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

## Current launch blockers

1. Supabase leaked-password protection is reported disabled. Supabase documentation lists this feature for Pro and above, so verify the project's plan and enable it in Auth settings.
2. The app security fix is in open PR #22. Its SQL migration is not applied to production.
3. Arkesel replied on 31 October that the account is registered to the existing email/phone and advised using Forgot password with phone OTP. Hasan's follow-up says SMS is still not arriving, so delivery and Sender ID approval remain unverified.
4. The DPC filing and public notice are not complete. This draft intentionally does not submit or publish either.
5. A live customer, admin and rider end-to-end test, including Ghana-network SMS and active rider tracking, remains necessary before declaring launch readiness.
