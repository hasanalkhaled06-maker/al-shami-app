# AL SHAMI Restaurant & Fast Food

AL SHAMI is a mobile-friendly restaurant ordering website with a private staff dashboard. The project is deployed with GitHub Pages and uses the existing Supabase project for orders, menu data, settings, and restaurant operations.

## Live apps

- Customer app: https://hasanalkhaled06-maker.github.io/al-shami-app/
- Admin app: https://hasanalkhaled06-maker.github.io/al-shami-app/admin.html

The two entry points share the same application and database, but use separate manifests and home-screen icons. The admin page remains protected by Supabase authentication and the `admin_users` allow-list.

## Install on iPhone

Install each app separately using Safari:

1. Open the customer or admin URL in Safari.
2. Tap **Share** → **Add to Home Screen**.
3. Enable **Open as Web App** if the option is shown.
4. Tap **Add**.

This installs web apps on the iPhone Home Screen; these are not native apps published in the App Store. When a new website version is deployed, the app checks for updates on launch/return to the foreground. Ordering still requires an internet connection.

## Main files

- `index.html`, `customer.js`: public menu, basket, cash-only checkout, order confirmation.
- `admin.html`, `admin.js`: sign-in, incoming orders, menu/prices, offers, restaurant settings.
- `admin-operations.js`: inventory, stock-movement history, suppliers, staff roster, expenses, cash shifts, and basic daily reporting.
- `config.js`: Supabase project URL and public publishable key. Never put a service-role/secret key in browser code.
- `manifest.webmanifest`, `admin.webmanifest`: separate install settings for customers and administrators.
- `pwa.js`, `service-worker.js`: install/update registration and network-first static asset caching.
- `icons/`: separate AL SHAMI and admin home-screen icons.
- `supabase-schema.sql`: base schema for a new Supabase environment.
- `supabase-migration-v2.sql`: additive operations tables, access policies, stock/expense/cash-shift functions, indexes, and grants.

## Database setup and safety

The connected production Supabase project already contains the base ordering schema and operations tables. Before applying future SQL changes, back up the database and review the exact migration. Do not run arbitrary SQL, drop production tables, or overwrite the service-role key in browser files.

For a new environment, apply `supabase-schema.sql` first, configure the public Supabase URL/key in root `config.js`, create an Auth user, and add that user’s UUID to `public.admin_users`. Then review and apply `supabase-migration-v2.sql`.

## Operations features and known limits

- Stock levels and stock movements are recorded manually; ingredient consumption is not automatically deducted from each sold meal.
- Inventory items can be associated with suppliers.
- Staff profiles are a roster of names, phone numbers, and role labels; they do not create login accounts or implement per-role permissions.
- Cash-shift expected cash is calculated from opening cash plus completed orders marked during the shift, minus recorded cash expenses created during the shift. Mark an order **Completed** only after collecting payment.
- There is no separate cash-payout register yet, and the daily summary is not a complete net-profit calculation.
- Online payment gateways are intentionally deferred. The customer checkout remains cash-only.
- Push notifications while the app is fully closed are not included; the admin dashboard’s in-page alerts require the page to remain active.

## Deployment

GitHub Pages is configured to publish the `main` branch from the repository root. Changes merged directly to `main` trigger a Pages deployment. After deployment succeeds, open the two live URLs above and verify that the customer page loads and admin sign-in/operations are working.
