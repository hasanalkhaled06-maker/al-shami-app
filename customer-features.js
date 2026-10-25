/* AL SHAMI customer rewards and alert preferences. Requires the additive rewards migration. */
(() => {
  "use strict";
  const cfg=window.AL_SHAMI_CONFIG||{};
  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return;
  const db=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{
    auth:{storageKey:"al-shami-customer-auth-v1",persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  });
  const style=document.createElement("style");
  style.textContent=".customer-feature-card{margin:16px 0;padding:18px;border:1px solid #e7d9d0;border-radius:16px;background:#fffaf6;color:#281a17}.customer-feature-card h3{margin:0 0 10px}.customer-feature-card .feature-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:9px 0}.customer-feature-card input[type=number],.customer-feature-card input[type=text]{max-width:190px;padding:9px;border:1px solid #c9b9ae;border-radius:8px}.customer-feature-card label{display:inline-flex;gap:7px;align-items:center}.customer-feature-note{font-size:.9em;color:#665750}";
  document.head.append(style);
  const form=document.querySelector("#checkout-form");
  if(form&&!form.querySelector("[name=loyalty_points_to_redeem]")){
    const box=document.createElement("div"); box.className="customer-feature-card";box.id="checkout-rewards";
    box.innerHTML='<h3>Rewards & referral</h3><p class="customer-feature-note" id="checkout-rewards-summary">Sign in and enable rewards to earn stamps and points.</p><div class="feature-row"><label>Points to redeem <input name="loyalty_points_to_redeem" type="number" min="0" step="1" value="0" inputmode="numeric"></label><label>Referral code (first order) <input name="referral_code" type="text" maxlength="8" autocomplete="off"></label></div><div class="feature-row"><label><input name="redeem_stamp_reward" type="checkbox"> Redeem available stamp reward</label></div>';
    form.insertBefore(box,form.querySelector("button[type=submit],button:not([type])")||form.lastElementChild);
  }
  const host=document.querySelector("#customer-order-history");
  if(host&&!document.querySelector("#customer-preferences-card")){
    const panel=document.createElement("section");panel.className="customer-feature-card";panel.id="customer-preferences-card";
    panel.innerHTML='<h3>Rewards & notifications</h3><p class="customer-feature-note" id="customer-feature-status">Sign in to view your rewards and save notification preferences.</p><div id="customer-rewards-summary" hidden></div><div class="feature-row" id="customer-notification-options" hidden><label><input type="checkbox" data-pref="order_updates" checked> Order updates</label><label><input type="checkbox" data-pref="rider_tracking" checked> Rider tracking</label><label><input type="checkbox" data-pref="promotions"> Promotions</label></div>';
    host.parentElement?.append(panel);
  }
  const status=document.querySelector("#customer-feature-status");
  const summary=document.querySelector("#customer-rewards-summary");
  const options=document.querySelector("#customer-notification-options");
  async function load(){
    const {data:{session}}=await db.auth.getSession();
    if(!session?.user){if(status)status.textContent="Sign in to view rewards and set your alert choices.";return;}
    if(options)options.hidden=false;
    const [{data:rewards,error:rewardError},{data:prefs,error:prefsError}]=await Promise.all([
      db.rpc("get_my_loyalty_summary"),
      db.from("customer_notification_preferences").select("order_updates,rider_tracking,promotions").eq("customer_user_id",session.user.id).maybeSingle()
    ]);
    if(prefs&&!prefsError) options?.querySelectorAll("[data-pref]").forEach(el=>el.checked=Boolean(prefs[el.dataset.pref]));
    if(rewardError){
      if(status)status.textContent="Rewards appear after the optional loyalty database migration is applied.";
      return;
    }
    if(summary){
      summary.hidden=false;
      summary.innerHTML=rewards.enabled
        ? '<p><strong>'+Number(rewards.points||0)+'</strong> points · <strong>'+Number(rewards.stamps||0)+' / '+Number(rewards.stamps_per_reward||10)+'</strong> stamps toward a reward ('+Number(rewards.stamp_reward_ghs||0)+' GH₵ checkout discount)</p><p>Your referral code: <strong>'+String(rewards.referral_code||"")+'</strong></p><p class="customer-feature-note">Redeem points during checkout. Referral rewards are credited after your friend completes an order.</p>'
        : '<p>Loyalty rewards are waiting for restaurant setup. Your referral code: <strong>'+String(rewards.referral_code||"")+'</strong></p>';
    }
    if(status)status.textContent=prefsError?"Rewards loaded. Alert preferences will save after the optional database migration.":"Choose the updates you want to receive.";
  }
  options?.addEventListener("change",async()=>{
    const {data:{session}}=await db.auth.getSession(); if(!session?.user)return;
    const row={customer_user_id:session.user.id,updated_at:new Date().toISOString()};
    options.querySelectorAll("[data-pref]").forEach(el=>row[el.dataset.pref]=el.checked);
    const {error}=await db.from("customer_notification_preferences").upsert(row,{onConflict:"customer_user_id"});
    if(status)status.textContent=error?"Could not save alert choices. Apply the optional database migration and try again.":"Alert choices saved.";
  });
  db.auth.onAuthStateChange(()=>setTimeout(()=>void load(),0));
  void load();
})();
