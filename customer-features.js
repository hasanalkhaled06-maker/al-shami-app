/* Customer reward checkout controls and private account preferences. */
(() => {
  "use strict";
  const cfg=window.AL_SHAMI_CONFIG||{};
  if(!window.supabase||!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)return;
  const db=window.AL_SHAMI_CUSTOMER_DB||window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{
    auth:{storageKey:"al-shami-customer-auth-v1",persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  });
  const css=document.createElement("style");
  css.textContent=".customer-reward-balance-card{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:16px 0 2px;padding:16px 18px;border:1px solid #ead8b7;border-radius:16px;background:linear-gradient(120deg,#fff8e7,#fffdf8);color:#281a17}.customer-reward-balance-card p{margin:3px 0}.customer-reward-title{font-size:.82rem;font-weight:800;color:#67101a}.customer-reward-balance{font-size:1.15rem}.customer-reward-value{color:#665750;font-size:.9rem}.customer-reward-balance-card button{margin:0}.customer-order-points{margin:10px 0 0;padding:9px 11px;border-radius:9px;background:#f5f1e7;color:#4d3917;font-size:.9rem;font-weight:700}.customer-order-points.is-earned{background:#eaf7ed;color:#17623d}.customer-order-points.is-pending{background:#fff7e8;color:#795317}.customer-points-estimate{margin:5px 0 0;padding:10px 12px;border-radius:10px;background:#f1f8f2;color:#17623d;font-weight:750}.customer-feature-card{margin:16px 0;padding:18px;border:1px solid #e7d9d0;border-radius:16px;background:#fffaf6;color:#281a17}.customer-feature-card h3{margin:0 0 10px}.customer-feature-card .feature-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:9px 0}.customer-feature-card input[type=number],.customer-feature-card input[type=text]{max-width:190px;padding:9px;border:1px solid #c9b9ae;border-radius:8px}.customer-feature-card label{display:inline-flex;gap:7px;align-items:center}.customer-feature-note{font-size:.9em;color:#665750}.customer-settings-overlay[hidden]{display:none!important}.customer-settings-overlay{position:fixed;inset:0;z-index:10020;background:#150d0dd9;display:grid;place-items:center;padding:18px}.customer-settings-dialog{width:min(620px,100%);max-height:85vh;overflow:auto;background:#fff;border-radius:20px;padding:22px;color:#241a18;box-shadow:0 18px 60px #0006}.customer-settings-dialog header{display:flex;align-items:center;justify-content:space-between;gap:12px}.customer-settings-dialog h2{margin:0}.customer-settings-dialog #customer-settings-close{font-size:1.2rem}";
  document.head.append(css);

  const form=document.querySelector("#checkout-form");
  if(form&&!form.querySelector("[name=loyalty_points_to_redeem]")){
    const box=document.createElement("section");box.className="customer-feature-card";box.id="checkout-rewards";
    box.innerHTML='<h3>Rewards for this order</h3><p class="customer-feature-note">Your points and stamp rewards only reduce an order total at checkout. They cannot be withdrawn or paid as cash.</p><p id="checkout-points-estimate" class="customer-points-estimate" role="status" aria-live="polite"></p><div class="feature-row"><label>Points to use as order discount <input name="loyalty_points_to_redeem" type="number" min="0" step="1" value="0" inputmode="numeric"></label><label>Referral code (first order) <input name="referral_code" type="text" maxlength="8" autocomplete="off"></label></div><div class="feature-row"><label><input name="redeem_stamp_reward" type="checkbox"> Redeem available stamp reward</label></div>';
    form.insertBefore(box,form.querySelector('button[type="submit"]')||form.lastElementChild);
  }

  const homeGrid=document.querySelector(".customer-home-grid");
  if(homeGrid&&!document.querySelector("#customer-rewards-home")){
    const rewardsCard=document.createElement("section");
    rewardsCard.className="customer-reward-balance-card";
    rewardsCard.id="customer-rewards-home";
    rewardsCard.setAttribute("aria-live","polite");
    rewardsCard.innerHTML='<div><p class="customer-reward-title" id="customer-reward-home-title">My points</p><p class="customer-reward-balance"><strong id="customer-home-points">—</strong> <span id="customer-home-points-label">points</span></p><p class="customer-reward-value" id="customer-home-points-value">Your balance appears here.</p></div><button id="customer-home-rewards-open" class="btn btn-light" type="button">View rewards</button>';
    homeGrid.insertAdjacentElement("afterend",rewardsCard);
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
  document.querySelector("#customer-home-rewards-open")?.addEventListener("click",()=>{if(overlay){overlay.hidden=false;void load();}});
  document.querySelector("#customer-settings-close")?.addEventListener("click",()=>{overlay.hidden=true;});
  overlay?.addEventListener("click",e=>{if(e.target===overlay)overlay.hidden=true;});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&overlay&&!overlay.hidden)overlay.hidden=true;});

  let loyaltySettings=null;
  const language=()=>document.querySelector("#language")?.value||"en";
  const pointWords={
    en:{title:"My points",points:"points",value:"Store credit value: GH₵ ",view:"View rewards",notReady:"Your points balance will appear here when rewards are enabled.",disabled:"Rewards are not active yet.",estimate:"This order will earn {points} points (about GH₵ {value}) after completion.",estimateDisabled:"Rewards are not active yet, so this order will not earn points.",pending:"Expected points after completion: +{points}",earned:"Points earned from this order: +{points}",rejected:"No points were earned for this order."},
    ar:{title:"نقاطي",points:"نقطة",value:"قيمتها للخصم: GH₵ ",view:"تفاصيل النقاط",notReady:"رح يظهر رصيد نقاطك بعد تفعيل المكافآت.",disabled:"المكافآت غير مفعّلة حالياً.",estimate:"رح تكسب من هالطلب {points} نقطة (تعادل تقريباً GH₵ {value}) بعد اكتماله.",estimateDisabled:"المكافآت غير مفعّلة حالياً، لذلك لن يكسب هذا الطلب نقاطاً.",pending:"النقاط المتوقعة بعد اكتمال الطلب: +{points}",earned:"النقاط المكتسبة من هالطلب: +{points}",rejected:"ما تم كسب نقاط لهذا الطلب."},
    tw:{title:"Me nhyɛnsode",points:"points",value:"Store credit value: GH₵ ",view:"Hwɛ rewards",notReady:"Wo points bɛba ha bere a wɔbue rewards no.",disabled:"Rewards no nni hɔ seesei.",estimate:"Sɛ wɔwie order yi a, wubenya points {points} (ɛyɛ GH₵ {value}).",estimateDisabled:"Rewards no nni hɔ seesei, enti order yi rennya points.",pending:"Points a wubenya bere a wɔawie: +{points}",earned:"Points a wunyae fii order yi mu: +{points}",rejected:"Wɔannya points wɔ order yi mu."}
  };
  const words=()=>pointWords[language()]||pointWords.en;
  function formatGhs(value){return Number(value||0).toFixed(2);}
  function currentCartSubtotal(){
    const text=document.querySelector("#cart-subtotal")?.textContent||"";
    const value=Number(text.replace(/[^0-9.,-]/g,"").replace(/,/g,""));
    return Number.isFinite(value)?Math.max(0,value):0;
  }
  function pointsForSubtotal(subtotal){
    if(!loyaltySettings?.enabled)return 0;
    return Math.floor(Math.max(0,Number(subtotal)||0)*loyaltySettings.pointsPerGhs);
  }
  function refreshPointDisplays(){
    const t=words();
    const balance=document.querySelector("#customer-home-points");
    const balanceLabel=document.querySelector("#customer-home-points-label");
    const balanceValue=document.querySelector("#customer-home-points-value");
    const title=document.querySelector("#customer-reward-home-title");
    const button=document.querySelector("#customer-home-rewards-open");
    if(title)title.textContent=t.title;
    if(button)button.textContent=t.view;
    if(!loyaltySettings){
      if(balance)balance.textContent="—";
      if(balanceLabel)balanceLabel.textContent=t.points;
      if(balanceValue)balanceValue.textContent=t.notReady;
    }else if(!loyaltySettings.enabled){
      if(balance)balance.textContent=String(loyaltySettings.points);
      if(balanceLabel)balanceLabel.textContent=t.points;
      if(balanceValue)balanceValue.textContent=t.disabled;
    }else{
      if(balance)balance.textContent=String(loyaltySettings.points);
      if(balanceLabel)balanceLabel.textContent=t.points;
      if(balanceValue)balanceValue.textContent=t.value+formatGhs(loyaltySettings.points/loyaltySettings.pointsPerGhsRedeemed);
    }
    const estimate=document.querySelector("#checkout-points-estimate");
    if(estimate){
      if(!loyaltySettings)estimate.textContent=t.notReady;
      else if(!loyaltySettings.enabled)estimate.textContent=t.estimateDisabled;
      else{
        const points=pointsForSubtotal(currentCartSubtotal());
        estimate.textContent=t.estimate.replace("{points}",String(points)).replace("{value}",formatGhs(points/loyaltySettings.pointsPerGhsRedeemed));
      }
    }
    document.querySelectorAll("#customer-order-history .customer-order-card[data-order-subtotal]").forEach(card=>{
      let note=card.querySelector(".customer-order-points");
      if(!loyaltySettings||!loyaltySettings.enabled){note?.remove();return;}
      const state=card.dataset.orderStatus||"";
      const message=state==="rejected"
        ? t.rejected
        : (state==="completed"?t.earned:t.pending).replace("{points}",String(pointsForSubtotal(card.dataset.orderSubtotal)));
      if(!note){
        note=document.createElement("p");
        note.className="customer-order-points";
        const meta=card.querySelector(".tracked-order-meta");
        (meta||card).insertAdjacentElement("afterend",note);
      }
      note.classList.toggle("is-earned",state==="completed");
      note.classList.toggle("is-pending",state!=="completed"&&state!=="rejected");
      if(note.textContent!==message)note.textContent=message;
    });
  }
  const cartSubtotalNode=document.querySelector("#cart-subtotal");
  if(cartSubtotalNode)new MutationObserver(refreshPointDisplays).observe(cartSubtotalNode,{childList:true,subtree:true,characterData:true});
  document.querySelector("#language")?.addEventListener("change",refreshPointDisplays);
  const orderList=document.querySelector("#customer-order-history");
  if(orderList)new MutationObserver(refreshPointDisplays).observe(orderList,{childList:true,subtree:true});
  document.querySelector("#checkout-form")?.addEventListener("input",refreshPointDisplays);
  refreshPointDisplays();

  async function load(){
    const {data:{session}}=await db.auth.getSession();
    if(!session?.user){if(status)status.textContent="Sign in to view rewards and set alert choices.";return;}
    const [{data:rewards,error:rewardError},{data:prefs,error:prefsError}]=await Promise.all([
      db.rpc("get_my_loyalty_summary"),
      db.from("customer_notification_preferences").select("order_updates,rider_tracking,promotions").eq("customer_user_id",session.user.id).maybeSingle()
    ]);
    if(prefs&&!prefsError)options?.querySelectorAll("[data-pref]").forEach(el=>el.checked=Boolean(prefs[el.dataset.pref]));
    if(rewardError){loyaltySettings=null;window.AL_SHAMI_LOYALTY_SETTINGS=null;refreshPointDisplays();if(status)status.textContent="Rewards are available after the optional database migration is applied.";return;}
    loyaltySettings={enabled:Boolean(rewards.enabled),points:Number(rewards.points||0),pointsPerGhs:Number(rewards.points_per_ghs||0),pointsPerGhsRedeemed:Math.max(1,Number(rewards.points_per_ghs_redeemed||100))};
    window.AL_SHAMI_LOYALTY_SETTINGS=loyaltySettings;
    window.dispatchEvent(new Event("alshami:loyalty-settings"));
    refreshPointDisplays();
    if(summary){
      summary.hidden=false;
      summary.innerHTML=rewards.enabled
        ? '<p><strong>'+Number(rewards.points||0)+'</strong> points · <strong>'+Number(rewards.stamps||0)+' / '+Number(rewards.stamps_per_reward||10)+'</strong> stamps toward a reward ('+Number(rewards.stamp_reward_ghs||0)+' GH₵ checkout discount)</p><p>Your referral code: <strong>'+String(rewards.referral_code||"")+'</strong></p><p class="customer-feature-note">Points become store credit for order discounts only; there is no cash withdrawal. They’re earned after completed orders.</p>'
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
  db.auth.onAuthStateChange(()=>{setTimeout(()=>void load(),0);});
  void load();
})();
