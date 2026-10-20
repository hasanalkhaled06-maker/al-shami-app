# AL SHAMI ordering system — setup and deployment

This is a deployable starter web app with:
- Customer menu and basket, delivery/pickup checkout, cash payment.
- Orders saved in Supabase (not WhatsApp).
- Protected staff/admin login.
- Live incoming orders with sound alert while the admin dashboard is open.
- Menu price/availability/photo/description management, offers, delivery fee and minimum order.
- Responsive pages for iPhone and laptop.

## Important limitation
The files are the implementation, but the live database cannot be connected until you create your own Supabase project and paste its URL and public anon/publishable key into `assets/config.js`. Do **not** put a Supabase `service_role` key in browser files. Sound works after staff taps **Enable sound alerts** once on each device. The admin dashboard must remain open and connected for immediate in-page sound; mobile operating systems may suspend browser tabs in the background. Reliable background notifications require a later push-notification setup.

## 1. Create the database
1. Open https://supabase.com and create a project. Save the database password privately.
2. In your project, open **SQL Editor** → **New query**.
3. Open `supabase-schema.sql`, copy all its contents, paste into SQL Editor, then click **Run**.
4. Open **Project Settings → API** (or the API keys page). Copy the **Project URL** and the **anon/public/publishable key**. Never copy the service-role/secret key into the website.

## 2. Configure the website
Open `assets/config.js` in a text editor and replace:
- `PASTE_SUPABASE_PROJECT_URL_HERE` with the Project URL.
- `PASTE_SUPABASE_ANON_OR_PUBLISHABLE_KEY_HERE` with the public anon/publishable key.

Keep the quote marks. Save the file.

## 3. Create the first admin login
1. In Supabase, open **Authentication → Users → Add user** and create the restaurant admin email/password.
2. Copy the user's UUID/ID from the Users table.
3. Open **SQL Editor → New query** and run this, replacing the UUID with the real ID:
```sql
insert into public.admin_users(user_id)
values ('PASTE-THE-AUTH-USER-UUID-HERE');
```
4. Use that email/password at `admin.html`. Do not share the login. Add more staff only if they need admin access, by creating Auth users and adding their UUIDs.

## 4. Publish to Netlify
1. Ensure `assets/config.js` is saved with the real project values.
2. Keep the folder structure exactly as it is: `index.html`, `admin.html`, `assets/…`.
3. Zip the contents of the `al_shami_ordering_system` folder (not a parent folder containing it).
4. In Netlify, create a new site or open your existing site and deploy the ZIP using the manual deploy / deploy folder interface. If Netlify Drop accepts folders only, unzip locally and drop the folder contents. Do not upload only `index.html`; the `assets` folder is required.
5. Customer ordering page is the site root. Admin page is `https://YOUR-SITE.netlify.app/admin.html`.
6. In Supabase, open **Authentication → URL Configuration** and add your Netlify site URL to the allowed Site URL / Redirect URLs if needed.

## 5. Test before sharing
1. Open `admin.html` on your iPhone or laptop, sign in, and tap **Enable sound alerts**. Keep this page open.
2. In another browser/device, open the customer site, add an item from the menu and submit a test order.
3. Confirm the order appears in the admin dashboard and the sound plays.
4. Change the status to Accepted → Preparing → Ready → Completed.
5. Test pickup and delivery. Verify delivery fee and minimum order in **Settings**.
6. Add the real menu, prices, and photo URLs in **Menu & prices**. Photos need publicly accessible HTTPS image URLs.

## 6. Daily use
- Customer page: share your Netlify site URL.
- Staff dashboard: bookmark `/admin.html` on iPhone and laptop. Sign in and enable sound on both.
- New orders appear in the dashboard through Supabase Realtime; staff can accept/reject and update status.
- Menu changes are saved in the database and show on the customer page after refresh.
- Offers are displayed on the customer page when active.
- This starter accepts cash on delivery / cash at pickup; it does not process card or Mobile Money payments.

## Security notes
- Public visitors can read available menu items and active offers and can submit an order only through the validated `place_order` database function.
- Public visitors cannot query customer orders. Only user IDs listed in `public.admin_users` can access the admin dashboard data.
- Never expose the database password or service-role key.
- Use HTTPS and a strong unique admin password.
