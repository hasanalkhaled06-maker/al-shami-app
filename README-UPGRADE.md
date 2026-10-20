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

## Connect the Operations module

Open admin.html and locate the script tags at the bottom of the file.

Find this line:

<script src="admin.js"></script>

Add this line immediately after it:

<script src="admin-operations.js"></script>

Keep the existing config.js and admin.js script tags.

Save and commit the change.

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

1. Back up the Supabase project before making database changes.
2. Review supabase-migration-v2.sql.
3. Test the migration on a separate test project when possible.
4. Run the migration manually in the Supabase SQL Editor only after review.
5. Sign in using an authorised restaurant admin account.

Do not put the Supabase service-role key in browser JavaScript.

## Current features

- Existing customer menu and ordering system remains separate.
- Inventory quantities and stock movements can be recorded manually.
- Suppliers can be recorded.
- Expenses can be recorded.
- Cash shifts can be opened and closed.
- Basic daily sales and expense figures are displayed.
- Payments remain manual/cash; no online payment gateway is included.

## Limitations

- Ingredient usage is not automatically deducted when an order is sold.
- Staff role records exist, but separate permissions for each role are not implemented.
- Purchase orders are not fully implemented.
- Cash expected at shift closing is not yet calculated from cash sales and payouts.
- The daily summary is not a complete net-profit calculation.

## Testing

Before using this system for daily restaurant operations:

1. Sign in to the admin dashboard.
2. Confirm the existing orders and menu still load.
3. Open the Operations tab.
4. Test inventory and expenses with sample data.
5. Verify database permissions and errors.
6. Confirm existing customer orders continue to work.

Do not rely on the new module for live accounting until these tests pass.