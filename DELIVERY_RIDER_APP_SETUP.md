# AL SHAMI Delivery Rider App — Setup & Verification

## Scope

The rider app is a third installable PWA in the same AL SHAMI app and Supabase project.

- `rider.html`: private rider login and delivery board.
- `rider.js` and `rider.css`: assigned deliveries, directions, phone links, status refresh, and GPS sharing.
- `rider-ops.js`: arrival/departure events, failed-attempt reasons, last GPS update, and nearest assigned deliveries.
- `rider.webmanifest` and `icons/al-shami-rider.svg`: separate rider install identity.
- `supabase/migrations/20261023131500_delivery_rider_live_tracking_v1.sql`: rider role, assignment, protected location storage, and scoped RPCs.
- `supabase/migrations/20261025173500_rider_delivery_operations_view.sql`: private assigned-delivery details for riders.
- `supabase/migrations/20261025173000_customer_rewards_delivery_ops.sql`: rider events, stale-GPS reporting, delivery duration by zone, and customer rewards.
- `supabase/migrations/20261025174000_customer_rewards_delivery_fk_indexes.sql`: supporting foreign-key indexes.
- `supabase/migrations/20261025175000_referral_bonus_awarded_once.sql`: one-time referral bonus on a referred customer's first completed order.

The rider screen does not accept, reject, complete, or otherwise change order status. Management remains responsible for order status. Accepted delivery orders are assigned automatically to an active rider profile with the fewest unfinished deliveries. Pickup orders are never assigned. An order stays unassigned when no active rider account is linked to an employee profile.

## Current database rollout state

The customer rewards and delivery-operations migrations listed above have been applied to the connected production Supabase project. Loyalty is disabled by default. No customer points, stamps, or referral rewards were issued during setup. The referral bonus is now marked once, on the referred customer's first completed order, and is awarded only while loyalty is enabled.

The pre-existing order-visibility security migration and rider live-tracking migration are also present in the production migration history. Do not reapply them under a second name. The current schema is additive: it retains existing orders and cash checkout.

## Set up a rider account

1. On the rider app, choose **Create account**, enter the rider's full name, email, and a password of at least 8 characters. Complete email confirmation if Supabase requests it. Never share the administrator login with a rider.
2. Account creation does not approve the rider or grant order access. Management must link the account to an active rider employee profile.
3. In Supabase Authentication → Users, find the account and copy its Auth user UUID.
4. Sign in to the AL SHAMI admin app and open **Operations → Employee management**. Create or edit the employee profile; set System role to **Delivery Rider**, employment status to **Active**, and paste the exact Auth UUID. Save the profile. This is the approval gate checked by the server.
5. Keep the profile active. On the next accepted delivery order, the database assigns an eligible linked rider. Assignment is automatic and load-based; there is no manual assignment selector.
6. Open the rider app at [alshamiapp.xyz/rider.html](https://alshamiapp.xyz/rider.html) or [GitHub Pages rider app](https://hasanalkhaled06-maker.github.io/al-shami-app/rider.html). Sign in with the Auth user UUID linked to the employee profile and that Auth account's password. In Safari, use Share → Add to Home Screen to install it separately.

## How live tracking works

1. A customer places a delivery order with a map pin, address, and contact details.
2. Management accepts it. The database assigns it to an active linked rider; the rider app refreshes the assignment board.
3. The rider taps **Start location sharing** and grants GPS permission. The app publishes the latest coordinates while active assigned deliveries exist.
4. Management sets the order to **Out for delivery** when the rider starts the delivery. Only then does the customer see the live map and rider marker.
5. Management controls the final status, including the existing receipt-code confirmation. Once completed, the order leaves the rider's active board and appears complete in customer history.

The database stores the latest GPS point per rider, not a route history. Customer tracking exposes only the rider point for that customer's private tracking token and only while the order is **Out for delivery**. Direct browser access to the GPS table is revoked.

The rider operations panel records arrival at the restaurant, departure, and failed-attempt reason. The admin **Operations → Reports** area shows active deliveries with a stale-location warning after 45 seconds without a current GPS update and a delivery-duration report by zone. Stale-location warnings appear in the open dashboard; they are not push notifications.

## iPhone GPS limitations

Location sharing requires HTTPS, network connectivity, and location permission. Keep the rider app open in the foreground during a delivery. iOS may suspend GPS updates when a browser/PWA is backgrounded or the screen is locked; this version does not guarantee always-on background tracking.

## Required acceptance and security checks

These checks require test accounts and a real rider/customer phone session; repository presence and a successful deployment alone do not prove end-to-end behavior.

- Confirm customer checkout, sign-in, menu, admin login, order status, and history still work.
- Create a test rider Auth account and link it to an active Delivery Rider employee profile.
- Submit a test delivery with a map pin; confirm accepting it assigns it and the rider board shows the intended order details and directions.
- Submit a pickup and confirm it does not appear on the rider board.
- Confirm the rider screen has no order-status controls.
- On the rider's phone, start location sharing and verify the position and timestamp change.
- Set the test delivery to **Out for delivery** and confirm customer tracking follows the rider's new location.
- Confirm customer tracking hides the location for every other order status.
- Complete the test order through the existing admin receipt-code flow; confirm it leaves the active rider list and appears in History.
- Confirm another customer cannot use the customer's tracking token and an unrelated rider cannot read or update the delivery.
- Check denied GPS permission, reconnect after offline use, a stale GPS point, and the iPhone foreground behavior.

A script syntax check is not an end-to-end test. Mark these checks complete only after the database, deployment, permissions, and phone-to-customer map have been exercised with test accounts.

## Secrets

Keep only the Supabase public publishable/anon key in browser JavaScript. Never expose the service-role key, database password, or private staff credentials.
