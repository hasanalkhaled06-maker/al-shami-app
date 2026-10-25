/* Customer reward checkout controls and private account preferences. */
(() => {
  "use strict";
  const cfg=window.AL_SHAMI_CONFIG||{};
  if(!window.supabase||!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)return;
  const db=window.AL_SHAMI_CUSTOMER_DB||window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{
    auth:{storageKey:"al-shami-customer-auth-v1",persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  });
  const css=document.createElement("style");
  css.textContent=".customer-feature-card{margin:16px 0;padding:18px;border:1px solid #e7d9d0;border-radius:16px;background:#fffaf6;color:#281a17}.customer-feature-card h3{margin:0 0 10px}.customer-feature-card .feature-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:9px 0}.customer-feature-card input[type=number],.customer-feature-card input[type=text]{max-width:190px;padding:9px;border:1px solid #c9b9ae;border-radius:8px}.customer-feature-card label{display:inline-flex;gap:7px;align-items:center}.customer-feature-note{font-size:.9em;color:#665750}.customer-settings-overlay[hidden]{display:none!important}.customer-settings-overlay{position:fixed;inset:0;z-index:10020;background:#150d0dd9;display:grid;place-items:center;padding:18px}.customer-settings-dialog{width:min(620px,100%);max-height:85vh;overflow:auto;background:#fff;border-radius:20px;padding:22px;color:#241a18;box-shadow:0 18px 60px #0006}.customer-settings-dialog header{display:flex;align-items:center;justify-content:space-between;gap:12px}.customer-settings-dialog h2{margin:0}.customer-settings-dialog #customer-settings-close{font-size:1.2rem}";
  document.head.append(css);

  const form=document.querySelector("#checkout-form");
  if(form&&!form.querySelector("[name=loyalty_points_to_redeem]")){
    const box=document.createElement("section");box.className="customer-feature-card";box.id="checkout-rewards";
    box.innerHTML='<h3>Rewards for this order</h3><p class="customer-feature-note">Use your points or an available stamp reward at checkout.</p><div class="feature-row"><label>Points to redeem <input name="loyalty_points_to_redeem" type="number" min="0" step="1" value="0" inputmode="numeric"></label><label>Referral code (first order) <input name="referral_code" type="text" maxlength="8" autocomplete="off"></label></div><div class="feature-row"><label><input name="redeem_stamp_reward" type="checkbox"> Redeem available stamp reward</label></div>';
    form.insertBefore(box,form.querySelector('button[type="submit"]')||form.lastElementChild);
  }

  const account=document.querySelector("#customer-account");
  if(account&&!document.querySelector("#customer-settings-open")){
    const button=document.createElement("button");button.id="customer-settings-open";button.type="button";button.className="btn btn-light";button.textContent="Account & rewards";
    document.querySelector("#customer-account-label")?.insertAdjacentElement("afterend",button);
  }
  if(!document.querySelector("#customer-settings-dialog")){
    const overlay=document.createElement("div");overlay.className="customer-settings-overlay";overlay.id="customer-settings-dialog";overlay.hidden=true;
    overlay.innerHTML='<section class="customer-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="customer-settings-title"><header><h2 id="customer-settings-title">Account, rewards & alerts</h2><button id="customer-settings-close" class="btn btn-light" type="button" aria-label="Close account settings">Close</button></header><p id="customer-feature-status" class="customer-feature-note" role="status">Sign in to view rewards and save alert preferences.</p><div id="customer-rewards-summary" hidden></div><hr><h3>Alerts you want to receive</h3><div class="feature-row" id="customer-notification-options"><label><input type="checkbox" data-pref="order_updates" checked> Order updates</label><label><input type="checkbox" data-pref="rider_tracking" checked> Rider tracking</label><label><input type="checkbox" data-pref="promotions"> Promotions</label></div></section>';
    document.body.append(overlay);
  }
  const overlay=document.querySelector("#customer-settings-dialog"),status=document.querySelector("#customer-feature-status");
  const summary=document.querySelector("#customer-rewards-summary"),options=document.querySelector("#customer-notification-options");
  document.querySelector("#customer-settings-open")?.addEventListener("click",()=>{overlay.hidden=false;void load();});
  document.querySelector("#customer-settings-close")?.addEventListener("click",()=>{overlay.hidden=true;});
  overlay?.addEventListener("click",e=>{if(e.target===overlay)overlay.hidden=true;});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&overlay&&!overlay.hidden)overlay.hidden=true;});

  async function load(){
    const {data:{session}}=await db.auth.getSession();
    if(!session?.user){if(status)status.textContent="Sign in to view rewards and set alert choices.";return;}
    const [{data:rewards,error:rewardError},{data:prefs,error:prefsError}]=await Promise.all([
      db.rpc("get_my_loyalty_summary"),
      db.from("customer_notification_preferences").select("order_updates,rider_tracking,promotions").eq("customer_user_id",session.user.id).maybeSingle()
    ]);
    if(prefs&&!prefsError)options?.querySelectorAll("[data-pref]").forEach(el=>el.checked=Boolean(prefs[el.dataset.pref]));
    if(rewardError){if(status)status.textContent="Rewards are available after the optional database migration is applied.";return;}
    if(summary){
      summary.hidden=false;
      summary.innerHTML=rewards.enabled
        ? '<p><strong>'+Number(rewards.points||0)+'</strong> points · <strong>'+Number(rewards.stamps||0)+' / '+Number(rewards.stamps_per_reward||10)+'</strong> stamps toward a reward ('+Number(rewards.stamp_reward_ghs||0)+' GH₵ checkout discount)</p><p>Your referral code: <strong>'+String(rewards.referral_code||"")+'</strong></p><p class="customer-feature-note">Points and stamps are earned after an order is completed. Invite a new customer with your code.</p>'
        : '<p>Loyalty is awaiting restaurant setup. Your referral code: <strong>'+String(rewards.referral_code||"")+'</strong></p>';
    }
    if(status)status.textContent=prefsError?"Alert preferences will save after the optional database migration is applied.":"Your reward balance and alert choices.";
  }
  options?.addEventListener("change",async()=>{
    const {data:{session}}=await db.auth.getSession();if(!session?.user)return;
    const row={customer_user_id:session.user.id,updated_at:new Date().toISOString()};
    options.querySelectorAll("[data-pref]").forEach(el=>row[el.dataset.pref]=el.checked);
    const {error}=await db.from("customer_notification_preferences").upsert(row,{onConflict:"customer_user_id"});
    if(status)status.textContent=error?"Could not save alert choices. Apply the optional database migration and try again.":"Alert choices saved.";
  });
  db.auth.onAuthStateChange(()=>{if(overlay&&!overlay.hidden)setTimeout(()=>void load(),0);});
})();
