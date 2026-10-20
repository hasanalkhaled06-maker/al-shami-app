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

  const db = window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_ANON_KEY,
    {
      auth: {
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
      .ops-note {
        font-size: 12px;
        color: #766d6c;
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

      <div class="admin-tabs" id="ops-subtabs">
        <button class="tab active" data-opstab="inventory" type="button">Inventory</button>
        <button class="tab" data-opstab="suppliers" type="button">Suppliers</button>
        <button class="tab" data-opstab="staff" type="button">Staff</button>
        <button class="tab" data-opstab="expenses" type="button">Expenses</button>
        <button class="tab" data-opstab="shifts" type="button">Cash shifts</button>
        <button class="tab" data-opstab="purchases" type="button">Purchases</button>
        <button class="tab" data-opstab="payouts" type="button">Cash payouts</button>
        <button class="tab" data-opstab="attendance" type="button">Attendance</button>
        <button class="tab" data-opstab="recipes" type="button">Recipes &amp; food cost</button>
        <button class="tab" data-opstab="reports" type="button">Reports</button>
      </div>

      <div id="ops-message" class="status-message" role="status"></div>

      <section id="ops-inventory">
        <h3>Inventory</h3>

        <form id="ops-item-form" class="ops-form">
          <label>Item name
            <input name="name" required maxlength="120">
          </label>
          <label>Unit
            <input name="unit" required value="kg" maxlength="20">
          </label>
          <label>Opening quantity
            <input name="quantity" type="number" min="0" step="0.001" required value="0">
          </label>
          <label>Reorder level
            <input name="reorder_level" type="number" min="0" step="0.001" required value="0">
          </label>
          <label>Unit cost (GH₵)
            <input name="unit_cost" type="number" min="0" step="0.01" required value="0">
          </label>
          <label>Supplier (optional)
            <select name="supplier_id" id="ops-item-supplier">
              <option value="">No supplier selected</option>
            </select>
          </label>
          <label>Notes
            <input name="notes" maxlength="250">
          </label>
          <button class="btn btn-primary" type="submit">Add stock item</button>
        </form>

        <form id="ops-movement-form" class="ops-form">
          <label>Stock item
            <select name="item_id" id="ops-item-select" required></select>
          </label>
          <label>Movement
            <select name="movement_type">
              <option value="purchase">Purchase / add stock</option>
              <option value="usage">Usage / reduce stock</option>
              <option value="waste">Waste / reduce stock</option>
              <option value="adjustment">Adjustment (signed quantity)</option>
            </select>
          </label>
          <label>Quantity change
            <input name="quantity_change" type="number" step="0.001" required placeholder="Negative to reduce">
          </label>
          <label>Unit cost (GH₵)
            <input name="unit_cost" type="number" min="0" step="0.01" value="0">
          </label>
          <label>Reference
            <input name="reference" maxlength="100" placeholder="Receipt / invoice">
          </label>
          <label>Notes
            <input name="notes" maxlength="250">
          </label>
          <button class="btn btn-primary" type="submit">Save stock movement</button>
        </form>

        <div id="ops-inventory-list" class="ops-table-wrap"></div>
        <h3>Recent stock movements</h3>
        <div id="ops-movements-list" class="ops-table-wrap"></div>
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
        <h3>Staff roster</h3>
        <p class="ops-note">This is a staff contact/role register. It does not create login accounts or change account permissions.</p>
        <form id="ops-staff-form" class="ops-form">
          <label>Full name
            <input name="full_name" required maxlength="120">
          </label>
          <label>Phone
            <input name="phone" maxlength="40">
          </label>
          <label>Role
            <select name="role">
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
              <option value="cashier">Cashier</option>
              <option value="kitchen">Kitchen</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <button class="btn btn-primary" type="submit">Add staff record</button>
        </form>
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
    $("#ops-supplier-form").addEventListener("submit", addSupplier);
    $("#ops-staff-form").addEventListener("submit", addStaff);
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

    ["orders", "menu", "offers", "settings", "operations"].forEach(key => {
      const panel = $("#tab-" + key);
      if (panel) panel.classList.toggle("hidden", key !== name);
    });

    if (name === "operations") {
      loadAll().catch(showError);
    }
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
      .select("*, suppliers(name)")
      .eq("is_active", true)
      .order("name");

    if (error) throw error;

    const items = data || [];

    $("#ops-stock-count").textContent = items.length;
    $("#ops-low-count").textContent = items.filter(item =>
      Number(item.quantity) <= Number(item.reorder_level)
    ).length;

    $("#ops-item-select").innerHTML = items.length
      ? items.map(item => `
          <option value="${esc(item.id)}">
            ${esc(item.name)} (${esc(item.quantity)} ${esc(item.unit)})
          </option>
        `).join("")
      : '<option value="">Add an inventory item first</option>';

    $("#ops-inventory-list").innerHTML = table(
      ["Item", "Quantity", "Reorder at", "Unit cost", "Stock value", "Supplier"],
      items.map(item => [
        item.name,
        `${item.quantity} ${item.unit}`,
        item.reorder_level,
        money(item.unit_cost),
        money(Number(item.quantity) * Number(item.unit_cost)),
        item.suppliers?.name || "—"
      ])
    );
  }

  async function addInventoryItem(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);
    const openingQuantity = Number(data.get("quantity"));

    try {
      const { data: item, error } = await db
        .from("inventory_items")
        .insert({
          name: String(data.get("name")).trim(),
          unit: String(data.get("unit")).trim(),
          quantity: 0,
          reorder_level: Number(data.get("reorder_level")),
          unit_cost: Number(data.get("unit_cost")),
          supplier_id: String(data.get("supplier_id") || "").trim() || null,
          notes: String(data.get("notes") || "").trim() || null
        })
        .select()
        .single();

      if (error) throw error;

      if (openingQuantity > 0) {
        const { error: movementError } = await db.rpc(
          "record_inventory_movement",
          {
            p_item_id: item.id,
            p_movement_type: "opening",
            p_quantity_change: openingQuantity,
            p_unit_cost: Number(data.get("unit_cost")),
            p_reference: "Opening stock",
            p_notes: "Initial quantity"
          }
        );

        if (movementError) {
          throw new Error(
            "Item was created, but opening stock was not recorded: " +
            movementError.message
          );
        }
      }

      form.reset();
      form.elements.unit.value = "kg";
      message("Inventory item saved.");
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
    const quantityChange = Number(data.get("quantity_change"));
    if (!Number.isFinite(quantityChange) || quantityChange === 0) {
      message("Enter a quantity change other than zero.", true);
      return;
    }
    if (["purchase"].includes(movementType) && quantityChange < 0) {
      message("Purchases must add stock. Enter a positive quantity.", true);
      return;
    }
    if (["usage", "waste"].includes(movementType) && quantityChange > 0) {
      message("Usage and waste must reduce stock. Enter a negative quantity.", true);
      return;
    }

    try {
      const { error } = await db.rpc("record_inventory_movement", {
        p_item_id: data.get("item_id"),
        p_movement_type: movementType,
        p_quantity_change: quantityChange,
        p_unit_cost: Number(data.get("unit_cost") || 0),
        p_reference: String(data.get("reference") || "").trim() || null,
        p_notes: String(data.get("notes") || "").trim() || null
      });

      if (error) throw error;

      form.reset();
      message("Stock movement recorded.");
      await loadInventory();
      await loadMovements();
    } catch (error) {
      showError(error);
    }
  }

  async function loadMovements() {
    const { data, error } = await db
      .from("inventory_movements")
      .select("id,movement_type,quantity_change,unit_cost,reference,notes,created_at,inventory_items(name,unit)")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    $("#ops-movements-list").innerHTML = table(
      ["Date", "Item", "Movement", "Quantity", "Unit cost", "Reference", "Notes"],
      (data || []).map(row => [
        new Date(row.created_at).toLocaleString(),
        row.inventory_items?.name || "Unknown item",
        row.movement_type,
        `${row.quantity_change} ${row.inventory_items?.unit || ""}`,
        money(row.unit_cost),
        row.reference || "—",
        row.notes || "—"
      ])
    );
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

  async function loadStaff() {
    const { data, error } = await db
      .from("staff_profiles")
      .select("*")
      .eq("is_active", true)
      .order("full_name");
    if (error) throw error;
    $("#ops-staff-list").innerHTML = table(
      ["Name", "Phone", "Role", "Added"],
      (data || []).map(person => [
        person.full_name,
        person.phone || "—",
        person.role,
        new Date(person.created_at).toLocaleDateString()
      ])
    );
  }

  async function addStaff(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const { error } = await db.from("staff_profiles").insert({
        full_name: String(data.get("full_name") || "").trim(),
        phone: String(data.get("phone") || "").trim() || null,
        role: String(data.get("role") || "staff")
      });
      if (error) throw error;
      form.reset();
      message("Staff record saved. This does not grant login access.");
      await loadStaff();
    } catch (error) {
      showError(error);
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
      db.from("staff_attendance").select("*,staff_profiles(full_name,role)").eq("work_date",date).order("check_in_at",{ascending:false}).limit(100)
    ]);
    if(staffResult.error) throw staffResult.error;
    if(attendanceResult.error) throw attendanceResult.error;
    const select=$("#ops-attendance-staff");
    if(select) select.innerHTML=(staffResult.data||[]).map(person=>'<option value="'+esc(person.id)+'">'+esc(person.full_name)+'</option>').join("")||'<option value="">Add staff first</option>';
    $("#ops-attendance-form").querySelector('button[type="submit"]').disabled=!(staffResult.data||[]).length;
    $("#ops-attendance-list").innerHTML=table(
      ["Staff","Role","Clock in","Clock out","Hours","Action"],
      (attendanceResult.data||[]).map(record=>{
        const elapsed=((record.check_out_at?new Date(record.check_out_at):new Date())-new Date(record.check_in_at))/3600000;
        const hours=Math.max(0,elapsed);
        const action=record.check_out_at?"Finished":{kind:"html",value:'<button class="btn btn-light" data-clock-out="'+esc(record.id)+'">Clock out</button>'};
        return [record.staff_profiles?.full_name||"Staff",record.staff_profiles?.role||"—",
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
      const endExclusive=end.toISOString();
      const startISO=start.toISOString();

      const [
        {data:orders,error:ordersError},
        {data:completedOrders,error:completedOrdersError},
        {data:expenses,error:expensesError},
        {data:payouts,error:payoutsError}
      ]=await Promise.all([
        db.from("orders").select("id,order_number,customer_name,customer_phone,total,status,created_at,updated_at")
          .gte("created_at",startISO).lt("created_at",endExclusive).order("created_at",{ascending:false}),
        db.from("orders").select("id,order_number,total,status,created_at,updated_at")
          .eq("status","completed").gte("updated_at",startISO).lt("updated_at",endExclusive),
        db.from("expenses").select("expense_date,category,description,amount,payment_method,reference")
          .gte("expense_date",fromDate).lte("expense_date",toDate).order("expense_date",{ascending:false}),
        db.from("cash_payouts").select("payout_date,category,description,amount,payment_method,reference")
          .gte("payout_date",fromDate).lte("payout_date",toDate).order("payout_date",{ascending:false})
      ]);
      if(ordersError) throw ordersError;
      if(completedOrdersError) throw completedOrdersError;
      if(expensesError) throw expensesError;
      if(payoutsError) throw payoutsError;

      const sales=(completedOrders||[]).reduce((sum,order)=>sum+Number(order.total),0);
      const expenseTotal=(expenses||[]).reduce((sum,item)=>sum+Number(item.amount),0);
      const payoutTotal=(payouts||[]).reduce((sum,item)=>sum+Number(item.amount),0);
      lastReportRows=[
        ["Type","Date","Reference","Name / Category","Description","Method","Amount","Status"],
        ...(completedOrders||[]).map(order=>[
          "Completed sale",new Date(order.updated_at).toISOString(),order.order_number||order.id,
          order.customer_name||"",order.customer_phone||"","cash",Number(order.total),order.status
        ]),
        ...(expenses||[]).map(item=>[
          "Expense",item.expense_date,item.reference||"",item.category,item.description,item.payment_method,Number(item.amount),"Recorded"
        ]),
        ...(payouts||[]).map(item=>[
          "Cash payout",item.payout_date,item.reference||"",item.category,item.description,item.payment_method,Number(item.amount),"Recorded"
        ])
      ];

      $("#ops-report-content").innerHTML=
        '<div class="ops-grid">'+
          '<div class="ops-stat"><small>Orders placed in range</small><strong>'+(orders||[]).length+'</strong></div>'+
          '<div class="ops-stat"><small>Completed sales in range</small><strong>'+money(sales)+'</strong></div>'+
          '<div class="ops-stat"><small>Recorded expenses</small><strong>'+money(expenseTotal)+'</strong></div>'+
          '<div class="ops-stat"><small>Cash payouts / money out</small><strong>'+money(payoutTotal)+'</strong></div>'+
        '</div>'+
        '<p><strong>Sales less recorded expenses and payouts:</strong> '+money(sales-expenseTotal-payoutTotal)+'</p>'+
        '<p class="ops-note">This is a cash/recorded-cost summary, not net profit. Completed sales are grouped by order update time; expenses and payouts use their entered dates. Ingredient cost, payroll and other missing costs are not included unless entered as expenses.</p>'+
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