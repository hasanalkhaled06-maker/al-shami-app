/* AL SHAMI Operations Module v2
 * Requires config.js and Supabase JS to load before this file.
 */
(() => {
  "use strict";

  const cfg = window.AL_SHAMI_CONFIG || {};

  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    console.error("AL SHAMI: Supabase configuration is missing.");
    return;
  }

  const db = window.AL_SHAMI_ADMIN_DB || window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_ANON_KEY,
    {
      auth: {
        storageKey: "al-shami-admin-auth-v1",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  const $ = (selector, root = document) => root.querySelector(selector);

  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

  const money = value => "GH₵ " + Number(value || 0).toFixed(2);

  let loaded = false;
  let loading = false;
  let lastReportRows = [];
  let stockItems = [];
  let selectedStockCategory = "";
  let selectedStockItem = null;

  function addStyles() {
    if ($("#ops-styles")) return;

    const style = document.createElement("style");
    style.id = "ops-styles";
    style.textContent = `
      .ops-grid {
        display: grid;
        grid-template-columns: repeat(3,minmax(0,1fr));
        gap: 12px;
        margin: 12px 0;
      }
      .ops-stat {
        background: #fffaf5;
        border: 1px solid #eee3dc;
        border-radius: 12px;
        padding: 14px;
      }
      .ops-stat small {
        display: block;
        color: #766d6c;
      }
      .ops-stat strong {
        font-size: 22px;
      }
      .ops-table-wrap {
        overflow: auto;
      }
      .ops-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      .ops-table th,
      .ops-table td {
        padding: 10px;
        border-bottom: 1px solid #eee3dc;
        text-align: left;
        white-space: nowrap;
      }
      .ops-form {
        display: grid;
        grid-template-columns: repeat(3,minmax(0,1fr));
        gap: 10px;
        margin: 14px 0;
      }
      .ops-form label {
        font-size: 12px;
        font-weight: 700;
        display: grid;
        gap: 5px;
      }
      .ops-form .wide {
        grid-column: 1/-1;
      }
      .ops-note { font-size: 12px; color: #766d6c; }
      #ops-subtabs {
        display: grid !important;
        grid-template-columns: repeat(3,minmax(0,1fr));
        gap: 12px; margin: 20px 0 24px;
      }
      #ops-subtabs .ops-tool-tile {
        min-height: 132px; display: flex; flex-direction: column; align-items: flex-start;
        justify-content: flex-start; gap: 7px; padding: 15px; border-radius: 15px;
        border: 1px solid #e8e0d8; background: linear-gradient(145deg,#fff 0%,#fbf8f3 100%);
        color: #302326; text-align: left; white-space: normal;
        box-shadow: 0 5px 15px rgba(55,25,28,.045);
        transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
      }
      #ops-subtabs .ops-tool-tile:hover { transform: translateY(-2px); box-shadow: 0 10px 22px rgba(55,25,28,.09); border-color: #d4b878; }
      #ops-subtabs .ops-tool-tile.active { background: linear-gradient(145deg,#5a0e18,#851927); color: #fff9f1; border-color: #851927; box-shadow: 0 8px 20px rgba(103,16,26,.2); }
      .ops-tool-icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px; background: #f9e5e1; color: #8c1b26; font-size: 23px; font-weight: 800; line-height: 1; }
      #ops-subtabs .ops-tool-tile:nth-child(3n+2) .ops-tool-icon { background: #e2eff4; color: #235d72; }
      #ops-subtabs .ops-tool-tile:nth-child(3n) .ops-tool-icon { background: #f7edcf; color: #8b651c; }
      #ops-subtabs .ops-tool-tile.active .ops-tool-icon { background: rgba(255,255,255,.16); color: #ffe4a3; }
      .ops-tool-title { font-size: 15px; font-weight: 900; line-height: 1.25; }
      .ops-tool-description { color: #827779; font-size: 11px; font-weight: 500; line-height: 1.45; }
      #ops-subtabs .ops-tool-tile.active .ops-tool-description { color: rgba(255,249,241,.72); }
      .ops-shortcuts { display: grid; grid-template-columns: minmax(180px,1.3fr) repeat(3,minmax(110px,.7fr)); align-items: center; gap: 10px; margin: 18px 0 20px; padding: 14px; border: 1px solid #e5d9ca; border-radius: 15px; background: linear-gradient(100deg,#fff8e9,#fff); }
      .ops-shortcuts > div { display: grid; gap: 4px; }
      .ops-shortcuts-kicker { color: #8a641b; font-size: 9px; font-weight: 900; letter-spacing: .15em; }
      .ops-shortcuts strong { color: #3a2225; font-size: 14px; }
      .ops-shortcuts-note { color: #817576; font-size: 11px; line-height: 1.4; }
      .ops-shortcut-btn { display: flex; align-items: center; justify-content: space-between; gap: 6px; min-height: 44px; padding: 10px 12px; border: 1px solid #e2d4c7; border-radius: 10px; background: #fff; color: #5b111a; font-size: 12px; font-weight: 800; text-align: left; }
      .ops-shortcut-btn:hover { background: #f9edd7; border-color: #caa95d; }
      .ops-stock-category-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin:14px 0; }
      .ops-stock-category { display:flex; flex-direction:column; align-items:flex-start; gap:7px; min-height:104px; padding:13px; border:1px solid #e7ddd4; border-radius:14px; background:#fff; color:#342326; text-align:left; }
      .ops-stock-category.active { border-color:#9a2530; background:#fff4f1; box-shadow:0 0 0 2px rgba(154,37,48,.12); }
      .ops-stock-category-icon { font-size:25px; }
      .ops-stock-category strong { font-size:13px; }
      .ops-stock-category small { color:#766d6c; font-size:11px; }
      .ops-stock-toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; margin:12px 0; }
      .ops-stock-item-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:12px 0; }
      .ops-stock-item-card { display:flex; flex-direction:column; gap:9px; min-height:96px; padding:14px; border:1px solid #eadfd6; border-radius:13px; background:#fff; color:#342326; text-align:left; }
      .ops-stock-item-card strong { font-size:14px; }
      .ops-stock-item-card span { color:#1c704c; font-size:18px; font-weight:900; }
      .ops-stock-summary { display:flex; justify-content:space-between; align-items:center; gap:14px; margin:12px 0; padding:18px; border-radius:15px; background:linear-gradient(120deg,#f4f8f3,#fff); border:1px solid #dbe8dc; }
      .ops-stock-summary small { display:block; color:#68716a; }
      .ops-stock-summary strong { display:block; margin-top:4px; color:#1c704c; font-size:clamp(24px,5vw,38px); }
      .ops-stock-actions { display:flex; gap:10px; flex-wrap:wrap; margin:12px 0; }
      .ops-stock-entry { margin:14px 0; padding:14px; border:1px solid #eadfd6; border-radius:14px; background:#fffaf5; }
      .ops-stock-empty { padding:18px; border:1px dashed #d9cbc0; border-radius:12px; color:#766d6c; text-align:center; }
      @media(max-width:760px) { .ops-stock-category-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .ops-stock-item-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .ops-stock-toolbar { align-items:flex-start; flex-direction:column; } }
      @media(max-width:390px) { .ops-stock-item-grid { grid-template-columns:1fr; } }

      @media(max-width:760px) {
        #ops-subtabs { grid-template-columns: repeat(2,minmax(0,1fr)); gap: 9px; }
        #ops-subtabs .ops-tool-tile { min-height: 124px; padding: 12px; }
        .ops-tool-title { font-size: 13px; }
        .ops-tool-description { font-size: 10px; }
        .ops-shortcuts { grid-template-columns: repeat(2,minmax(0,1fr)); }
        .ops-shortcuts > div { grid-column: 1/-1; }
      }
      @media(max-width:360px) {
        #ops-subtabs .ops-tool-tile { min-height: 118px; padding: 10px; }
        .ops-shortcut-btn { padding: 9px; font-size: 11px; }
      }
      @media(max-width:700px) {
        .ops-grid,
        .ops-form {
          grid-template-columns: 1fr;
        }
        .ops-form .wide {
          grid-column: auto;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function addPanel() {
    if ($("#tab-operations")) return;

    const tabs = $(".admin-tabs");
    const dashboard = $("#dashboard");

    if (!tabs || !dashboard) {
      console.error("AL SHAMI: Admin dashboard elements were not found.");
      return;
    }

    const button = document.createElement("button");
    button.className = "tab";
    button.dataset.tab = "operations";
    button.type = "button";
    button.textContent = "Operations";
    tabs.appendChild(button);

    const panel = document.createElement("section");
    panel.id = "tab-operations";
    panel.className = "panel hidden";

    panel.innerHTML = `
      <h2>Restaurant operations</h2>
      <p class="muted">
        Inventory, suppliers, expenses, cash shifts and daily figures.
      </p>

      <div class="ops-grid">
        <div class="ops-stat">
          <small>Active stock items</small>
          <strong id="ops-stock-count">—</strong>
        </div>
        <div class="ops-stat">
          <small>Low stock items</small>
          <strong id="ops-low-count">—</strong>
        </div>
        <div class="ops-stat">
          <small>Expenses today</small>
          <strong id="ops-expenses-today">—</strong>
        </div>
      </div>

      <div class="admin-tabs ops-tools-grid" id="ops-subtabs" aria-label="Restaurant management tools">
        <button class="tab active ops-tool-tile" data-opstab="inventory" type="button"><span class="ops-tool-icon" aria-hidden="true">▦</span><span class="ops-tool-title">Inventory</span><span class="ops-tool-description">Stock levels and low-stock items</span></button>
        <button class="tab ops-tool-tile" data-opstab="suppliers" type="button"><span class="ops-tool-icon" aria-hidden="true">⇄</span><span class="ops-tool-title">Suppliers</span><span class="ops-tool-description">Supplier contacts and details</span></button>
        <button class="tab ops-tool-tile" data-opstab="staff" type="button"><span class="ops-tool-icon" aria-hidden="true">♙</span><span class="ops-tool-title">Staff</span><span class="ops-tool-description">Employee records and documents</span></button>
        <button class="tab ops-tool-tile" data-opstab="shifts" type="button"><span class="ops-tool-icon" aria-hidden="true">＄</span><span class="ops-tool-title">Cash shifts</span><span class="ops-tool-description">Open, close and reconcile tills</span></button>
        <button class="tab ops-tool-tile" data-opstab="purchases" type="button"><span class="ops-tool-icon" aria-hidden="true">＋</span><span class="ops-tool-title">Purchases</span><span class="ops-tool-description">Purchase orders and received stock</span></button>
        <button class="tab ops-tool-tile" data-opstab="expenses" type="button"><span class="ops-tool-icon" aria-hidden="true">↘</span><span class="ops-tool-title">Expenses</span><span class="ops-tool-description">Rent, utilities and operating costs</span></button>
        <button class="tab ops-tool-tile" data-opstab="payouts" type="button"><span class="ops-tool-icon" aria-hidden="true">↗</span><span class="ops-tool-title">Cash payouts</span><span class="ops-tool-description">Cash removed from the till</span></button>
        <button class="tab ops-tool-tile" data-opstab="attendance" type="button"><span class="ops-tool-icon" aria-hidden="true">◷</span><span class="ops-tool-title">Attendance</span><span class="ops-tool-description">Clock-in, clock-out and hours</span></button>
        <button class="tab ops-tool-tile" data-opstab="recipes" type="button"><span class="ops-tool-icon" aria-hidden="true">♨</span><span class="ops-tool-title">Recipes &amp; food cost</span><span class="ops-tool-description">Ingredient usage and portion cost</span></button>
        <button class="tab ops-tool-tile" data-opstab="reports" type="button"><span class="ops-tool-icon" aria-hidden="true">▥</span><span class="ops-tool-title">Reports</span><span class="ops-tool-description">Sales, expenses and cost summaries</span></button>
      </div>

      <div id="ops-message" class="status-message" role="status"></div>

      <section id="ops-inventory">
        <div class="ops-stock-toolbar">
          <div><h3>Stock</h3><p class="ops-note">Choose a category, open an item, then record stock received or used.</p></div>
          <button class="btn btn-primary" id="ops-add-item-btn" type="button">＋ Add item</button>
        </div>
        <div id="ops-inventory-categories" class="ops-stock-category-grid" aria-label="Stock categories"></div>
        <div id="ops-stock-catalog">
          <form id="ops-item-form" class="ops-form" hidden>
            <label>Category
              <input name="category" id="ops-stock-category-input" list="ops-stock-category-options" required maxlength="80" placeholder="Drinks, Chicken, Disposable…">
              <datalist id="ops-stock-category-options"></datalist>
            </label>
            <label>Item name
              <input name="name" required maxlength="120" placeholder="Coca-Cola">
            </label>
            <label>Unit
              <input name="unit" required maxlength="20" value="pieces" placeholder="bottles, kg, packs">
            </label>
            <label>Starting stock
              <input name="quantity" type="number" min="0" step="0.001" required value="0">
            </label>
            <div class="wide ops-stock-actions">
              <button class="btn btn-primary" type="submit">Save item</button>
              <button class="btn btn-light" id="ops-cancel-item" type="button">Cancel</button>
            </div>
          </form>
          <div id="ops-stock-items"></div>
        </div>
        <section id="ops-stock-detail" hidden>
          <button class="btn btn-light" id="ops-stock-back" type="button">← Back to category</button>
          <h4 id="ops-stock-item-title"></h4>
          <div class="ops-stock-summary"><div><small>Current balance</small><strong id="ops-stock-current">—</strong></div><span id="ops-stock-low-label" class="ops-note"></span></div>
          <div class="ops-stock-actions">
            <button class="btn btn-primary" type="button" data-stock-movement="purchase">＋ Add received stock</button>
            <button class="btn btn-light" type="button" data-stock-movement="usage">− Record used / sold</button>
          </div>
          <form id="ops-movement-form" class="ops-form ops-stock-entry" hidden>
            <input type="hidden" name="item_id">
            <input type="hidden" name="movement_type">
            <label class="wide" id="ops-stock-entry-label">Quantity
              <input name="quantity_change" type="number" min="0.001" step="0.001" required placeholder="Enter quantity">
            </label>
            <label id="ops-stock-cost-field">Cost per unit (GH₵, optional)
              <input name="unit_cost" type="number" min="0" step="0.01" value="0">
            </label>
            <label>Note (optional)
              <input name="notes" maxlength="250" placeholder="Invoice or short note">
            </label>
            <p class="wide ops-note">Date is recorded automatically when you save.</p>
            <div class="wide ops-stock-actions">
              <button class="btn btn-primary" type="submit">Save entry</button>
              <button class="btn btn-light" id="ops-cancel-movement" type="button">Cancel</button>
            </div>
          </form>
          <h4>Daily stock balance</h4>
          <p class="ops-note">Each day shows the opening balance, stock added, stock used or sold, and the balance left at the end of the day.</p>
          <div id="ops-movements-list" class="ops-table-wrap"></div>
        </section>
      </section>

      <section id="ops-suppliers" class="hidden">
        <h3>Suppliers</h3>

        <form id="ops-supplier-form" class="ops-form">
          <label>Supplier name
            <input name="name" required maxlength="120">
          </label>
          <label>Phone
            <input name="phone" maxlength="40">
          </label>
          <label>Email
            <input name="email" type="email" maxlength="150">
          </label>
          <label class="wide">Address / notes
            <input name="address" maxlength="250">
          </label>
          <button class="btn btn-primary" type="submit">Add supplier</button>
        </form>

        <div id="ops-suppliers-list" class="ops-table-wrap"></div>
      </section>

      <section id="ops-staff" class="hidden">
        <h3>Employee management</h3>
        <p class="ops-note">Private employee records. Photos, ID scans and contracts are stored in a private bucket and can only be accessed by authorised administrators. Staff records do not create login accounts or change account permissions. To enable delivery tracking, create the rider login separately in Supabase Authentication, then paste its Auth user UUID into this profile and choose the Delivery Rider role. <a href="./rider.html" target="_blank" rel="noopener noreferrer">Open Rider App ↗</a></p>
        <form id="ops-staff-form" class="ops-form" enctype="multipart/form-data">
          <input name="id" type="hidden">
          <label>Full name *
            <input name="full_name" required maxlength="120" autocomplete="name">
          </label>
          <label>Photo (JPG, PNG, WEBP; max 10 MB)
            <input name="photo_file" type="file" accept="image/jpeg,image/png,image/webp">
          </label>
          <label>Phone
            <input name="phone" maxlength="40" autocomplete="tel">
          </label>
          <label>Email
            <input name="email" type="email" maxlength="150" autocomplete="email">
          </label>
          <label>Auth user UUID (rider login)
            <input name="user_id" type="text" maxlength="36" placeholder="UUID from Supabase Authentication" autocomplete="off" spellcheck="false">
          </label>
          <p class="ops-note wide">Only link the rider's own login UUID here. Do not enter an email address or password.</p>
          <label>Date of birth
            <input name="date_of_birth" type="date">
          </label>
          <label>Nationality
            <input name="nationality" maxlength="80">
          </label>
          <label class="wide">Home address
            <input name="address" maxlength="300" autocomplete="street-address">
          </label>
          <label>Emergency contact name
            <input name="emergency_contact_name" maxlength="120">
          </label>
          <label>Emergency contact phone
            <input name="emergency_contact_phone" maxlength="40">
          </label>
          <label>Identity document type
            <select name="id_type">
              <option value="">Not specified</option>
              <option value="Ghana Card">Ghana Card</option>
              <option value="Passport">Passport</option>
              <option value="National ID">National ID</option>
              <option value="Residence Permit">Residence Permit</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <label>ID / passport number
            <input name="id_number" maxlength="100" autocomplete="off">
          </label>
          <label>ID expiry date
            <input name="id_expiry_date" type="date">
          </label>
          <label>ID scan or passport copy (PDF/JPG/PNG/WEBP; max 10 MB)
            <input name="id_file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf">
          </label>
          <label>Job title / position
            <input name="position_title" maxlength="120" placeholder="e.g. Chef, Waiter, Cashier">
          </label>
          <label>Department
            <select name="department">
              <option value="">Not specified</option>
              <option value="Management">Management</option>
              <option value="Front of house">Front of house</option>
              <option value="Kitchen">Kitchen</option>
              <option value="Delivery">Delivery</option>
              <option value="Cleaning">Cleaning</option>
              <option value="Accounts">Accounts</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <label>System role
            <select name="role">
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
              <option value="cashier">Cashier</option>
              <option value="kitchen">Kitchen</option>
              <option value="delivery_rider">Delivery Rider</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <label>Employment type
            <select name="employment_type">
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="temporary">Temporary</option>
              <option value="casual">Casual</option>
              <option value="contract">Contract</option>
            </select>
          </label>
          <label>Employment status
            <select name="employment_status">
              <option value="active">Active</option>
              <option value="on_leave">On leave</option>
              <option value="suspended">Suspended</option>
              <option value="terminated">Terminated</option>
            </select>
          </label>
          <label>Start date
            <input name="start_date" type="date">
          </label>
          <label>End date (if applicable)
            <input name="end_date" type="date">
          </label>
          <label>Salary amount (GH₵)
            <input name="salary_amount" type="number" min="0" step="0.01">
          </label>
          <label>Salary frequency
            <select name="salary_frequency">
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="daily">Daily</option>
              <option value="hourly">Hourly</option>
            </select>
          </label>
          <label>Payment method
            <select name="payment_method">
              <option value="">Not specified</option>
              <option value="cash">Cash</option>
              <option value="mobile_money">Mobile Money</option>
              <option value="bank">Bank transfer</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>Contract / employment document (PDF/JPG/PNG/WEBP; max 10 MB)
            <input name="contract_file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf">
          </label>
          <label class="wide">Job duties / responsibilities
            <textarea name="job_description" rows="3" maxlength="3000"></textarea>
          </label>
          <label class="wide">Private notes
            <textarea name="notes" rows="3" maxlength="3000"></textarea>
          </label>
          <div class="wide" id="ops-staff-existing-files"></div>
          <div class="wide" style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" id="ops-staff-save" type="submit">Save employee</button>
            <button class="btn btn-light hidden" id="ops-staff-cancel" type="button">Cancel edit</button>
          </div>
        </form>
        <div class="ops-grid">
          <div class="ops-stat"><small>Total employee records</small><strong id="ops-staff-total">—</strong></div>
          <div class="ops-stat"><small>Active employees</small><strong id="ops-staff-active">—</strong></div>
          <div class="ops-stat"><small>Employment records needing review</small><strong id="ops-staff-review">—</strong></div>
        </div>
        <label style="display:flex;gap:8px;align-items:center;margin:10px 0">Search employees
          <input id="ops-staff-search" type="search" placeholder="Name, phone, ID or position" style="max-width:420px">
        </label>
        <div id="ops-staff-list" class="ops-table-wrap"></div>
      </section>

      <section id="ops-expenses" class="hidden">
        <h3>Expenses</h3>

        <form id="ops-expense-form" class="ops-form">
          <label>Date
            <input name="expense_date" type="date" required>
          </label>
          <label>Category
            <input name="category" required maxlength="80" placeholder="Rent, electricity, wages">
          </label>
          <label>Amount (GH₵)
            <input name="amount" type="number" min="0.01" step="0.01" required>
          </label>
          <label class="wide">Description
            <input name="description" required maxlength="250">
          </label>
          <label>Payment method
            <select name="payment_method">
              <option value="cash">Cash</option>
              <option value="mobile_money">Mobile Money</option>
              <option value="bank">Bank</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>Reference
            <input name="reference" maxlength="100">
          </label>
          <button class="btn btn-primary" type="submit">Record expense</button>
        </form>

        <div id="ops-expenses-list" class="ops-table-wrap"></div>
      </section>

      <section id="ops-shifts" class="hidden">
        <h3>Cash shifts</h3>

        <form id="ops-shift-open-form" class="ops-form">
          <label>Opening cash (GH₵)
            <input name="opening_cash" type="number" min="0" step="0.01" required value="0">
          </label>
          <label class="wide">Notes
            <input name="notes" maxlength="250">
          </label>
          <button class="btn btn-primary" type="submit">Open shift</button>
        </form>

        <p class="ops-note">
          Expected cash = opening cash + completed cash orders − recorded cash expenses − recorded cash payouts since shift opening.
          Mark orders Completed only after payment has been collected. Record till money-out in Cash payouts.
        </p>

        <div id="ops-shifts-list" class="ops-table-wrap"></div>
      </section>

      <section id="ops-purchases" class="hidden">
        <h3>Purchase orders</h3>
        <p class="ops-note">Create an order for a supplier, then use Receive stock only when the delivery physically arrives. Receiving updates the stock ledger once.</p>
        <form id="ops-purchase-form" class="ops-form">
          <label>Supplier
            <select name="supplier_id" id="ops-purchase-supplier">
              <option value="">No supplier selected</option>
            </select>
          </label>
          <label>Stock item
            <select name="item_id" id="ops-purchase-item" required></select>
          </label>
          <label>Quantity ordered
            <input name="quantity" type="number" min="0.001" step="0.001" required>
          </label>
          <label>Unit cost (GH₵)
            <input name="unit_cost" type="number" min="0" step="0.01" required>
          </label>
          <label>Reference / invoice
            <input name="reference" maxlength="100">
          </label>
          <label class="wide">Notes
            <input name="notes" maxlength="250">
          </label>
          <button class="btn btn-primary" type="submit">Create purchase order</button>
        </form>
        <div id="ops-purchases-list" class="ops-table-wrap"></div>
      </section>

      <section id="ops-payouts" class="hidden">
        <h3>Cash payouts / money out</h3>
        <p class="ops-note">Record cash withdrawn from the till separately from operating expenses. Cash payouts linked to an open shift are included when that shift is reconciled.</p>
        <form id="ops-payout-form" class="ops-form">
          <label>Date
            <input name="payout_date" type="date" required>
          </label>
          <label>Category
            <input name="category" maxlength="80" required placeholder="Small cash purchase, refund">
          </label>
          <label>Amount (GH₵)
            <input name="amount" type="number" min="0.01" step="0.01" required>
          </label>
          <label class="wide">Description
            <input name="description" maxlength="250" required>
          </label>
          <label>Payment method
            <select name="payment_method">
              <option value="cash">Cash from till</option>
              <option value="mobile_money">Mobile Money</option>
              <option value="bank">Bank</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>Open shift (cash only)
            <select name="shift_id" id="ops-payout-shift">
              <option value="">Not linked</option>
            </select>
          </label>
          <label>Reference
            <input name="reference" maxlength="100">
          </label>
          <button class="btn btn-primary" type="submit">Record payout</button>
        </form>
        <div id="ops-payouts-list" class="ops-table-wrap"></div>
      </section>

      <section id="ops-attendance" class="hidden">
        <h3>Staff attendance</h3>
        <p class="ops-note">Record clock-in and clock-out times. The system prevents the same staff member from having two open attendance records.</p>
        <form id="ops-attendance-form" class="ops-form">
          <label>Staff member
            <select name="staff_id" id="ops-attendance-staff" required></select>
          </label>
          <label>Notes (optional)
            <input name="notes" maxlength="250">
          </label>
          <button class="btn btn-primary" type="submit">Clock in</button>
        </form>
        <div id="ops-attendance-list" class="ops-table-wrap"></div>
      </section>

      <section id="ops-recipes" class="hidden">
        <h3>Menu recipes &amp; automatic stock usage</h3>
        <p class="ops-note">Map each menu item to its stock ingredients and the quantity used per portion. Use the same unit as inventory (for example, kg with kg). Ingredients are deducted when an order is marked Completed. Missing recipes are not auto-deducted, and an order will not complete if configured stock is insufficient.</p>
        <div id="ops-recipe-warning" class="app-message info"></div>
        <h4>Estimated ingredient cost and gross margin per portion</h4>
        <p class="ops-note">Estimate uses the current stock-item unit costs and the recipe quantities. It excludes labour, rent, utilities and other overhead.</p>
        <div id="ops-recipe-cost-summary" class="ops-table-wrap"></div>
        <form id="ops-recipe-form" class="ops-form">
          <label>Menu item
            <select name="menu_item_id" id="ops-recipe-menu" required></select>
          </label>
          <label>Stock ingredient
            <select name="inventory_item_id" id="ops-recipe-inventory" required></select>
          </label>
          <label>Quantity used per portion
            <input name="quantity_per_item" type="number" min="0.001" step="0.001" required>
          </label>
          <button class="btn btn-primary" type="submit">Add / update ingredient</button>
        </form>
        <div id="ops-recipes-list" class="ops-table-wrap"></div>
      </section>

      <section id="ops-reports" class="hidden">
        <h3>Sales and expense summary</h3>
        <p class="ops-note">Choose a date range to review completed sales, recorded expenses and cash payouts. This is not net profit because ingredient use, payroll and other unrecorded costs may be missing.</p>
        <form id="ops-report-form" class="ops-form">
          <label>From date
            <input name="from_date" type="date" required>
          </label>
          <label>To date
            <input name="to_date" type="date" required>
          </label>
          <button class="btn btn-primary" type="submit">Run report</button>
          <button id="ops-export-report" class="btn btn-light" type="button">Export report (CSV)</button>
        </form>
        <div id="ops-report-content"></div>
      </section>
    `;

    dashboard.appendChild(panel);

    button.addEventListener("click", () => showTab("operations"));

    document.querySelectorAll(".tab[data-tab]").forEach(tab => {
      tab.addEventListener("click", () => {
        if (tab.dataset.tab !== "operations") {
          showTab(tab.dataset.tab);
        }
      });
    });

    $("#ops-subtabs").addEventListener("click", event => {
      const btn = event.target.closest("[data-opstab]");
      if (!btn) return;

      $("#ops-subtabs").querySelectorAll(".tab").forEach(tab => {
        tab.classList.toggle("active", tab === btn);
      });

      ["inventory", "suppliers", "staff", "expenses", "shifts", "purchases", "payouts", "attendance", "recipes", "reports"].forEach(name => {
        $("#ops-" + name).classList.toggle("hidden", name !== btn.dataset.opstab);
      });

      if (btn.dataset.opstab === "reports") loadReports();
      if (btn.dataset.opstab === "purchases") loadPurchases();
      if (btn.dataset.opstab === "payouts") loadCashPayouts();
      if (btn.dataset.opstab === "attendance") loadAttendance();
      if (btn.dataset.opstab === "recipes") loadRecipes();
    });

    $("#ops-item-form").addEventListener("submit", addInventoryItem);
    $("#ops-movement-form").addEventListener("submit", saveMovement);
    $("#ops-inventory").addEventListener("click", onInventoryClick);
    $("#ops-supplier-form").addEventListener("submit", addSupplier);
    $("#ops-staff-form").addEventListener("submit", addStaff);
    $("#ops-staff-cancel").addEventListener("click", resetStaffForm);
    $("#ops-staff-search").addEventListener("input", () => { void renderStaffList().catch(showError); });
    $("#ops-expense-form").addEventListener("submit", addExpense);
    $("#ops-shift-open-form").addEventListener("submit", openShift);
    $("#ops-purchase-form").addEventListener("submit", createPurchaseOrder);
    $("#ops-payout-form").addEventListener("submit", addCashPayout);
    $("#ops-attendance-form").addEventListener("submit", clockIn);
    $("#ops-recipe-form").addEventListener("submit", saveRecipe);
    $("#ops-report-form").addEventListener("submit", event => {
      event.preventDefault();
      loadReports().catch(showError);
    });
    $("#ops-export-report").addEventListener("click", exportReport);
  }

  function showTab(name) {
    document.querySelectorAll(".tab[data-tab]").forEach(tab => {
      tab.classList.toggle("active", tab.dataset.tab === name);
    });

    $("#dashboard")?.classList.remove("hub-home");
    $("#admin-home")?.classList.add("hidden");
    $("#settings-hub")?.classList.add("hidden");

    ["orders", "history", "menu", "offers", "settings", "operations"].forEach(key => {
      const panel = $("#tab-" + key);
      if (panel) panel.classList.toggle("hidden", key !== name);
    });

    if (name === "operations") {
      if (typeof window.__alShamiMarkSettingsChild === "function") {
        window.__alShamiMarkSettingsChild();
      } else {
        const backButton = $("#back-to-home");
        if (backButton) {
          backButton.textContent = "← Settings";
          backButton.classList.remove("hidden");
        }
      }
      loadAll().catch(showError);
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function message(text, isError = false) {
    const element = $("#ops-message");
    if (!element) return;

    element.textContent = text;
    element.className = "status-message " + (isError ? "error" : "success");
  }

  function showError(error) {
    console.error("AL SHAMI Operations:", error);
    message(
      error?.message || "Operation failed. Check the migration and permissions.",
      true
    );
  }

  async function adminCheck() {
    const { data, error: sessionError } = await db.auth.getSession();
    if (sessionError) throw sessionError;
    if (!data.session) return false;

    const { data: allowed, error } = await db.rpc("is_current_user_admin");
    if (error) throw error;

    return Boolean(allowed);
  }

  async function loadAll() {
    if (loading) return;
    loading = true;

    try {
      if (!(await adminCheck())) {
        message("Sign in with an authorised admin account to use Operations.", true);
        return;
      }

      await Promise.all([
        loadInventory(),
        loadMovements(),
        loadSuppliers(),
        loadStaff(),
        loadExpenses(),
        loadShifts()
      ]);
      await Promise.all([loadPurchases(), loadCashPayouts(), loadAttendance(), loadRecipes()]);

      loaded = true;
      message("Operations data loaded.");
    } finally {
      loading = false;
    }
  }

  async function loadInventory() {
    const { data, error } = await db
      .from("inventory_items")
      .select("id,name,category,unit,quantity,reorder_level,unit_cost,is_active")
      .eq("is_active", true)
      .order("name");

    if (error) throw error;
    stockItems = data || [];
    renderInventory();
  }

  const stockCategoryDefaults = [
    {name:"Drinks", icon:"🥤"},
    {name:"Chicken", icon:"🍗"},
    {name:"Disposable", icon:"🍽️"},
    {name:"Other", icon:"📦"}
  ];
  const stockCategoryIcon = name =>
    stockCategoryDefaults.find(item => item.name.toLowerCase() === String(name).toLowerCase())?.icon || "📦";
  const stockQty = value => Number(value || 0).toLocaleString(undefined,{maximumFractionDigits:3});
  const stockCategoryKey = value => String(value || "Other").trim().toLowerCase();

  function renderInventory() {
    $("#ops-stock-count").textContent = stockItems.length;
    $("#ops-low-count").textContent = stockItems.filter(item =>
      Number(item.reorder_level || 0) > 0 && Number(item.quantity) <= Number(item.reorder_level)
    ).length;

    const categoryNames = [...stockCategoryDefaults.map(item => item.name)];
    const categorySeen = new Set(categoryNames.map(stockCategoryKey));
    stockItems.forEach(item => {
      const name = String(item.category || "Other").trim() || "Other";
      if (!categorySeen.has(stockCategoryKey(name))) {
        categoryNames.push(name);
        categorySeen.add(stockCategoryKey(name));
      }
    });
    $("#ops-stock-category-options").innerHTML = categoryNames.map(name =>
      '<option value="' + esc(name) + '"></option>'
    ).join("");
    $("#ops-inventory-categories").innerHTML = categoryNames.map(name => {
      const count = stockItems.filter(item => stockCategoryKey(item.category) === stockCategoryKey(name)).length;
      return '<button class="ops-stock-category' + (stockCategoryKey(name) === stockCategoryKey(selectedStockCategory) ? ' active' : '') +
        '" type="button" data-stock-category="' + esc(name) + '"><span class="ops-stock-category-icon" aria-hidden="true">' +
        stockCategoryIcon(name) + '</span><strong>' + esc(name) + '</strong><small>' + count + ' item' + (count === 1 ? '' : 's') + '</small></button>';
    }).join("");

    const currentItem = selectedStockItem && stockItems.find(item => item.id === selectedStockItem.id);
    if (currentItem) {
      selectedStockItem = currentItem;
      $("#ops-stock-catalog").hidden = true;
      $("#ops-stock-detail").hidden = false;
      $("#ops-stock-item-title").textContent = currentItem.name + " · " + currentItem.category;
      $("#ops-stock-current").textContent = stockQty(currentItem.quantity) + " " + currentItem.unit;
      const low = Number(currentItem.reorder_level || 0) > 0 && Number(currentItem.quantity) <= Number(currentItem.reorder_level);
      $("#ops-stock-low-label").textContent = low ? "Low stock · reorder at " + stockQty(currentItem.reorder_level) + " " + currentItem.unit : "";
      return;
    }

    selectedStockItem = null;
    $("#ops-stock-detail").hidden = true;
    $("#ops-stock-catalog").hidden = false;
    const list = $("#ops-stock-items");
    if (!selectedStockCategory) {
      list.innerHTML = '<p class="ops-stock-empty">Choose a category to see its items.</p>';
      return;
    }
    const items = stockItems.filter(item => stockCategoryKey(item.category) === stockCategoryKey(selectedStockCategory));
    list.innerHTML = '<h4>' + esc(selectedStockCategory) + '</h4>' +
      (items.length
        ? '<div class="ops-stock-item-grid">' + items.map(item =>
            '<button class="ops-stock-item-card" type="button" data-stock-item="' + esc(item.id) + '"><strong>' +
            esc(item.name) + '</strong><span>' + esc(stockQty(item.quantity)) + ' ' + esc(item.unit) + '</span></button>'
          ).join("") + '</div>'
        : '<p class="ops-stock-empty">No items in this category yet. Add the first one.</p>');
  }

  function onInventoryClick(event) {
    const categoryButton = event.target.closest("[data-stock-category]");
    if (categoryButton) {
      selectedStockCategory = categoryButton.dataset.stockCategory;
      selectedStockItem = null;
      $("#ops-item-form").hidden = true;
      $("#ops-movement-form").hidden = true;
      renderInventory();
      return;
    }
    if (event.target.closest("#ops-add-item-btn")) {
      $("#ops-item-form").hidden = false;
      $("#ops-item-form").elements.category.value = selectedStockCategory;
      $("#ops-item-form").elements.name.focus();
      return;
    }
    if (event.target.closest("#ops-cancel-item")) {
      $("#ops-item-form").reset();
      $("#ops-item-form").hidden = true;
      return;
    }
    if (event.target.closest("#ops-stock-back")) {
      selectedStockItem = null;
      $("#ops-movement-form").hidden = true;
      renderInventory();
      return;
    }
    if (event.target.closest("#ops-cancel-movement")) {
      $("#ops-movement-form").reset();
      $("#ops-movement-form").hidden = true;
      return;
    }
    const itemButton = event.target.closest("[data-stock-item]");
    if (itemButton) {
      selectedStockItem = stockItems.find(item => item.id === itemButton.dataset.stockItem) || null;
      $("#ops-movement-form").hidden = true;
      renderInventory();
      loadMovements().catch(showError);
      return;
    }
    const movementButton = event.target.closest("[data-stock-movement]");
    if (movementButton && selectedStockItem) {
      const form = $("#ops-movement-form");
      const kind = movementButton.dataset.stockMovement;
      form.reset();
      form.elements.item_id.value = selectedStockItem.id;
      form.elements.movement_type.value = kind;
      $("#ops-stock-entry-label").childNodes[0].textContent = kind === "purchase" ? "Quantity received " : "Quantity used / sold ";
      $("#ops-stock-cost-field").hidden = kind !== "purchase";
      form.hidden = false;
      form.elements.quantity_change.focus();
    }
  }

  async function addInventoryItem(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const openingQuantity = Number(data.get("quantity"));
    const category = String(data.get("category") || "").trim();
    const name = String(data.get("name") || "").trim();
    const unit = String(data.get("unit") || "").trim();

    if (!category || !name || !unit || !Number.isFinite(openingQuantity) || openingQuantity < 0) {
      message("Enter a category, item name, unit and valid starting stock.", true);
      return;
    }

    try {
      const { data: item, error } = await db.from("inventory_items").insert({
        name,
        category,
        unit,
        quantity: 0,
        reorder_level: 0,
        unit_cost: 0,
        supplier_id: null
      }).select().single();
      if (error) throw error;

      if (openingQuantity > 0) {
        const { error: movementError } = await db.rpc("record_inventory_movement", {
          p_item_id: item.id,
          p_movement_type: "opening",
          p_quantity_change: openingQuantity,
          p_unit_cost: 0,
          p_reference: "Opening stock",
          p_notes: "Initial quantity"
        });
        if (movementError) throw new Error("Item was saved, but starting stock was not recorded: " + movementError.message);
      }

      selectedStockCategory = category;
      selectedStockItem = null;
      form.reset();
      form.elements.unit.value = "pieces";
      form.hidden = true;
      message("Stock item saved.");
      await loadInventory();
      await loadMovements();
    } catch (error) {
      showError(error);
    }
  }

  async function saveMovement(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const movementType = String(data.get("movement_type") || "");
    const quantity = Number(data.get("quantity_change"));
    if (!data.get("item_id") || !["purchase","usage"].includes(movementType) || !Number.isFinite(quantity) || quantity <= 0) {
      message("Choose a stock item and enter a quantity greater than zero.", true);
      return;
    }

    try {
      const { error } = await db.rpc("record_inventory_movement", {
        p_item_id: data.get("item_id"),
        p_movement_type: movementType,
        p_quantity_change: movementType === "purchase" ? quantity : -quantity,
        p_unit_cost: Number(data.get("unit_cost") || 0),
        p_reference: null,
        p_notes: String(data.get("notes") || "").trim() || null
      });
      if (error) throw error;

      form.reset();
      form.hidden = true;
      message(movementType === "purchase" ? "Stock added." : "Stock used / sold.");
      await loadInventory();
      await loadMovements();
    } catch (error) {
      showError(error);
    }
  }

  async function loadMovements() {
    if (!selectedStockItem) return;
    const item = selectedStockItem;
    const { data, error } = await db.from("inventory_movements")
      .select("id,movement_type,quantity_change,created_at")
      .eq("item_id", item.id)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const movements = data || [];
    const totalChange = movements.reduce((sum, row) => sum + Number(row.quantity_change || 0), 0);
    let running = Number(item.quantity || 0) - totalChange;
    const days = new Map();
    for (const row of movements) {
      const dateKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit"
      }).format(new Date(row.created_at));
      if (!days.has(dateKey)) days.set(dateKey, {date:dateKey, opening:running, added:0, used:0, balance:running});
      const day = days.get(dateKey);
      const change = Number(row.quantity_change || 0);
      if (change > 0) day.added += change;
      if (change < 0) day.used += Math.abs(change);
      running += change;
      day.balance = running;
    }

    const dateLabel = dateKey => {
      const [year,month,day] = dateKey.split("-").map(Number);
      return new Intl.DateTimeFormat(undefined, {timeZone:"Africa/Accra",day:"numeric",month:"short",year:"numeric"})
        .format(new Date(Date.UTC(year,month-1,day,12)));
    };
    const rows = [...days.values()].reverse().map(day => [
      dateLabel(day.date), stockQty(day.opening) + " " + item.unit,
      "+" + stockQty(day.added) + " " + item.unit,
      "−" + stockQty(day.used) + " " + item.unit,
      stockQty(day.balance) + " " + item.unit
    ]);
    $("#ops-movements-list").innerHTML = rows.length
      ? table(["Date","Opening balance","Added","Used / sold","Balance left"], rows)
      : '<p class="ops-stock-empty">No stock entries yet. Your first entry will appear here with today’s date.</p>';
  }

  async function loadSuppliers() {
    const { data, error } = await db
      .from("suppliers")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (error) throw error;

    $("#ops-suppliers-list").innerHTML = table(
      ["Supplier", "Phone", "Email", "Address"],
      (data || []).map(supplier => [
        supplier.name,
        supplier.phone || "—",
        supplier.email || "—",
        supplier.address || "—"
      ])
    );

    const supplierSelect = $("#ops-item-supplier");
    if (supplierSelect) {
      supplierSelect.innerHTML = '<option value="">No supplier selected</option>' +
        (data || []).map(supplier =>
          '<option value="' + esc(supplier.id) + '">' + esc(supplier.name) + '</option>'
        ).join("");
    }
  }

  async function addSupplier(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const { error } = await db.from("suppliers").insert({
        name: String(data.get("name")).trim(),
        phone: String(data.get("phone") || "").trim() || null,
        email: String(data.get("email") || "").trim() || null,
        address: String(data.get("address") || "").trim() || null
      });

      if (error) throw error;

      form.reset();
      message("Supplier saved.");
      await loadSuppliers();
      await loadInventory();
    } catch (error) {
      showError(error);
    }
  }

  let staffCache = [];

  function staffText(value) {
    return String(value ?? "").trim() || null;
  }

  function staffDate(value) {
    return String(value || "").trim() || null;
  }

  async function staffSignedUrl(path) {
    if (!path) return null;
    const { data, error } = await db.storage.from("staff-private").createSignedUrl(path, 300);
    if (error) {
      console.warn("Could not create a temporary staff document link:", error.message);
      return null;
    }
    return data?.signedUrl || null;
  }

  async function loadStaff() {
    const { data, error } = await db
      .from("staff_profiles")
      .select("*")
      .order("full_name");
    if (error) throw error;
    staffCache = data || [];
    $("#ops-staff-total").textContent = staffCache.length;
    $("#ops-staff-active").textContent = staffCache.filter(person => person.employment_status === "active" && person.is_active).length;
    $("#ops-staff-review").textContent = staffCache.filter(person =>
      (person.id_expiry_date && person.id_expiry_date < localDateString()) ||
      (person.employment_status === "active" && !person.start_date) ||
      (person.employment_status === "terminated" && !person.end_date)
    ).length;
    await renderStaffList();
  }

  async function renderStaffList() {
    const query = String($("#ops-staff-search")?.value || "").trim().toLowerCase();
    const people = staffCache.filter(person => !query || [
      person.full_name, person.phone, person.id_number, person.position_title,
      person.department, person.role, person.email
    ].some(value => String(value || "").toLowerCase().includes(query)));

    const rows = await Promise.all(people.map(async person => {
      const photoUrl = await staffSignedUrl(person.photo_path);
      const idUrl = await staffSignedUrl(person.id_document_path);
      const contractUrl = await staffSignedUrl(person.contract_path);
      const photo = photoUrl
        ? '<img src="' + esc(photoUrl) + '" alt="Employee photo" style="width:42px;height:42px;object-fit:cover;border-radius:50%">'
        : '<span aria-label="No photo">—</span>';
      const files = [
        idUrl ? '<a href="' + esc(idUrl) + '" target="_blank" rel="noopener">ID document</a>' : "",
        contractUrl ? '<a href="' + esc(contractUrl) + '" target="_blank" rel="noopener">Contract</a>' : ""
      ].filter(Boolean).join(" · ") || "—";
      const statusLabels = {active:"Active",on_leave:"On leave",suspended:"Suspended",terminated:"Terminated"};
      return [
        {kind:"html",value:photo},
        person.full_name,
        person.position_title || person.role || "—",
        person.phone || "—",
        person.id_type ? person.id_type + ": " + (person.id_number || "number not entered") : (person.id_number || "—"),
        person.start_date || "—",
        person.salary_amount == null ? "—" : money(person.salary_amount) + " / " + (person.salary_frequency || "monthly"),
        statusLabels[person.employment_status] || person.employment_status || "Active",
        {kind:"html",value:files},
        {kind:"html",value:'<button type="button" class="btn btn-light" data-edit-staff="' + esc(person.id) + '">Open / edit</button>'}
      ];
    }));
    $("#ops-staff-list").innerHTML = table(
      ["Photo","Employee","Position","Phone","Identity","Start date","Salary","Status","Documents","Actions"],
      rows
    );
    $("#ops-staff-list").querySelectorAll("[data-edit-staff]").forEach(button => {
      button.addEventListener("click", () => editStaff(button.dataset.editStaff));
    });
  }

  async function uploadStaffFile(file, staffId, kind) {
    if (!file || !file.name) return null;
    if (file.size > 10 * 1024 * 1024) throw new Error("Each employee file must be 10 MB or smaller.");
    const allowed = ["image/jpeg","image/png","image/webp","application/pdf"];
    if (!allowed.includes(file.type)) throw new Error("Unsupported file type. Use JPG, PNG, WEBP or PDF.");
    if (kind === "photo" && file.type === "application/pdf") throw new Error("The employee photo must be an image.");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "document";
    const path = staffId + "/" + kind + "-" + Date.now() + "-" + safeName;
    const { error } = await db.storage.from("staff-private").upload(path, file, {
      upsert: false,
      contentType: file.type,
      cacheControl: "3600"
    });
    if (error) throw error;
    return path;
  }

  function setStaffFormValue(form, name, value) {
    const input = form.elements.namedItem(name);
    if (input && input.type !== "file") input.value = value == null ? "" : String(value);
  }

  async function editStaff(id) {
    const person = staffCache.find(item => item.id === id);
    if (!person) return;
    const form = $("#ops-staff-form");
    form.reset();
    Object.keys(person).forEach(key => setStaffFormValue(form, key, person[key]));
    form.elements.id.value = person.id;
    $("#ops-staff-save").textContent = "Update employee";
    $("#ops-staff-cancel").classList.remove("hidden");
    const links = [];
    const photoUrl = await staffSignedUrl(person.photo_path);
    const idUrl = await staffSignedUrl(person.id_document_path);
    const contractUrl = await staffSignedUrl(person.contract_path);
    if (photoUrl) links.push('<a href="' + esc(photoUrl) + '" target="_blank" rel="noopener">View current photo</a>');
    if (idUrl) links.push('<a href="' + esc(idUrl) + '" target="_blank" rel="noopener">View current ID document</a>');
    if (contractUrl) links.push('<a href="' + esc(contractUrl) + '" target="_blank" rel="noopener">View current contract</a>');
    $("#ops-staff-existing-files").innerHTML = links.length ? "<strong>Current files:</strong> " + links.join(" · ") + "<p class='ops-note'>Leave a file field empty to keep the current file.</p>" : "";
    $("#ops-staff-form").scrollIntoView({behavior:"smooth",block:"start"});
  }

  function resetStaffForm() {
    const form = $("#ops-staff-form");
    form.reset();
    form.elements.id.value = "";
    $("#ops-staff-save").textContent = "Save employee";
    $("#ops-staff-cancel").classList.add("hidden");
    $("#ops-staff-existing-files").textContent = "";
  }

  async function addStaff(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const staffId = String(data.get("id") || "").trim();
    const employmentStatus = String(data.get("employment_status") || "active");
    const payload = {
      full_name: String(data.get("full_name") || "").trim(),
      phone: staffText(data.get("phone")),
      email: staffText(data.get("email")),
      user_id: staffText(data.get("user_id")),
      date_of_birth: staffDate(data.get("date_of_birth")),
      nationality: staffText(data.get("nationality")),
      address: staffText(data.get("address")),
      emergency_contact_name: staffText(data.get("emergency_contact_name")),
      emergency_contact_phone: staffText(data.get("emergency_contact_phone")),
      id_type: staffText(data.get("id_type")),
      id_number: staffText(data.get("id_number")),
      id_expiry_date: staffDate(data.get("id_expiry_date")),
      position_title: staffText(data.get("position_title")),
      department: staffText(data.get("department")),
      role: String(data.get("role") || "staff"),
      employment_type: String(data.get("employment_type") || "full_time"),
      employment_status: employmentStatus,
      is_active: employmentStatus !== "terminated",
      start_date: staffDate(data.get("start_date")),
      end_date: staffDate(data.get("end_date")),
      salary_amount: data.get("salary_amount") === "" ? null : Number(data.get("salary_amount")),
      salary_frequency: String(data.get("salary_frequency") || "monthly"),
      payment_method: staffText(data.get("payment_method")),
      job_description: staffText(data.get("job_description")),
      notes: staffText(data.get("notes"))
    };

    if (!payload.full_name) {
      message("Employee full name is required.", true);
      return;
    }
    if (payload.user_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.user_id)) {
      message("Auth user UUID must be a valid UUID from Supabase Authentication.", true);
      return;
    }
    if (payload.salary_amount !== null && (!Number.isFinite(payload.salary_amount) || payload.salary_amount < 0)) {
      message("Salary must be zero or a positive number.", true);
      return;
    }
    if (payload.end_date && payload.start_date && payload.end_date < payload.start_date) {
      message("End date cannot be before start date.", true);
      return;
    }

    const saveButton = $("#ops-staff-save");
    saveButton.disabled = true;
    const originalLabel = saveButton.textContent;
    saveButton.textContent = "Saving…";
    let createdId = staffId;
    try {
      if (staffId) {
        const { error } = await db.from("staff_profiles").update(payload).eq("id", staffId);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await db.from("staff_profiles").insert(payload).select("id").single();
        if (error) throw error;
        createdId = inserted.id;
      }

      const fileUpdates = {};
      const photo = data.get("photo_file");
      const idFile = data.get("id_file");
      const contract = data.get("contract_file");
      if (photo && photo.size) fileUpdates.photo_path = await uploadStaffFile(photo, createdId, "photo");
      if (idFile && idFile.size) fileUpdates.id_document_path = await uploadStaffFile(idFile, createdId, "identity");
      if (contract && contract.size) fileUpdates.contract_path = await uploadStaffFile(contract, createdId, "contract");
      if (Object.keys(fileUpdates).length) {
        const { error } = await db.from("staff_profiles").update(fileUpdates).eq("id", createdId);
        if (error) throw error;
      }

      resetStaffForm();
      message(staffId ? "Employee record updated." : "Employee record saved.");
      await loadStaff();
    } catch (error) {
      showError(error);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = staffId ? "Update employee" : originalLabel;
    }
  }

  function localDateString() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async function loadExpenses() {
    const today = localDateString();
    const dateInput = $("#ops-expense-form").elements.expense_date;
    if (!dateInput.value) dateInput.value = today;

    const { data, error } = await db
      .from("expenses")
      .select("*")
      .eq("expense_date", today)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const expenses = data || [];

    $("#ops-expenses-today").textContent = money(
      expenses.reduce((sum, item) => sum + Number(item.amount), 0)
    );

    $("#ops-expenses-list").innerHTML = table(
      ["Date", "Category", "Description", "Amount", "Method"],
      expenses.map(item => [
        item.expense_date,
        item.category,
        item.description,
        money(item.amount),
        item.payment_method
      ])
    );
  }

  async function addExpense(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const { error } = await db.rpc("record_expense", {
        p_category: String(data.get("category")).trim(),
        p_description: String(data.get("description")).trim(),
        p_amount: Number(data.get("amount")),
        p_expense_date: data.get("expense_date"),
        p_payment_method: data.get("payment_method"),
        p_reference: String(data.get("reference") || "").trim() || null
      });

      if (error) throw error;

      form.reset();
      form.elements.expense_date.value = localDateString();

      message("Expense recorded.");
      await loadExpenses();
    } catch (error) {
      showError(error);
    }
  }

  async function loadShifts() {
    const { data, error } = await db
      .from("cash_shifts")
      .select("*")
      .order("opened_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    $("#ops-shifts-list").innerHTML = table(
      ["Opened", "Status", "Opening cash", "Expected cash", "Counted cash", "Difference", "Action"],
      (data || []).map(shift => [
        new Date(shift.opened_at).toLocaleString(),
        shift.status,
        money(shift.opening_cash),
        shift.expected_cash == null ? "—" : money(shift.expected_cash),
        shift.counted_cash == null ? "—" : money(shift.counted_cash),
        shift.difference == null ? "—" : money(shift.difference),
        shift.status === "open"
          ? { kind: "html", value: `<button class="btn btn-light" data-close-shift="${esc(shift.id)}">Close shift</button>` }
          : "Closed"
      ])
    );

    const hasOpenShift = (data || []).some(shift => shift.status === "open");
    const openButton = $("#ops-shift-open-form").querySelector('button[type="submit"]');
    openButton.disabled = hasOpenShift;
    openButton.textContent = hasOpenShift ? "A shift is already open" : "Open shift";

    $("#ops-shifts-list")
      .querySelectorAll("[data-close-shift]")
      .forEach(button => {
        button.addEventListener("click", () => closeShift(button.dataset.closeShift));
      });
  }

  async function openShift(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const { data: userData, error: userError } = await db.auth.getUser();
      if (userError) throw userError;

      const { error } = await db.from("cash_shifts").insert({
        opened_by: userData.user?.id,
        opening_cash: Number(data.get("opening_cash")),
        notes: String(data.get("notes") || "").trim() || null
      });

      if (error) throw error;

      form.reset();
      message("Cash shift opened.");
      await loadShifts();
    } catch (error) {
      showError(error);
    }
  }

  async function closeShift(id) {
    const raw = prompt("Enter the actual cash counted in GH₵:");
    if (raw === null) return;

    const counted = Number(raw);

    if (!Number.isFinite(counted) || counted < 0) {
      message("Enter a valid non-negative amount.", true);
      return;
    }

    const notes = prompt("Closing notes (optional):") || null;

    try {
      const { error } = await db.rpc("close_cash_shift", {
        p_shift_id: id,
        p_counted_cash: counted,
        p_notes: notes
      });

      if (error) throw error;

      message("Cash shift closed.");
      await loadShifts();
    } catch (error) {
      showError(error);
    }
  }

  async function loadPurchases() {
    const [ordersResult, suppliersResult, itemsResult] = await Promise.all([
      db.from("purchase_orders")
        .select("*,suppliers(name),purchase_order_items(*,inventory_items(name,unit))")
        .order("created_at", { ascending: false }).limit(50),
      db.from("suppliers").select("id,name").eq("is_active", true).order("name"),
      db.from("inventory_items").select("id,name,unit").eq("is_active", true).order("name")
    ]);
    if (ordersResult.error) throw ordersResult.error;
    if (suppliersResult.error) throw suppliersResult.error;
    if (itemsResult.error) throw itemsResult.error;

    const supplierSelect = $("#ops-purchase-supplier");
    if (supplierSelect) supplierSelect.innerHTML = '<option value="">No supplier selected</option>' +
      (suppliersResult.data || []).map(item => '<option value="' + esc(item.id) + '">' + esc(item.name) + '</option>').join("");

    const itemSelect = $("#ops-purchase-item");
    if (itemSelect) itemSelect.innerHTML = (itemsResult.data || []).map(item =>
      '<option value="' + esc(item.id) + '">' + esc(item.name) + ' (' + esc(item.unit) + ')</option>'
    ).join("") || '<option value="">Add a stock item first</option>';

    $("#ops-purchases-list").innerHTML = table(
      ["Created", "Reference", "Supplier", "Items", "Total", "Status", "Action"],
      (ordersResult.data || []).map(order => {
        const lines = order.purchase_order_items || [];
        const label = lines.map(line =>
          (line.inventory_items?.name || "Stock item") + " — " + line.quantity + " " +
          (line.inventory_items?.unit || "") + " @ " + money(line.unit_cost)
        ).join("; ") || "No items";
        const total = lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_cost), 0);
        const action = order.status === "ordered"
          ? {kind:"html", value:'<button class="btn btn-primary" data-receive-purchase="' + esc(order.id) + '">Receive stock</button>'}
          : order.status === "draft" ? "Incomplete draft" : order.status;
        return [new Date(order.created_at).toLocaleString(), order.reference || "—",
          order.suppliers?.name || "—", label, money(total), order.status, action];
      })
    );
    $("#ops-purchases-list").querySelectorAll("[data-receive-purchase]").forEach(button => {
      button.addEventListener("click", async () => {
        if (!confirm("Confirm the supplier delivered these quantities? Stock will be increased and recorded once.")) return;
        button.disabled = true;
        try {
          const { error } = await db.rpc("receive_purchase_order", {p_purchase_order_id:button.dataset.receivePurchase});
          if (error) throw error;
          message("Purchase received and inventory updated.");
          await Promise.all([loadPurchases(), loadInventory(), loadMovements()]);
        } catch (error) {
          showError(error);
          button.disabled = false;
        }
      });
    });
  }

  async function createPurchaseOrder(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const quantity = Number(data.get("quantity"));
    const unitCost = Number(data.get("unit_cost"));
    if (!data.get("item_id") || !Number.isFinite(quantity) || quantity <= 0 ||
        !Number.isFinite(unitCost) || unitCost < 0) {
      message("Choose a stock item, enter a positive quantity and a valid unit cost.", true);
      return;
    }
    try {
      const {data:userData,error:userError}=await db.auth.getUser();
      if(userError) throw userError;
      const {data:order,error:orderError}=await db.from("purchase_orders").insert({
        supplier_id:String(data.get("supplier_id")||"").trim()||null,
        status:"draft",
        reference:String(data.get("reference")||"").trim()||null,
        notes:String(data.get("notes")||"").trim()||null,
        created_by:userData.user?.id||null
      }).select().single();
      if(orderError) throw orderError;
      const {error:itemError}=await db.from("purchase_order_items").insert({
        purchase_order_id:order.id,
        item_id:String(data.get("item_id")),
        quantity,
        unit_cost:unitCost
      });
      if(itemError) throw itemError;
      const {error:updateError}=await db.from("purchase_orders").update({
        status:"ordered",ordered_at:new Date().toISOString(),updated_at:new Date().toISOString()
      }).eq("id",order.id);
      if(updateError) throw updateError;
      form.reset();
      message("Purchase order created. Receive it only after delivery arrives.");
      await loadPurchases();
    } catch(error) {
      showError(error);
    }
  }

  async function loadCashPayouts() {
    const date = localDateString();
    const form = $("#ops-payout-form");
    if (form && !form.elements.payout_date.value) form.elements.payout_date.value = date;
    const [payoutResult,shiftResult] = await Promise.all([
      db.from("cash_payouts").select("*").eq("payout_date",date).order("created_at",{ascending:false}).limit(100),
      db.from("cash_shifts").select("id,opened_at,opening_cash").eq("status","open").order("opened_at",{ascending:false})
    ]);
    if(payoutResult.error) throw payoutResult.error;
    if(shiftResult.error) throw shiftResult.error;
    const select=$("#ops-payout-shift");
    if(select) select.innerHTML='<option value="">Not linked</option>'+(shiftResult.data||[]).map(shift=>
      '<option value="'+esc(shift.id)+'">Opened '+esc(new Date(shift.opened_at).toLocaleString())+'</option>'
    ).join("");
    $("#ops-payouts-list").innerHTML=table(
      ["Date","Category","Description","Amount","Method","Reference"],
      (payoutResult.data||[]).map(item=>[
        item.payout_date,item.category,item.description,money(item.amount),item.payment_method,item.reference||"—"
      ])
    );
  }

  async function addCashPayout(event) {
    event.preventDefault();
    const form=event.currentTarget;
    const data=new FormData(form);
    const method=String(data.get("payment_method")||"cash");
    try {
      const {error}=await db.rpc("record_cash_payout",{
        p_category:String(data.get("category")||"").trim(),
        p_description:String(data.get("description")||"").trim(),
        p_amount:Number(data.get("amount")),
        p_payment_method:method,
        p_payout_date:data.get("payout_date")||localDateString(),
        p_reference:String(data.get("reference")||"").trim()||null,
        p_shift_id:method==="cash"?(String(data.get("shift_id")||"").trim()||null):null
      });
      if(error) throw error;
      form.reset();
      form.elements.payout_date.value=localDateString();
      message("Cash payout recorded.");
      await Promise.all([loadCashPayouts(),loadExpenses(),loadShifts()]);
    }catch(error){showError(error);}
  }

  async function loadAttendance() {
    const date=localDateString();
    const [staffResult,attendanceResult]=await Promise.all([
      db.from("staff_profiles").select("id,full_name").eq("is_active",true).order("full_name"),
      db.from("staff_attendance").select("*,staff_profiles(full_name,role)").or("work_date.eq."+date+",check_out_at.is.null").order("check_in_at",{ascending:false}).limit(100)
    ]);
    if(staffResult.error) throw staffResult.error;
    if(attendanceResult.error) throw attendanceResult.error;
    const openStaffIds=new Set((attendanceResult.data||[]).filter(record=>!record.check_out_at).map(record=>record.staff_id));
    const eligibleStaff=(staffResult.data||[]).filter(person=>!openStaffIds.has(person.id));
    const select=$("#ops-attendance-staff");
    if(select) select.innerHTML=eligibleStaff.map(person=>'<option value="'+esc(person.id)+'">'+esc(person.full_name)+'</option>').join("")||
      '<option value="">'+((staffResult.data||[]).length?'All staff are currently clocked in':'Add staff first')+'</option>';
    $("#ops-attendance-form").querySelector('button[type="submit"]').disabled=!eligibleStaff.length;
    $("#ops-attendance-list").innerHTML=table(
      ["Work date","Staff","Role","Clock in","Clock out","Hours","Action"],
      (attendanceResult.data||[]).map(record=>{
        const elapsed=((record.check_out_at?new Date(record.check_out_at):new Date())-new Date(record.check_in_at))/3600000;
        const hours=Math.max(0,elapsed);
        const action=record.check_out_at?"Finished":{kind:"html",value:'<button class="btn btn-light" data-clock-out="'+esc(record.id)+'">Clock out</button>'};
        return [record.work_date,record.staff_profiles?.full_name||"Staff",record.staff_profiles?.role||"—",
          new Date(record.check_in_at).toLocaleTimeString(),record.check_out_at?new Date(record.check_out_at).toLocaleTimeString():"On duty",
          hours.toFixed(2),action];
      })
    );
    $("#ops-attendance-list").querySelectorAll("[data-clock-out]").forEach(button=>{
      button.addEventListener("click",async()=>{
        button.disabled=true;
        try{
          const {data:userData,error:userError}=await db.auth.getUser();
          if(userError) throw userError;
          const {error}=await db.from("staff_attendance").update({
            check_out_at:new Date().toISOString(),check_out_by:userData.user?.id||null
          }).eq("id",button.dataset.clockOut).is("check_out_at",null);
          if(error) throw error;
          message("Staff clock-out recorded.");
          await loadAttendance();
        }catch(error){showError(error);button.disabled=false;}
      });
    });
  }

  async function clockIn(event) {
    event.preventDefault();
    const form=event.currentTarget;
    const data=new FormData(form);
    if(!data.get("staff_id")){message("Select a staff member first.",true);return;}
    try{
      const {data:userData,error:userError}=await db.auth.getUser();
      if(userError) throw userError;
      const {error}=await db.from("staff_attendance").insert({
        staff_id:String(data.get("staff_id")),
        check_in_by:userData.user?.id||null,
        notes:String(data.get("notes")||"").trim()||null
      });
      if(error) throw error;
      form.elements.notes.value="";
      message("Staff clock-in recorded.");
      await loadAttendance();
    }catch(error){showError(error);}
  }

  async function loadRecipes() {
    const [menuResult, inventoryResult, recipesResult] = await Promise.all([
      db.from("menu_items").select("id,name,price").order("name"),
      db.from("inventory_items").select("id,name,unit,quantity,unit_cost").eq("is_active",true).order("name"),
      db.from("menu_item_recipes").select("*,menu_items(name,price),inventory_items(name,unit,unit_cost)")
        .order("created_at",{ascending:false})
    ]);
    if(menuResult.error) throw menuResult.error;
    if(inventoryResult.error) throw inventoryResult.error;
    if(recipesResult.error) throw recipesResult.error;

    const menus=menuResult.data||[];
    const inventory=inventoryResult.data||[];
    const recipes=recipesResult.data||[];
    $("#ops-recipe-menu").innerHTML=menus.map(item=>'<option value="'+esc(item.id)+'">'+esc(item.name)+'</option>').join("")||'<option value="">Add menu items first</option>';
    $("#ops-recipe-inventory").innerHTML=inventory.map(item=>'<option value="'+esc(item.id)+'">'+esc(item.name)+' ('+esc(item.unit)+')</option>').join("")||'<option value="">Add stock items first</option>';

    const configured=new Set(recipes.map(recipe=>recipe.menu_item_id));
    const missing=menus.filter(item=>!configured.has(item.id));
    $("#ops-recipe-cost-summary").innerHTML=table(
      ["Menu item","Selling price","Estimated ingredients / portion","Gross margin before overhead","Ingredient cost %"],
      menus.filter(item=>configured.has(item.id)).map(item=>{
        const ownRecipes=recipes.filter(recipe=>recipe.menu_item_id===item.id);
        const ingredientCost=ownRecipes.reduce((sum,recipe)=>{
          const unitCost=Number(recipe.inventory_items?.unit_cost||0);
          return sum+Number(recipe.quantity_per_item)*unitCost;
        },0);
        const price=Number(item.price||0);
        const margin=price-ingredientCost;
        const percent=price>0?(ingredientCost/price*100):0;
        return [item.name,money(price),money(ingredientCost),money(margin),percent.toFixed(1)+"%"];
      })
    );
    const warning=$("#ops-recipe-warning");
    warning.textContent=missing.length
      ? missing.length+' menu item(s) have no recipe; stock will not be deducted for those items until at least one ingredient is mapped: '+missing.map(item=>item.name).join(", ")
      : 'All menu items have at least one ingredient mapping.';
    warning.className=missing.length?'app-message info':'app-message info';

    $("#ops-recipes-list").innerHTML=table(
      ["Menu item","Ingredient","Quantity per portion","Current stock","Action"],
      recipes.map(recipe=>[
        recipe.menu_items?.name||"Menu item",
        (recipe.inventory_items?.name||"Stock item")+' ('+(recipe.inventory_items?.unit||"")+')',
        recipe.quantity_per_item,
        inventory.find(item=>item.id===recipe.inventory_item_id)?.quantity ?? "—",
        {kind:"html",value:'<button class="btn btn-light" data-delete-recipe="'+esc(recipe.id)+'">Remove</button>'}
      ])
    );
    $("#ops-recipes-list").querySelectorAll("[data-delete-recipe]").forEach(button=>{
      button.addEventListener("click",async()=>{
        if(!confirm("Remove this recipe ingredient mapping? Past stock movement history will remain unchanged.")) return;
        button.disabled=true;
        try{
          const {error}=await db.from("menu_item_recipes").delete().eq("id",button.dataset.deleteRecipe);
          if(error) throw error;
          message("Recipe ingredient removed.");
          await loadRecipes();
        }catch(error){showError(error);button.disabled=false;}
      });
    });
  }

  async function saveRecipe(event) {
    event.preventDefault();
    const form=event.currentTarget;
    const data=new FormData(form);
    const amount=Number(data.get("quantity_per_item"));
    if(!data.get("menu_item_id")||!data.get("inventory_item_id")||!Number.isFinite(amount)||amount<=0){
      message("Choose a menu item and ingredient, with a positive quantity.",true);
      return;
    }
    try{
      const {error}=await db.from("menu_item_recipes").upsert({
        menu_item_id:String(data.get("menu_item_id")),
        inventory_item_id:String(data.get("inventory_item_id")),
        quantity_per_item:amount,
        updated_at:new Date().toISOString()
      },{onConflict:"menu_item_id,inventory_item_id"});
      if(error) throw error;
      form.elements.quantity_per_item.value="";
      message("Recipe ingredient saved.");
      await loadRecipes();
    }catch(error){showError(error);}
  }

  async function loadReports() {
    try {
      const today=localDateString();
      const form=$("#ops-report-form");
      if(!form.elements.from_date.value) form.elements.from_date.value=today;
      if(!form.elements.to_date.value) form.elements.to_date.value=today;
      const fromDate=form.elements.from_date.value;
      const toDate=form.elements.to_date.value;
      if(!fromDate||!toDate||fromDate>toDate) throw new Error("Choose a valid date range.");

      const start=new Date(fromDate+"T00:00:00");
      const end=new Date(toDate+"T00:00:00");
      end.setDate(end.getDate()+1);
      const startISO=start.toISOString();
      const endExclusive=end.toISOString();

      const [
        {data:orders,error:ordersError},
        {data:completedOrders,error:completedOrdersError},
        {data:expenses,error:expensesError},
        {data:payouts,error:payoutsError}
      ]=await Promise.all([
        db.from("orders").select("id,order_number,customer_name,customer_phone,total,status,created_at")
          .gte("created_at",startISO).lt("created_at",endExclusive).order("created_at",{ascending:false}),
        db.from("orders").select("id,order_number,total,status,completed_at,order_items(id,menu_item_id,item_name,quantity,unit_price)")
          .eq("status","completed").gte("completed_at",startISO).lt("completed_at",endExclusive),
        db.from("expenses").select("expense_date,category,description,amount,payment_method,reference")
          .gte("expense_date",fromDate).lte("expense_date",toDate).order("expense_date",{ascending:false}),
        db.from("cash_payouts").select("payout_date,category,description,amount,payment_method,reference")
          .gte("payout_date",fromDate).lte("payout_date",toDate).order("payout_date",{ascending:false})
      ]);
      if(ordersError) throw ordersError;
      if(completedOrdersError) throw completedOrdersError;
      if(expensesError) throw expensesError;
      if(payoutsError) throw payoutsError;

      const allOrderItems=(completedOrders||[]).flatMap(order=>order.order_items||[]);
      const orderItemIds=allOrderItems.map(item=>item.id).filter(Boolean);
      let deductions=[];
      let movementCosts=[];
      if(orderItemIds.length){
        const {data:deductionData,error:deductionError}=await db.from("order_inventory_deductions")
          .select("order_item_id,inventory_item_id,quantity_deducted,stock_movement_id")
          .in("order_item_id",orderItemIds);
        if(deductionError) throw deductionError;
        deductions=deductionData||[];
        const movementIds=[...new Set(deductions.map(item=>item.stock_movement_id).filter(Boolean))];
        if(movementIds.length){
          const {data:movementData,error:movementError}=await db.from("inventory_movements")
            .select("id,unit_cost").in("id",movementIds);
          if(movementError) throw movementError;
          movementCosts=movementData||[];
        }
      }

      const unitCostByMovement=new Map(movementCosts.map(item=>[item.id,Number(item.unit_cost||0)]));
      const costByOrderItem=new Map();
      const deductedOrderItemIds=new Set();
      deductions.forEach(item=>{
        deductedOrderItemIds.add(item.order_item_id);
        const cost=Number(item.quantity_deducted||0)*unitCostByMovement.get(item.stock_movement_id);
        costByOrderItem.set(item.order_item_id,(costByOrderItem.get(item.order_item_id)||0)+(Number.isFinite(cost)?cost:0));
      });

      const completedSales=(completedOrders||[]).reduce((sum,order)=>sum+Number(order.total),0);
      const ingredientCost=allOrderItems.reduce((sum,item)=>sum+(costByOrderItem.get(item.id)||0),0);
      const unmappedLines=allOrderItems.filter(item=>item.menu_item_id&&!deductedOrderItemIds.has(item.id)).length;
      const expenseTotal=(expenses||[]).reduce((sum,item)=>sum+Number(item.amount),0);
      const payoutTotal=(payouts||[]).reduce((sum,item)=>sum+Number(item.amount),0);
      const estimatedResult=completedSales-ingredientCost-expenseTotal;

      lastReportRows=[
        ["Type","Date","Order / Reference","Customer / Category","Description","Method","Amount (GH₵)","Status"],
        ...(completedOrders||[]).map(order=>[
          "Completed sale",order.completed_at?new Date(order.completed_at).toISOString():"",
          order.order_number||order.id,"Customer order",
          (order.order_items||[]).map(item=>Number(item.quantity)+" x "+(item.item_name||"Menu item")).join("; "),
          "cash",Number(order.total),order.status
        ]),
        ["Estimated recipe ingredient cost",fromDate+" to "+toDate,"","Inventory stock ledger","Cost of ingredients deducted from completed orders","",Number(ingredientCost),"Estimate"],
        ...(expenses||[]).map(item=>[
          "Operating expense",item.expense_date,item.reference||"",item.category,item.description,
          item.payment_method,Number(item.amount),"Recorded"
        ]),
        ...(payouts||[]).map(item=>[
          "Cash payout",item.payout_date,item.reference||"",item.category,item.description,
          item.payment_method,Number(item.amount),"Recorded separately"
        ])
      ];

      $("#ops-report-content").innerHTML=
        '<div class="ops-grid">'+
          '<div class="ops-stat"><small>Orders placed in range</small><strong>'+(orders||[]).length+'</strong></div>'+
          '<div class="ops-stat"><small>Completed sales</small><strong>'+money(completedSales)+'</strong></div>'+
          '<div class="ops-stat"><small>Estimated recipe ingredient cost</small><strong>'+money(ingredientCost)+'</strong></div>'+
          '<div class="ops-stat"><small>Recorded operating expenses</small><strong>'+money(expenseTotal)+'</strong></div>'+
          '<div class="ops-stat"><small>Cash payouts (separate)</small><strong>'+money(payoutTotal)+'</strong></div>'+
        '</div>'+
        '<p><strong>Estimated result after mapped ingredient cost and recorded expenses:</strong> '+money(estimatedResult)+'</p>'+
        '<p class="ops-note">This estimate excludes menu lines without recorded recipe deductions, unrecorded payroll/overhead, and any costs entered incompletely. '+unmappedLines+' completed order line(s) in this period have no recipe deduction ledger entry.</p>'+
        '<p class="ops-note">Payouts are shown separately and are not subtracted from the estimated result because they may be transfers/drawings or already recorded in expenses. Sales are grouped by completion time; expenses and payouts use their entered dates.</p>'+
        '<p class="ops-note">Report period: '+esc(fromDate)+' through '+esc(toDate)+'.</p>';
    } catch(error) {
      showError(error);
    }
  }

  function exportReport() {
    if(lastReportRows.length<2) {
      message("Run a report with data before exporting.",true);
      return;
    }
    const quote=value=>'"'+String(value??"").replace(/"/g,'""')+'"';
    const csv="\uFEFF"+lastReportRows.map(row=>row.map(quote).join(",")).join("\r\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));
    const link=document.createElement("a");
    link.href=url;
    link.download="al-shami-operations-report-"+localDateString()+".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    message("Report exported.");
  }

  function table(headers, rows) {
    if (!rows.length) return '<p class="muted">No records yet.</p>';

    return `
      <table class="ops-table">
        <thead>
          <tr>${headers.map(header => `<th>${esc(header)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              ${row.map(cell => `
                <td>${cell && typeof cell === "object" && cell.kind === "html" ? cell.value : esc(cell)}</td>
              `).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function init() {
    addStyles();
    addPanel();

    const dashboard = $("#dashboard");
    if (!dashboard) return;

    const observer = new MutationObserver(() => {
      if (!dashboard.classList.contains("hidden") && !loaded) {
        loadAll().catch(showError);
      }
    });

    observer.observe(dashboard, {
      attributes: true,
      attributeFilter: ["class"]
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();