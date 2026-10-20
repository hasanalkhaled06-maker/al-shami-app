# AL SHAMI Operations Upgrade

This upgrade adds restaurant operations features to the existing AL SHAMI application.

## Files

- admin-operations.js
  Adds the Operations dashboard for inventory, suppliers, expenses,
  cash shifts and basic daily reports.

- supabase-migration-v2.sql
  Creates new database tables and functions for the operations module.

- README-UPGRADE.md
  Contains setup and safety instructions.

## Operations module wiring

The current `admin.html` already loads `config.js`, `admin.js`, `admin-operations.js`, and `pwa.js) in the required order. Do not add duplicate script tags.

## Install as two home-screen apps

The repository now provides two installable web-app entry points:

- Customer app: `index.html` + `manifest.webmanifest`
- Private admin app: `admin.html` + `admin.webmanifest`

Shared PWA files:

- `pwa.js` registers the service worker and checks for app updates.
- `service-worker.js` uses network-first caching for same-origin static files, keeping the live app fresh when online and providing a cached shell when offline.
- `icons/` contains separate AL SHAMI and admin home-screen icons.

### Install on iPhone

For each app separately, open its URL in Safari, tap Share, choose **Add to Home Screen**, enable **Open as Web App** if shown, then tap Add.

- Customer: `https://hasanalkhaled06-maker.github.io/al-shami-app/`
- Admin: `https://hasanalkhaled06-maker.github.io/al-shami-app/admin.html`

The admin still requires an authorised login. Home-screen installation does not publish the apps to the App Store. After a new website version is published, the installed web apps check for updates when opened or returned to the foreground; a native App Store release is not part of this PWA workflow.

## Database setup

The connected production project already has the operations tables and RPC functions installed. Before applying future database changes, back up the project and review the exact migration first. Do not re-run migrations blindly or drop existing tables.

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
- Online payments and phone OTP login are deferred until payment/SMS providers are configured.
- Push notifications while the app is fully closed are not included. PWA updates require internet access and the app must be opened/foregrounded to check for updates; offline mode does not submit orders.

## Testing

Before using this system for daily restaurant operations:

1. Sign in to the admin dashboard.
2. Confirm the existing orders and menu still load.
3. Open the Operations tab.
4. Test inventory and expenses with sample data.
5. Verify database permissions and errors.
6. Confirm existing customer orders continue to work.

Do not rely on the new module for live accounting until these tests pass.