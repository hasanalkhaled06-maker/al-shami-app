/* AL SHAMI admin delivery monitoring, zone duration report, and loyalty settings. */
(() => {
  "use strict";
  const cfg=window.AL_SHAMI_CONFIG||{};
  if(!window.supabase||!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)return;
  const db=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{
    auth:{storageKey:"al-shami-admin-auth-v1",persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  });
  const $=s=>document.querySelector(s), esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const dashboard=$("#dashboard");
  if(!dashboard)return;
  const panel=document.createElement("section");panel.className="panel";panel.id="delivery-ops-features";
  panel.innerHTML='<h2>Delivery health & reports</h2><p id="delivery-ops-status" class="muted">Checking delivery monitoring setup…</p><div id="delivery-ops-alerts"></div><div class="feature-report"><h3>Delivery duration by area</h3><label>From <input id="delivery-report-from" type="date"></label> <label>To <input id="delivery-report-to" type="date"></label> <button id="delivery-report-run" class="btn btn-light" type="button">Run report</button><div id="delivery-duration-result"></div></div><hr><div class="feature-loyalty"><h3>Customer rewards rules</h3><p class="muted">Rewards are off until you choose and save the restaurant’s rules.</p><label><input id="loyalty-enabled" type="checkbox"> Enable stamps, points and referrals</label><div class="form-grid"><label>Orders for one stamp reward <input id="stamps-goal" type="number" min="2" max="100" value="10"></label><label>Points per GH₵ spent <input id="points-per-ghs" type="number" min="0" max="100" value="1"></label><label>Points per GH₵ discount <input id="points-redemption" type="number" min="1" max="10000" value="100"></label><label>Referrer bonus points <input id="referral-bonus" type="number" min="0" max="100000" value="100"></label><label>Stamp reward discount (GH₵) <input id="stamp-reward-ghs" type="number" min="0" max="500" step="0.01" value="0"></label></div><button id="loyalty-save" class="btn btn-primary" type="button">Save rewards rules</button><span id="loyalty-save-status" role="status"></span></div>';
  dashboard.insertBefore(panel,dashboard.children[1]||null);
  const today=new Date(), from=new Date(today.getTime()-29*86400000), fmt=d=>d.toISOString().slice(0,10);
  $("#delivery-report-from").value=fmt(from);$("#delivery-report-to").value=fmt(today);
  function labelTime(v){if(!v)return "No GPS update";const dt=new Date(v);return Number.isNaN(dt.getTime())?"Unknown":dt.toLocaleString("en-GH",{dateStyle:"medium",timeStyle:"short"});}
  let settingsLoaded=false;
  async function monitor(){
    if($("#dashboard")?.classList.contains("hidden"))return;
    const status=$("#delivery-ops-status");
    const [{data:ops,error:opsErr},{data:settings,error:setErr}]=await Promise.all([
      db.rpc("get_delivery_admin_ops"),db.from("customer_loyalty_settings").select("*").eq("id",1).maybeSingle()
    ]);
    if(opsErr){if(status)status.textContent="Delivery alerts and reporting are ready after the optional delivery operations migration is applied.";return;}
    const rows=Array.isArray(ops)?ops:[];
    const stale=rows.filter(x=>x.gps_stale);
    if(status)status.textContent=rows.length?rows.length+" active delivery"+(rows.length===1?"":"ies")+" · "+stale.length+" GPS alert"+(stale.length===1?"":"s"):"No active deliveries currently out for delivery.";
    $("#delivery-ops-alerts").innerHTML=stale.map(o=>'<article class="admin-menu-row" style="border-left:4px solid #b42318;padding:10px;margin:8px 0"><strong>GPS stopped updating · Order #'+esc(o.order_number)+'</strong><div>'+esc(o.customer_name||"Customer")+' · '+esc(o.zone||o.address||"Area not set")+'</div><small>Last update: '+esc(labelTime(o.gps_updated_at))+'</small></article>').join("")+
      rows.filter(o=>o.last_failure_reason).map(o=>'<p class="muted">Order #'+esc(o.order_number)+' · last failed attempt: '+esc(o.last_failure_reason.replaceAll("_"," "))+' · '+esc(labelTime(o.last_failed_at))+'</p>').join("");
    if(!setErr&&settings&&!settingsLoaded){$("#loyalty-enabled").checked=settings.enabled;$("#stamps-goal").value=settings.stamps_per_reward;$("#points-per-ghs").value=settings.points_per_ghs;$("#points-redemption").value=settings.points_per_ghs_redeemed;$("#referral-bonus").value=settings.referral_bonus_points;$("#stamp-reward-ghs").value=settings.stamp_reward_ghs;settingsLoaded=true;}
  }
  async function report(){
    const out=$("#delivery-duration-result");
    out.textContent="Loading report…";
    const start=$("#delivery-report-from").value, end=$("#delivery-report-to").value;
    if(!start||!end){out.textContent="Choose both dates.";return;}
    const {data,error}=await db.rpc("get_delivery_duration_report",{p_from:new Date(start+"T00:00:00").toISOString(),p_to:new Date(new Date(end+"T00:00:00").getTime()+86400000).toISOString()});
    if(error){out.textContent="Apply the optional delivery operations migration before running this report.";return;}
    const rows=Array.isArray(data)?data:[];
    out.innerHTML=rows.length?'<div class="table-wrap"><table><thead><tr><th>Area</th><th>Completed</th><th>Average min</th><th>Fastest</th><th>Slowest</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.zone_name)+'</td><td>'+esc(r.completed_deliveries)+'</td><td>'+esc(r.avg_minutes??"—")+'</td><td>'+esc(r.fastest_minutes??"—")+'</td><td>'+esc(r.slowest_minutes??"—")+'</td></tr>').join("")+'</tbody></table></div>':'No completed deliveries with tracking timestamps in that period.';
  }
  $("#delivery-report-run").addEventListener("click",()=>void report());
  $("#loyalty-save").addEventListener("click",async()=>{
    const b=$("#loyalty-save"),msg=$("#loyalty-save-status");b.disabled=true;msg.textContent="Saving…";
    const {error}=await db.rpc("admin_update_loyalty_settings",{p_enabled:$("#loyalty-enabled").checked,p_stamps_per_reward:Number($("#stamps-goal").value),p_points_per_ghs:Number($("#points-per-ghs").value),p_points_per_ghs_redeemed:Number($("#points-redemption").value),p_referral_bonus_points:Number($("#referral-bonus").value),p_stamp_reward_ghs:Number($("#stamp-reward-ghs").value)});
    msg.textContent=error?"Could not save. Apply the optional loyalty migration and check admin access.":"Saved. New completed orders will follow these rules.";
    b.disabled=false;
  });
  db.auth.onAuthStateChange(()=>setTimeout(()=>void monitor(),0));
  void monitor();window.setInterval(()=>void monitor(),30000);
})();
