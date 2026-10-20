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

- Existing customer menu and ordering system remains separate.
- Inventory items can be linked to suppliers, and a recent stock-movement history is shown.
- Suppliers can be recorded.
- Staff contacts and role labels can be maintained in the roster; this does not create login accounts or change permissions.
- Expenses can be recorded.
- Cash shifts can be opened and closed with expected cash calculated from completed cash orders and recorded cash expenses during the shift.
- Recent stock movements are shown for audit/history.
- Basic daily sales and expense figures are displayed.
- Payments remain manual/cash; no online payment gateway is included.

## Limitations

- Ingredient usage is not automatically deducted when an order is sold.
- Staff role records exist, but separate permissions for each role are not implemented.
- Purchase orders are not fully implemented.
- Cash reconciliation uses order status as the cash-sale signal because the current ordering flow is cash-only; mark orders Completed only after cash is collected.
- There is no separate cash payout register yet.
- Ingredient usage is entered manually; it is not automatically deducted by order composition.
- The daily summary is not a complete net-profit calculation.
- PWA updates require internet access and the app must be opened/foregrounded to check for updates; offline mode does not submit orders.

## Testing

Before using this system for daily restaurant operations:

1. Sign in to the admin dashboard.
2. Confirm the existing orders and menu still load.
3. Open the Operations tab.
4. Test inventory and expenses with sample data.
5. Verify database permissions and errors.
6. Confirm existing customer orders continue to work.

Do not rely on the new module for live accounting until these tests pass.