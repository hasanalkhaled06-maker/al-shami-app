# AL SHAMI Operations Upgrade

This upgrade adds restaurant operations features to the existing AL SHAMI application.

## Files

- admin-operations.js
  Adds inventory, suppliers, expenses, cash shifts and daily reports, using
  the authenticated session created by admin.js.

- admin-delivery-ops.js
  Adds delivery monitoring under Operations → Reports and loyalty configuration
  under Settings.

- supabase-migration-v2.sql
  Creates new database tables and functions for the operations module.

- supabase-migration-v3.sql
  Adds purchase orders, cash payouts, staff attendance, recipe-based stock usage, order completion timestamps, and updated cash reconciliation.

- README-UPGRADE.md
  Contains setup and safety instructions.

## Operations module wiring

The current `admin.html` already loads `config.js`, `admin.js`, `admin-operations.js`, and `pwa.js) in the required order. Do not add duplicate script tags.

## Install as three home-screen apps

The repository now provides two installable web-app entry points:

- Customer app: `index.html` + `manifest.webmanifest`
- Private admin app: `admin.html` + `admin.webmanifest`
- Private delivery rider app: `rider.html` + `rider.webmanifest`

Shared PWA files:

- `pwa.js` registers the service worker and checks for app updates.
- `service-worker.js` uses network-first caching for same-origin static files, keeping the live app fresh when online and providing a cached shell when offline.
- `icons/` contains separate AL SHAMI and admin home-screen icons.

### Install on iPhone

For each app separately, open its URL in Safari, tap Share, choose **Add to Home Screen**, enable **Open as Web App** if shown, then tap Add.

- Customer: `https://alshamiapp.xyz/`
- Admin: `https://alshamiapp.xyz/admin.html`
- Delivery rider: `https://alshamiapp.xyz/rider.html`

The admin still requires an authorised login. Home-screen installation does not publish the apps to the App Store. After a new website version is published, the installed web apps check for updates when opened or returned to the foreground; a native App Store release is not part of this PWA workflow.

## Database setup

The connected production project already has the operations tables, v3 additions, and RPC functions installed. `supabase-migration-v3.sql` is a reproducible additive setup file for environments that already applied `supabase-schema.sql` and `supabase-migration-v2.sql`; it was not needed to reinstall production. Before applying future database changes, back up the project and review the exact migration first. Do not drop existing tables.

Never put the Supabase service-role key in browser JavaScript.

## Current features

- Existing customer menu and ordering system remains separate; existing order records are preserved.
- Inventory stock movements, supplier links, low-stock tracking, purchase orders and a receive-stock action are available.
- Menu recipes can map sold menu items to stock ingredients; configured ingredients are deducted once when an order changes to Completed.
- Suppliers, staff contacts and role labels can be maintained.
- Staff attendance records clock-in, clock-out and hours.
- Expenses and a separate cash-payout register are available.
- Cash shifts can be opened and closed with cash sales, cash expenses and cash payouts included in reconciliation.
- Orders support text search and CSV export; operations reports support date ranges and CSV export.
- Payments remain cash/manual; no online payment gateway is included.

## Limitations

- Recipe deductions only apply to ingredients configured for each menu item; unconfigured menu items do not automatically deduct stock. Set up all recipe lines and keep recipe quantities in the same unit as inventory.
- Staff role records exist, but separate database-enforced permissions for each role are not implemented.
- The purchase-order UI currently creates a single stock-item line per order.
- Cash reconciliation uses order status as the cash-sale signal because the current ordering flow is cash-only; mark orders Completed only after cash is collected.
- The operations summary is not a complete net-profit calculation; ingredient costs are reflected only where recipes and stock costs are configured, and payroll/overhead still need accurate recording.
- Loyalty rules are disabled until the restaurant configures stamps and points in **Settings**. Points are store credit for order discounts only; there is no cash-out.
- Customer web-push subscription and delivery paths are implemented, and the `customer-push` Edge Function is deployed. Delivery has not yet been verified end to end on a real subscribed customer device.
- Online payments and phone OTP login are deferred until payment/SMS providers are configured.
- Push delivery while the app is fully closed depends on browser/OS support and the customer's device permission. PWA updates need internet and are checked when the app opens or returns to the foreground; offline mode does not submit orders.

## Testing

Before using this system for daily restaurant operations:

1. Sign in to the admin dashboard.
2. Confirm the existing orders and menu still load.
3. Open the Operations tab.
4. Test inventory and expenses with sample data.
5. Verify database permissions and errors.
6. Confirm existing customer orders continue to work.

Run `node --test tests/*.test.cjs` for the automated logic and static checks. These do not replace the browser/device flow below. Do not rely on the new module for live accounting until the cash and permission tests pass.