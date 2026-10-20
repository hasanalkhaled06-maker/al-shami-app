# AL SHAMI Operations Upgrade (v2)

This bundle is an **add-on**, not a replacement for your existing restaurant site.

## Included
- `supabase-migration-v2.sql`: creates new tables for inventory, suppliers, inventory movements, expenses, staff profiles, cash shifts, and audit records. It also adds admin-only RPCs for stock movements, expenses, and shift closing.
- `admin-operations.js`: adds an Operations tab to the current admin dashboard for inventory, suppliers, expenses, cash shifts, and basic daily figures.

## Before using it
1. Back up the Supabase project and the GitHub repository.
2. Review `supabase-migration-v2.sql`. It creates new tables and functions and does not drop existing tables, but SQL changes are still consequential.
3. Run the migration manually in Supabase SQL Editor only when you choose to.
4. Upload `admin-operations.js` to the same root directory as `admin.html`.
5. In `admin.html`, add this line immediately after the existing `<script src="admin.js"></script>`:
   `<script src="admin-operations.js"></script>`
6. Commit changes and test on a non-production copy first if available.

## Important limitations
- This module uses the existing `is_current_user_admin()` authorization check. It does not yet implement separate per-role permissions even though it creates staff profile records.
- Supplier records are managed, but purchase-order workflows are not yet implemented.
- Inventory is manual: recording a sale does not automatically consume ingredients. Recipe/ingredient mapping is a later phase.
- The daily report shows completed-order sales minus recorded expenses; this is not full net profit.
- Payment remains cash/manual. No online payment gateway is added.
- The module does not change existing customer ordering code or existing order/menu records.
