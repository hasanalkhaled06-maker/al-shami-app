# AL SHAMI Delivery Rider App — Setup & Verification

## Scope

This feature adds a third installable Progressive Web App (PWA) for delivery riders. It shares the existing AL SHAMI Supabase project; it does not create a second order database.

- rider.html: private rider login and delivery board.
- rider.js and rider.css: assigned order cards, directions, phone links, status refresh, and GPS sharing.
- rider.webmanifest and icons/al-shami-rider.svg: separate rider install identity.
- supabase/migrations/20261023131500_delivery_rider_live_tracking_v1.sql: rider role, automatic assignment, protected location storage, and scoped RPC functions.

The rider screen is read-only for order workflow: there are no accept, reject, completed, or status-change controls. The admin dashboard remains the only place where order status changes. Delivery orders are automatically assigned when accepted, using the active rider profile with the fewest unfinished deliveries. Pickup orders are never assigned. If there is no active rider account linked to an employee profile, the order remains unassigned until setup is completed.

## Important rollout rule

This implementation is on the feature branch feature/delivery-rider-live-tracking. It has not been merged to main or deployed. Do not treat it as live until the migration, deployment, and end-to-end checks below succeed.

Before using it in production, back up the Supabase project and review both migrations. The production migration list previously showed delivery_map_location_v1 but did not list the repository migration 20261023130000_order_status_visibility_and_location_security.sql. Check whether that security migration has already been applied. If not, review and apply it first, then apply 20261023131500_delivery_rider_live_tracking_v1.sql. Do not apply a migration again under another name without checking its state.

## Set up a rider account

1. In Supabase Authentication, create a separate login for each delivery rider. Never share the administrator login with a rider.
2. Sign in to the AL SHAMI admin app and open Operations, then Employee management.
3. Create or edit the employee profile; set System role to Delivery Rider and employment status to Active.
4. Copy that rider's Auth user UUID from Supabase Authentication → Users and paste it into the employee profile's Auth user UUID field. Save the profile. The form links an existing login; it does not create the login itself.
5. Keep the profile active. On the next accepted delivery order, the database trigger chooses an eligible linked rider. The first version uses load-based automatic assignment rather than an assignment selector.
6. Open the rider app after deployment: https://alshamiapp.xyz/rider.html or https://hasanalkhaled06-maker.github.io/al-shami-app/rider.html. Sign in with the dedicated rider credentials. In Safari, use Share → Add to Home Screen to install it separately.

## How live tracking works

1. A customer places a delivery order with a map pin, address, and contact details.
2. Management accepts the order. The database assigns it to an active linked delivery rider; the rider app refreshes the assignment board automatically.
3. On the rider's phone, the rider taps Start location sharing and allows GPS access. The app publishes only the latest coordinates while the rider has active assigned deliveries.
4. Management changes the order to Out for delivery when the rider actually starts the delivery. Only then does the customer see the live map and rider marker; the map refreshes independently every few seconds.
5. Management continues to control status, including the existing receipt-code confirmation for completed handoff. Once marked Completed, the order leaves the rider's active board and the customer history shows it as complete.

The database stores the latest GPS point per rider, not a route history. The customer tracking RPC exposes only the rider point connected to the customer's private tracking token and only while that delivery is Out for delivery. Direct browser access to the GPS table is revoked.

## iPhone GPS limitations

Location sharing requires HTTPS, network connectivity, and location permission. Keep the rider app open in the foreground during a delivery. iOS may suspend GPS updates when a browser/PWA is backgrounded or the screen is locked; the first version does not guarantee always-on background tracking. Native/background-location support would be a separate later phase.

## Required acceptance and security tests

- Existing customer checkout, sign-in, menu, admin login, order status, and history still work.
- Create a test delivery-rider Auth account and link it to an active Delivery Rider employee profile.
- Submit a test delivery order with a map pin; confirm admin acceptance assigns it automatically and the rider board displays customer name/phone, address, items, total, status, and directions.
- Submit a test pickup order and confirm it never appears on the rider board.
- Verify the rider screen has no accept, reject, completion, or status-change controls.
- Tap Start location sharing on the rider phone and grant GPS permission. Verify the latest point and timestamp update.
- Change the test delivery to Out for delivery in admin. Confirm the customer tracking card displays destination and rider map, and the rider marker changes as the GPS point changes.
- Confirm the location is hidden from customer tracking when the status is Accepted, Preparing, Ready, Completed, or Rejected.
- Complete a test order through the existing admin receipt-code flow. Confirm it leaves the rider active list and moves to customer History.
- Confirm one customer cannot request location with another customer's token, and an unrelated rider cannot read the assigned order or update GPS.
- Test offline/reconnect, a denied GPS permission, no active rider profile, an old GPS point, and the app on an iPhone.

A script syntax check is not an end-to-end test. Do not mark the feature verified until the database migration, deployment, permissions, and phone-to-customer map are tested with test accounts.

## Secrets

Keep only the Supabase public publishable/anon key in browser JavaScript. Never expose the service-role key, database password, or private staff credentials.
