/* Delivery monitoring belongs under Operations > Reports; loyalty rules belong under Settings. */
(() => {
  "use strict";
  const cfg=window.AL_SHAMI_CONFIG||{};
  if(!window.supabase||!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)return;
  const db=window.AL_SHAMI_ADMIN_DB||window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{
    auth:{storageKey:"al-shami-admin-auth-v1",persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  });
  const $=s=>document.querySelector(s),esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const css=document.createElement("style");
  css.textContent=".delivery-ops-card{margin:18px 0;padding:18px;border:1px solid #e1d8d5;border-radius:14px;background:#fff}.delivery-ops-card h3{margin:0 0 12px}.delivery-ops-card .form-grid{margin:12px 0}.delivery-ops-card input[type=number]{max-width:180px}.delivery-ops-alert{border-left:4px solid #b42318;padding:10px;margin:8px 0;background:#fff5f4}.delivery-report-table{width:100%;border-collapse:collapse;margin-top:12px}.delivery-report-table th,.delivery-report-table td{padding:8px;border-bottom:1px solid #e8e1de;text-align:left}";
  document.head.append(css);
  let settingsLoaded=false,settingsLoading=false,settingsDeniedForUser="";
  function mountSettings(){
    const host=$("#tab-settings");if(!host)return;
    if($("#loyalty-settings-area")){void loadSettings();return;}
    const panel=document.createElement("section");panel.id="loyalty-settings-area";panel.className="delivery-ops-card";
    panel.innerHTML='<hr><h3>Customer loyalty settings</h3><p class="muted">Configure stamps, points and referral rewards. Points convert only to a discount on an order at checkout; there is no cash payout. These rules apply to completed orders.</p><label><input id="loyalty-enabled" type="checkbox"> Enable stamps, points and referrals</label><div class="form-grid"><label>Completed orders for one stamp reward<input id="stamps-goal" type="number" min="2" max="100" value="10"></label><label>Points earned per GH₵ spent<input id="points-per-ghs" type="number" min="0" max="100" value="1"></label><label>Points needed for GH₵1 order discount<input id="points-redemption" type="number" min="1" max="10000" value="100"></label><label>Referrer bonus points<input id="referral-bonus" type="number" min="0" max="100000" value="100"></label><label>Stamp reward discount (GH₵)<input id="stamp-reward-ghs" type="number" min="0" max="500" step="0.01" value="0"></label></div><button id="loyalty-save" class="btn btn-primary" type="button">Save loyalty settings</button> <span id="loyalty-save-status" role="status"></span>';
    host.append(panel);
    $("#loyalty-save").addEventListener("click",async()=>{
      const b=$("#loyalty-save"),msg=$("#loyalty-save-status");b.disabled=true;msg.textContent="Saving…";
      const {error}=await db.rpc("admin_update_loyalty_settings",{p_enabled:$("#loyalty-enabled").checked,p_stamps_per_reward:Number($("#stamps-goal").value),p_points_per_ghs:Number($("#points-per-ghs").value),p_points_per_ghs_redeemed:Number($("#points-redemption").value),p_referral_bonus_points:Number($("#referral-bonus").value),p_stamp_reward_ghs:Number($("#stamp-reward-ghs").value)});
      msg.textContent=error?"Could not save. Apply the optional loyalty migration and check admin access.":"Saved. New completed orders will follow these rules.";
      b.disabled=false;
    });
    void loadSettings();
  }
  async function loadSettings(){
    if(settingsLoaded||settingsLoading)return;
    settingsLoading=true;
    try{
      const {data:sessionData,error:sessionError}=await db.auth.getSession();
      const user=sessionData?.session?.user;
      if(sessionError||!user)return;
      if(settingsDeniedForUser&&settingsDeniedForUser!==user.id)settingsDeniedForUser="";
      if(settingsDeniedForUser===user.id)return;
      const {data:isAdmin,error:adminError}=await db.rpc("is_current_user_admin");
      if(adminError)return;
      if(!isAdmin){settingsDeniedForUser=user.id;return;}
      const {data,error}=await db.from("customer_loyalty_settings").select("*").eq("id",1).maybeSingle();
      if(error||!data)return;
      $("#loyalty-enabled").checked=data.enabled;$("#stamps-goal").value=data.stamps_per_reward;
      $("#points-per-ghs").value=data.points_per_ghs;$("#points-redemption").value=data.points_per_ghs_redeemed;
      $("#referral-bonus").value=data.referral_bonus_points;$("#stamp-reward-ghs").value=data.stamp_reward_ghs;
      settingsLoaded=true;
    }finally{
      settingsLoading=false;
    }
  }
  function mountOperations(){
    const host=$("#ops-reports");if(!host||$("#delivery-ops-feature"))return;
    const panel=document.createElement("section");panel.id="delivery-ops-feature";panel.className="delivery-ops-card";
    panel.innerHTML='<hr><h3>Delivery monitoring</h3><p id="delivery-ops-status" class="muted">Loading active delivery checks…</p><div id="delivery-ops-alerts"></div><h3>Delivery duration by area</h3><p class="muted">Uses delivery zone and the recorded start/end of each completed delivery.</p><label>From <input id="delivery-report-from" type="date"></label> <label>To <input id="delivery-report-to" type="date"></label> <button id="delivery-report-run" class="btn btn-light" type="button">Run delivery report</button><div id="delivery-duration-result"></div>';
    host.append(panel);
    const today=new Date(),from=new Date(today.getTime()-29*86400000),fmt=d=>d.toISOString().slice(0,10);
    $("#delivery-report-from").value=fmt(from);$("#delivery-report-to").value=fmt(today);
    $("#delivery-report-run").addEventListener("click",()=>void report());
    void monitor();
  }
  function time(v){if(!v)return "No GPS update";const d=new Date(v);return Number.isNaN(d.getTime())?"Unknown":d.toLocaleString("en-GH",{dateStyle:"medium",timeStyle:"short"});}
  async function monitor(){
    if($("#dashboard")?.classList.contains("hidden")||$("#tab-operations")?.classList.contains("hidden")||$("#ops-reports")?.classList.contains("hidden"))return;
    const {data,error}=await db.rpc("get_delivery_admin_ops");if(error){$("#delivery-ops-status").textContent="Delivery monitoring will appear after the optional operations migration is applied.";return;}
    const rows=Array.isArray(data)?data:[],stale=rows.filter(x=>x.gps_stale);
    $("#delivery-ops-status").textContent=rows.length?rows.length+" active delivery"+(rows.length===1?"":"ies")+" · "+stale.length+" GPS alert"+(stale.length===1?"":"s"):"No active deliveries currently out for delivery.";
    $("#delivery-ops-alerts").innerHTML=stale.map(o=>'<article class="delivery-ops-alert"><strong>GPS stopped updating · Order #'+esc(o.order_number)+'</strong><div>'+esc(o.customer_name||"Customer")+' · '+esc(o.zone||o.address||"Area not set")+'</div><small>Last update: '+esc(time(o.gps_updated_at))+'</small></article>').join("")+
      rows.filter(o=>o.last_failure_reason).map(o=>'<p class="muted">Order #'+esc(o.order_number)+' · last failed attempt: '+esc(String(o.last_failure_reason).replaceAll("_"," "))+' · '+esc(time(o.last_failed_at))+'</p>').join("");
  }
  async function report(){
    const out=$("#delivery-duration-result"),start=$("#delivery-report-from").value,end=$("#delivery-report-to").value;
    out.textContent="Loading report…";if(!start||!end){out.textContent="Choose both dates.";return;}
    const {data,error}=await db.rpc("get_delivery_duration_report",{p_from:new Date(start+"T00:00:00").toISOString(),p_to:new Date(new Date(end+"T00:00:00").getTime()+86400000).toISOString()});
    if(error){out.textContent="Apply the optional operations migration before running this report.";return;}
    const rows=Array.isArray(data)?data:[];
    out.innerHTML=rows.length?'<table class="delivery-report-table"><thead><tr><th>Area</th><th>Completed</th><th>Average min</th><th>Fastest</th><th>Slowest</th></tr></thead><tbody>'+rows.map(x=>'<tr><td>'+esc(x.zone_name)+'</td><td>'+esc(x.completed_deliveries)+'</td><td>'+esc(x.avg_minutes??"—")+'</td><td>'+esc(x.fastest_minutes??"—")+'</td><td>'+esc(x.slowest_minutes??"—")+'</td></tr>').join("")+'</tbody></table>':'No completed deliveries with tracking timestamps in this period.';
  }
  function mount(){
    mountSettings();mountOperations();
  }
  const observer=new MutationObserver(mount);observer.observe(document.body,{childList:true,subtree:true});
  mount();
  db.auth.onAuthStateChange(()=>setTimeout(mount,0));
  window.setInterval(()=>{mount();void monitor();},30000);
})();
