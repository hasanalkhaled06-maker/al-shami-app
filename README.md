# AL SHAMI Restaurant & Fast Food

AL SHAMI is a mobile-friendly restaurant ordering website with a private staff dashboard. The project is deployed with GitHub Pages and uses the existing Supabase project for orders, menu data, settings, and restaurant operations.

## Live apps

- Customer app: https://hasanalkhaled06-maker.github.io/al-shami-app/
- Admin app: https://hasanalkhaled06-maker.github.io/al-shami-app/admin.html
- Delivery rider app: https://hasanalkhaled06-maker.github.io/al-shami-app/rider.html

The customer, admin, and rider entry points share the existing Supabase project but use distinct app pages and install settings. The admin page remains protected by Supabase authentication and the `admin_users` allow-list. The rider page is read-only for order work: it shows assigned deliveries and shares GPS location, but cannot accept/reject orders or change order status.

## Visual design

The active shared visual palette is **cream + soft blue**: warm cream page backgrounds, pale-blue surfaces and cards, deep-blue primary buttons and icons, navy text, light borders, and restrained champagne-gold utility accents. The shared `dark-theme.css` loads last on the customer, order-history, admin, and delivery-rider pages to override earlier legacy styling and keep all four interfaces visually consistent. Statuses retain clear, accessible semantic colors (green for accepted/completed, amber for pending/preparing, blue for ready/in-progress, and red for errors or rejected orders). Avoid restoring charcoal/black surface backgrounds or low-contrast text in later CSS changes.


## Install on iPhone

Install each app separately using Safari:

1. Open the customer or admin URL in Safari.
2. Tap **Share** → **Add to Home Screen**.
3. Enable **Open as Web App** if the option is shown.
4. Tap **Add**.

This installs web apps on the iPhone Home Screen; these are not native apps published in the App Store. When a new website version is deployed, the app checks for updates on launch/return to the foreground. Ordering still requires an internet connection.

## Main files

- `index.html`, `customer.js`: customer menu, basket, cash-only checkout, order tracking and confirmation.
- `dark-theme.css`: approved shared cream-blue design system across customer, history, admin, and rider pages.
- `admin.html`, `admin.js`: sign-in, incoming orders, menu/prices, offers, restaurant settings.
- `admin-operations.js`: inventory, stock-movement history, suppliers, staff roster, expenses, cash shifts, and basic daily reporting.
- `config.js`: Supabase project URL and public publishable key. Never put a service-role/secret key in browser code.
- `manifest.webmanifest`, `admin.webmanifest`, `rider.webmanifest`: separate install settings for customers, administrators, and delivery riders.
- `rider.html`, `rider.js`, `rider.css`: private rider workspace with assigned deliveries, map navigation, and GPS sharing.
- `supabase/migrations/20261023131500_delivery_rider_live_tracking_v1.sql`: additive rider role, automatic delivery assignment, and securely scoped location RPCs.
- `DELIVERY_RIDER_APP_SETUP.md`: rollout sequence, rider-account linking instructions, and required acceptance/security tests.
- `pwa.js`, `service-worker.js`: install/update registration and network-first static asset caching.
- `icons/`: separate AL SHAMI and admin home-screen icons.
- `supabase-schema.sql`: base schema for a new Supabase environment.
- `supabase-migration-v2.sql`: additive operations tables, access policies, stock/expense/cash-shift functions, indexes, and grants.
- `supabase-migration-v3.sql`: additive purchase orders, cash payouts, staff attendance, menu recipes, automatic recipe-stock deductions on completion, order completion timestamps, and updated cash-shift reconciliation.
- `supabase-migration-staff-management-v1.sql`: detailed employee profiles, employment and salary fields, and a private Storage bucket for employee photos, ID scans, and contracts. The production migration has been applied; employee documents are restricted to authorised admins.

## Database setup and safety

The connected production Supabase project already contains the base ordering schema and operations tables. Before applying future SQL changes, back up the database and review the exact migration. Do not run arbitrary SQL, drop production tables, or overwrite the service-role key in browser files.

For a new environment, apply `supabase-schema.sql` first, configure the public Supabase URL/key in root `config.js`, create an Auth user, and add that user’s UUID to `public.admin_users`. Then review and apply `supabase-migration-v2.sql`, followed by `supabase-migration-v3.sql`. The v3 file is additive and is provided for reproducible setup; its features are already installed in this production project.

## Operations features and known limits

- Inventory has stock-movement history, low-stock indicators, supplier links, purchase orders, and a receive-stock action. Stock increases only after the purchase is marked received.
- Recipe-based stock usage is recorded when an order changes to **Completed**. Configure ingredients and amounts per menu item in **Operations → Recipes & food cost** first; items without recipe mappings are not auto-deducted.
- Cash payouts can be entered separately from expenses and are deducted during cash-shift reconciliation when associated with the shift or entered during its open period.
- Staff attendance supports clock-in, clock-out, and hours for the day. Staff profiles remain a roster; they do not create login accounts or implement separate permissions for each role.
- Orders can be searched by order number, customer, phone, address, menu item or status, and visible results can be exported to CSV. Operations reports support date ranges and CSV export.
- Reports show completed sales less recorded expenses and payouts; this is not a full net-profit calculation unless ingredient costs, payroll and all other costs are consistently configured and recorded.
- Purchase-order entry currently creates one stock-item line per order. The database structure supports multiple lines, but the UI can be expanded for multi-item receiving.
- Online payment gateways are intentionally deferred. The customer checkout remains cash-only; phone OTP login is paused until a supported SMS provider is configured.
- Push notifications while the app is fully closed are not included; the admin dashboard’s in-page alerts require the page to remain active.

## Deployment

GitHub Pages is configured to publish the `main` branch from the repository root. Changes merged directly to `main` trigger a Pages deployment. After deployment succeeds, open the two live URLs above and verify that the customer page loads and admin sign-in/operations are working.
