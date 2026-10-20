/* AL SHAMI operations module v2
 * Add <script src="admin-operations.js"></script> AFTER admin.js in admin.html.
 * Requires existing config.js and the existing authorised Supabase admin session.
 */
(() => {
  "use strict";
  const cfg = window.AL_SHAMI_CONFIG || {};
  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;
  const db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const $ = (s, root=document) => root.querySelector(s);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money = n => "GH₵ " + Number(n || 0).toFixed(2);
  let loaded = false;

  function addStyles() {
    if ($("#ops-styles")) return;
    const style = document.createElement("style");
    style.id = "ops-styles";
    style.textContent = `
      .ops-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:12px 0}
      .ops-stat{background:#fffaf5;border:1px solid #eee3dc;border-radius:12px;padding:14px}
      .ops-stat small{display:block;color:#766d6c}.ops-stat strong{font-size:22px}
      .ops-table-wrap{overflow:auto}.ops-table{width:100%;border-collapse:collapse;font-size:13px}
      .ops-table th,.ops-table td{padding:10px;border-bottom:1px solid #eee3dc;text-align:left;white-space:nowrap}
      .ops-form{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:14px 0}
      .ops-form label{font-size:12px;font-weight:700;display:grid;gap:5px}
      .ops-form .wide{grid-column:1/-1}.ops-note{font-size:12px;color:#766d6c}
      @media(max-width:700px){.ops-grid{grid-template-columns:1fr}.ops-form{grid-template-columns:1fr}.ops-form .wide{grid-column:auto}}
    `;
    document.head.appendChild(style);
  }

  function addPanel() {
    if ($("#tab-operations")) return;
    const tabs = $(".admin-tabs");
    const dashboard = $("#dashboard");
    if (!tabs || !dashboard) return;
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
      <p class="muted">Inventory, suppliers, expenses, cash shifts and daily figures.</p>
      <div class="ops-grid">
        <div class="ops-stat"><small>Active stock items</small><strong id="ops-stock-count">—</strong></div>
        <div class="ops-stat"><small>Low stock items</small><strong id="ops-low-count">—</strong></div>
        <div class="ops-stat"><small>Expenses today</small><strong id="ops-expenses-today">—</strong></div>
      </div>
      <div class="admin-tabs" id="ops-subtabs">
        <button class="tab active" data-opstab="inventory" type="button">Inventory</button>
        <button class="tab" data-opstab="suppliers" type="button">Suppliers</button>
        <button class="tab" data-opstab="expenses" type="button">Expenses</button>
        <button class="tab" data-opstab="shifts" type="button">Cash shifts</button>
        <button class="tab" data-opstab="reports" type="button">Reports</button>
      </div>
      <div id="ops-message" class="status-message" role="status"></div>
      <section id="ops-inventory">
        <h3>Inventory</h3>
        <form id="ops-item-form" class="ops-form">
          <label>Item name<input name="name" required maxlength="120"></label>
          <label>Unit<input name="unit" required value="kg" maxlength="20"></label>
          <label>Opening quantity<input name="quantity" type="number" min="0" step="0.001" required value="0"></label>
          <label>Reorder level<input name="reorder_level" type="number" min="0" step="0.001" required value="0"></label>
          <label>Unit cost (GH₵)<input name="unit_cost" type="number" min="0" step="0.01" required value="0"></label>
          <label>Notes<input name="notes" maxlength="250"></label>
          <button class="btn btn-primary" type="submit">Add stock item</button>
        </form>
        <form id="ops-movement-form" class="ops-form">
          <label>Stock item<select name="item_id" id="ops-item-select" required></select></label>
          <label>Movement<select name="movement_type"><option value="purchase">Purchase / add stock</option><option value="usage">Usage / reduce stock</option><option value="waste">Waste / reduce stock</option><option value="adjustment">Adjustment (signed quantity)</option></select></label>
          <label>Quantity change<input name="quantity_change" type="number" step="0.001" required placeholder="Use negative quantity to reduce"></label>
          <label>Unit cost (GH₵)<input name="unit_cost" type="number" min="0" step="0.01" value="0"></label>
          <label>Reference<input name="reference" maxlength="100" placeholder="Receipt / invoice"></label>
          <label>Notes<input name="notes" maxlength="250"></label>
          <button class="btn btn-primary" type="submit">Save stock movement</button>
        </form>
        <div id="ops-inventory-list" class="ops-table-wrap"></div>
      </section>
      <section id="ops-suppliers" class="hidden">
        <h3>Suppliers</h3>
        <form id="ops-supplier-form" class="ops-form">
          <label>Supplier name<input name="name" required maxlength="120"></label>
          <label>Phone<input name="phone" maxlength="40"></label>
          <label>Email<input name="email" type="email" maxlength="150"></label>
          <label class="wide">Address / notes<input name="address" maxlength="250"></label>
          <button class="btn btn-primary" type="submit">Add supplier</button>
        </form>
        <div id="ops-suppliers-list" class="ops-table-wrap"></div>
      </section>
      <section id="ops-expenses" class="hidden">
        <h3>Expenses</h3>
        <form id="ops-expense-form" class="ops-form">
          <label>Date<input name="expense_date" type="date" required></label>
          <label>Category<input name="category" required maxlength="80" placeholder="Rent, electricity, wages"></label>
          <label>Amount (GH₵)<input name="amount" type="number" min="0.01" step="0.01" required></label>
          <label class="wide">Description<input name="description" required maxlength="250"></label>
          <label>Payment method<select name="payment_method"><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank">Bank</option><option value="other">Other</option></select></label>
          <label>Reference<input name="reference" maxlength="100"></label>
          <button class="btn btn-primary" type="submit">Record expense</button>
        </form>
        <div id="ops-expenses-list" class="ops-table-wrap"></div>
      </section>
      <section id="ops-shifts" class="hidden">
        <h3>Cash shifts</h3>
        <form id="ops-shift-open-form" class="ops-form">
          <label>Opening cash (GH₵)<input name="opening_cash" type="number" min="0" step="0.01" required value="0"></label>
          <label class="wide">Notes<input name="notes" maxlength="250"></label>
          <button class="btn btn-primary" type="submit">Open shift</button>
        </form>
        <div id="ops-shifts-list" class="ops-table-wrap"></div>
      </section>
      <section id="ops-reports" class="hidden">
        <h3>Sales and expense summary</h3>
        <p class="ops-note">Sales totals are based on orders marked completed. Profit is not calculated until recipe/ingredient costs are linked to menu items.</p>
        <div id="ops-report-content"></div>
      </section>
    `;
    dashboard.appendChild(panel);
    button.addEventListener("click", () => showTab("operations"));
    document.querySelectorAll(".tab[data-tab]").forEach(tab => {
      tab.addEventListener("click", () => {
        if (tab.dataset.tab !== "operations") showTab(tab.dataset.tab);
      });
    });
    $("#ops-subtabs").addEventListener("click", e => {
      const btn = e.target.closest("[data-opstab]");
      if (!btn) return;
      $("#ops-subtabs").querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t === btn));
      ["inventory","suppliers","expenses","shifts","reports"].forEach(k => $("#ops-"+k).classList.toggle("hidden", k !== btn.dataset.opstab));
      if (btn.dataset.opstab === "reports") loadReports();
    });
    $("#ops-item-form").addEventListener("submit", addInventoryItem);
    $("#ops-movement-form").addEventListener("submit", saveMovement);
    $("#ops-supplier-form").addEventListener("submit", addSupplier);
    $("#ops-expense-form").addEventListener("submit", addExpense);
    $("#ops-shift-open-form").addEventListener("submit", openShift);
  }

  function showTab(name) {
    document.querySelectorAll(".tab[data-tab]").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    ["orders","menu","offers","settings","operations"].forEach(k => {
      const panel = $("#tab-"+k);
      if (panel) panel.classList.toggle("hidden", k !== name);
    });
    if (name === "operations") loadAll().catch(showError);
  }

  function message(msg, error=false) {
    const el = $("#ops-message");
    if (el) { el.textContent = msg; el.className = "status-message " + (error ? "error" : "success"); }
  }
  function showError(e) { console.error("Operations module:",e); message(e?.message || "Operation failed. Check the migration and permissions.",true); }

  async function adminCheck() {
    const {data:{session}} = await db.auth.getSession();
    if (!session) return false;
    const {data,error} = await db.rpc("is_current_user_admin");
    if (error) throw error;
    return Boolean(data);
  }

  async function loadAll() {
    if (!(await adminCheck())) { message("Sign in with an authorised admin account to use Operations.",true); return; }
    loaded = true;
    await Promise.all([loadInventory(),loadSuppliers(),loadExpenses(),loadShifts()]);
  }

  async function loadInventory() {
    const {data,error} = await db.from("inventory_items").select("*").eq("is_active",true).order("name");
    if(error) throw error;
    const items = data || [];
    $("#ops-stock-count").textContent = items.length;
    $("#ops-low-count").textContent = items.filter(i=>Number(i.quantity)<=Number(i.reorder_level)).length;
    $("#ops-item-select").innerHTML = items.length ? items.map(i=>`<option value="${esc(i.id)}">${esc(i.name)} (${esc(i.quantity)} ${esc(i.unit)})</option>`).join("") : '<option value="">Add an inventory item first</option>';
    $("#ops-inventory-list").innerHTML = table(["Item","Quantity","Reorder at","Unit cost","Stock value"],items.map(i=>[
      i.name,`${i.quantity} ${i.unit}`,i.reorder_level,money(i.unit_cost),money(Number(i.quantity)*Number(i.unit_cost))
    ]));
  }

  async function addInventoryItem(e) {
    e.preventDefault(); const form=e.currentTarget; const f=new FormData(form);
    try {
      const {data,error}=await db.from("inventory_items").insert({
        name:String(f.get("name")).trim(),unit:String(f.get("unit")).trim(),
        quantity:Number(f.get("quantity")),reorder_level:Number(f.get("reorder_level")),
        unit_cost:Number(f.get("unit_cost")),notes:String(f.get("notes")||"").trim()||null
      }).select().single();
      if(error) throw error;
      if(Number(data.quantity)>0) {
        const {error:movementError}=await db.rpc("record_inventory_movement",{
          p_item_id:data.id,p_movement_type:"opening",p_quantity_change:Number(data.quantity),
          p_unit_cost:Number(data.unit_cost),p_reference:"Opening stock",p_notes:"Initial quantity"
        });
        if(movementError) throw movementError;
      }
      form.reset(); form.elements.unit.value="kg";
      message("Inventory item saved."); await loadInventory();
    } catch(err){showError(err);}
  }

  async function saveMovement(e) {
    e.preventDefault(); const form=e.currentTarget; const f=new FormData(form);
    try {
      const {error}=await db.rpc("record_inventory_movement",{
        p_item_id:f.get("item_id"),p_movement_type:f.get("movement_type"),
        p_quantity_change:Number(f.get("quantity_change")),p_unit_cost:Number(f.get("unit_cost")||0),
        p_reference:String(f.get("reference")||"").trim()||null,p_notes:String(f.get("notes")||"").trim()||null
      });
      if(error) throw error;
      form.reset(); message("Stock movement recorded."); await loadInventory();
    } catch(err){showError(err);}
  }

  async function loadSuppliers() {
    const {data,error}=await db.from("suppliers").select("*").eq("is_active",true).order("name");
    if(error) throw error;
    $("#ops-suppliers-list").innerHTML=table(["Supplier","Phone","Email","Address"],(data||[]).map(s=>[s.name,s.phone||"—",s.email||"—",s.address||"—"]));
  }

  async function addSupplier(e) {
    e.preventDefault(); const form=e.currentTarget; const f=new FormData(form);
    try {
      const {error}=await db.from("suppliers").insert({
        name:String(f.get("name")).trim(),phone:String(f.get("phone")||"").trim()||null,
        email:String(f.get("email")||"").trim()||null,address:String(f.get("address")||"").trim()||null
      });
      if(error) throw error;
      form.reset(); message("Supplier saved."); await loadSuppliers();
    } catch(err){showError(err);}
  }

  async function loadExpenses() {
    const today=new Date().toLocaleDateString("en-CA");
    $("#ops-expense-form").elements.expense_date.value ||= today;
    const {data,error}=await db.from("expenses").select("*").gte("expense_date",today).order("created_at",{ascending:false}).limit(100);
    if(error) throw error;
    const rows=data||[];
    $("#ops-expenses-today").textContent=money(rows.reduce((s,r)=>s+Number(r.amount),0));
    $("#ops-expenses-list").innerHTML=table(["Date","Category","Description","Amount","Method"],rows.map(r=>[r.expense_date,r.category,r.description,money(r.amount),r.payment_method]));
  }

  async function addExpense(e) {
    e.preventDefault(); const form=e.currentTarget; const f=new FormData(form);
    try {
      const {error}=await db.rpc("record_expense",{
        p_category:String(f.get("category")).trim(),p_description:String(f.get("description")).trim(),
        p_amount:Number(f.get("amount")),p_expense_date:f.get("expense_date"),
        p_payment_method:f.get("payment_method"),p_reference:String(f.get("reference")||"").trim()||null
      });
      if(error) throw error;
      form.reset(); form.elements.expense_date.value=new Date().toLocaleDateString("en-CA");
      message("Expense recorded."); await loadExpenses();
    } catch(err){showError(err);}
  }

  async function loadShifts() {
    const {data,error}=await db.from("cash_shifts").select("*").order("opened_at",{ascending:false}).limit(50);
    if(error) throw error;
    $("#ops-shifts-list").innerHTML=table(["Opened","Status","Opening cash","Counted cash","Difference","Action"],(data||[]).map(s=>[
      new Date(s.opened_at).toLocaleString(),s.status,money(s.opening_cash),s.counted_cash==null?"—":money(s.counted_cash),
      s.difference==null?"—":money(s.difference),
      s.status==="open"?`<button class="btn btn-light" data-close-shift="${esc(s.id)}">Close shift</button>`:"Closed"
    ]));
    $("#ops-shifts-list").querySelectorAll("[data-close-shift]").forEach(btn=>btn.addEventListener("click",()=>closeShift(btn.dataset.closeShift)));
  }

  async function openShift(e) {
    e.preventDefault(); const form=e.currentTarget; const f=new FormData(form);
    try {
      const {data:{user}}=await db.auth.getUser();
      const {error}=await db.from("cash_shifts").insert({opened_by:user?.id,opening_cash:Number(f.get("opening_cash")),notes:String(f.get("notes")||"").trim()||null});
      if(error) throw error;
      form.reset(); message("Cash shift opened."); await loadShifts();
    } catch(err){showError(err);}
  }

  async function closeShift(id) {
    const raw=prompt("Enter the actual cash counted in GH₵:");
    if(raw===null) return;
    const counted=Number(raw);
    if(!Number.isFinite(counted)||counted<0){message("Enter a valid non-negative amount.",true);return;}
    const notes=prompt("Closing notes (optional):")||null;
    try {
      const {error}=await db.rpc("close_cash_shift",{p_shift_id:id,p_counted_cash:counted,p_notes:notes});
      if(error) throw error;
      message("Cash shift closed."); await loadShifts();
    } catch(err){showError(err);}
  }

  async function loadReports() {
    try {
      const start=new Date(); start.setHours(0,0,0,0);
      const iso=start.toISOString();
      const [{data:orders,error:e1},{data:expenses,error:e2}] = await Promise.all([
        db.from("orders").select("id,total,status,created_at").gte("created_at",iso).order("created_at",{ascending:false}),
        db.from("expenses").select("amount,category,expense_date").gte("expense_date",start.toLocaleDateString("en-CA"))
      ]);
      if(e1) throw e1; if(e2) throw e2;
      const completed=(orders||[]).filter(o=>o.status==="completed").reduce((s,o)=>s+Number(o.total),0);
      const allOrders=(orders||[]).length;
      const expenseTotal=(expenses||[]).reduce((s,e)=>s+Number(e.amount),0);
      $("#ops-report-content").innerHTML=`
        <div class="ops-grid">
          <div class="ops-stat"><small>Orders today</small><strong>${allOrders}</strong></div>
          <div class="ops-stat"><small>Completed sales today</small><strong>${money(completed)}</strong></div>
          <div class="ops-stat"><small>Expenses today</small><strong>${money(expenseTotal)}</strong></div>
        </div>
        <p><strong>Sales minus recorded expenses:</strong> ${money(completed-expenseTotal)}</p>
        <p class="ops-note">This is not net profit: stock consumption, payroll and other unrecorded costs may be missing.</p>`;
    } catch(err){showError(err);}
  }

  function table(headers, rows) {
    if(!rows.length) return '<p class="muted">No records yet.</p>';
    return `<table class="ops-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
      rows.map(row=>`<tr>${row.map(cell=>`<td>${String(cell).startsWith("<button")?cell:esc(cell)}</td>`).join("")}</tr>`).join("")
    }</tbody></table>`;
  }

  function init() {
    addStyles(); addPanel();
    const dashboard=$("#dashboard");
    if(!dashboard) return;
    const observer=new MutationObserver(() => {
      if(!dashboard.classList.contains("hidden") && !loaded) loadAll().catch(showError);
    });
    observer.observe(dashboard,{attributes:true,attributeFilter:["class"]});
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();
