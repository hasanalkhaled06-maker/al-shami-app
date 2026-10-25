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
  css.textContent += ".customer-delivery-complete-modal[hidden]{display:none!important}.customer-delivery-complete-modal{position:fixed;inset:0;z-index:10050;display:grid;place-items:center;padding:18px;background:rgba(26,11,13,.74);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)}.customer-delivery-complete-card{width:min(500px,100%);max-height:88vh;overflow:auto;padding:24px;border:1px solid #ead8b7;border-top:5px solid #caa45e;border-radius:22px;background:#fffdf8;color:#281a17;box-shadow:0 22px 70px #0006}.customer-delivery-complete-card h2{margin:0 0 9px;color:#641622}.customer-delivery-complete-card p{line-height:1.5}.customer-delivery-complete-earned{padding:12px;border-radius:12px;background:#eaf7ed;color:#17623d;font-weight:850}.customer-delivery-complete-balance{color:#665750;font-weight:700}.customer-service-stars{display:flex;gap:8px;margin:12px 0}.customer-service-stars button{min-width:48px;min-height:48px;border:1px solid #d7c6a2;border-radius:12px;background:#fff8e7;color:#8a6828;font-size:28px;cursor:pointer}.customer-service-stars button[aria-pressed=true]{background:#e8c677;color:#4d3510;border-color:#bd9344}.customer-service-review-label{display:block;margin:14px 0 6px;font-weight:800}.customer-service-review-text{box-sizing:border-box;width:100%;min-height:90px;padding:11px;border:1px solid #d8cfc5;border-radius:10px;font:inherit;resize:vertical}.customer-delivery-complete-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.customer-delivery-complete-actions button{flex:1 1 140px;min-height:46px;margin:0}.customer-service-review-message{min-height:1.4em;color:#17623d;font-weight:700}@media(max-width:480px){.customer-delivery-complete-card{padding:19px;border-radius:18px}.customer-service-stars button{min-width:44px;min-height:44px}}";
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
  const completionModal=document.createElement("div");
  completionModal.id="customer-delivery-complete-modal";
  completionModal.className="customer-delivery-complete-modal";
  completionModal.hidden=true;
  completionModal.innerHTML='<section class="customer-delivery-complete-card" role="dialog" aria-modal="true" aria-labelledby="delivery-complete-title"><p class="customer-reward-title">AL SHAMI · ORDER COMPLETE</p><h2 id="delivery-complete-title"></h2><p id="delivery-complete-description"></p><p id="delivery-complete-earned" class="customer-delivery-complete-earned"></p><p id="delivery-complete-balance" class="customer-delivery-complete-balance"></p><hr><h3 id="customer-service-review-title"></h3><p id="customer-service-review-prompt"></p><div class="customer-service-stars" role="group" aria-label="Rate your experience"><button type="button" data-service-rating="1" aria-pressed="false" aria-label="1 star">★</button><button type="button" data-service-rating="2" aria-pressed="false" aria-label="2 stars">★</button><button type="button" data-service-rating="3" aria-pressed="false" aria-label="3 stars">★</button><button type="button" data-service-rating="4" aria-pressed="false" aria-label="4 stars">★</button><button type="button" data-service-rating="5" aria-pressed="false" aria-label="5 stars">★</button></div><label id="customer-service-review-label" class="customer-service-review-label" for="customer-service-review-text"></label><textarea id="customer-service-review-text" class="customer-service-review-text" maxlength="1000"></textarea><p id="customer-service-review-message" class="customer-service-review-message" role="status" aria-live="polite"></p><div class="customer-delivery-complete-actions"><button id="customer-service-review-submit" class="btn btn-primary" type="button"></button><button id="customer-service-review-later" class="btn btn-light" type="button"></button></div></section>';
  document.body.append(completionModal);

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

  const completionQueue=[];
  const completionHandled=new Set();
  let activeCompletion=null;
  let selectedServiceRating=0;
  let serviceReviewSaved=false;
  const completionWords={
    en:{deliveryTitle:"Delivery completed!",pickupTitle:"Pickup completed!",deliveryText:"Your order #{number} was delivered and confirmed.",pickupText:"Your order #{number} was collected and confirmed.",earned:"You earned +{points} points. They have been added to your balance.",noPoints:"This order is complete, but points are not enabled for this account.",balance:"Your new balance: {points} points · about GH₵ {value}",ratingTitle:"Rate AL SHAMI",ratingPrompt:"How was the restaurant and service?",ratingLabel:"Tell us more (optional)",ratingPlaceholder:"Share your experience…",send:"Send rating",later:"Later",done:"Done",thanks:"Thank you for rating AL SHAMI!",choose:"Choose a star rating first.",saveError:"Could not save your rating. Apply the customer service review setup, then try again."},
    ar:{deliveryTitle:"تم إتمام التسليم!",pickupTitle:"تم تأكيد استلام طلبك!",deliveryText:"تم تسليم طلبك رقم {number} وتأكيده.",pickupText:"تم استلام طلبك رقم {number} وتأكيده.",earned:"كسبت +{points} نقطة، وانضافت لرصيدك.",noPoints:"اكتمل الطلب، لكن النقاط غير مفعّلة لهذا الحساب.",balance:"رصيدك الجديد: {points} نقطة · تعادل تقريباً GH₵ {value}",ratingTitle:"قيّم مطعم الشامي",ratingPrompt:"كيف كانت تجربتك مع المطعم والخدمة؟",ratingLabel:"اكتب لنا ملاحظتك (اختياري)",ratingPlaceholder:"شاركنا تجربتك…",send:"إرسال التقييم",later:"لاحقاً",done:"تم",thanks:"شكراً لتقييمك مطعم الشامي!",choose:"اختار عدد النجوم أولاً.",saveError:"ما قدرنا نحفظ تقييمك. لازم تفعيل إعداد تقييم الخدمة أولاً."},
    tw:{deliveryTitle:"Wɔawie de aduan no abrɛ wo!",pickupTitle:"Wɔagye aduan no!",deliveryText:"Wɔde wo order #{number} abrɛ wo na wɔasi so dua.",pickupText:"Wɔagye wo order #{number} na wɔasi so dua.",earned:"Woanya points +{points}, na wɔde aka wo points ho.",noPoints:"Order no awie, nanso points no nni hɔ ma account yi.",balance:"Wo points nyinaa: {points} · ɛyɛ GH₵ {value}",ratingTitle:"Ma AL SHAMI rating",ratingPrompt:"Restaurant ne service no yɛɛ dɛn?",ratingLabel:"Ka wo adwene (ɛnyɛ mmara)",ratingPlaceholder:"Ka wo suahu…",send:"Fa rating no kɔ",later:"Akyiri",done:"Ewie",thanks:"Yɛda wo ase sɛ wode rating maa AL SHAMI!",choose:"Paw star rating ansa.",saveError:"Yentumi ansie wo rating. Ma customer service review setup no nyɛ adwuma."}
  };
  function completionText(){return completionWords[language()]||completionWords.en;}
  function closeCompletionModal(){
    completionModal.hidden=true;
    activeCompletion=null;
    selectedServiceRating=0;
    serviceReviewSaved=false;
    completionQueueMicrotask();
  }
  function completionQueueMicrotask(){window.setTimeout(showNextDeliveryCompletion,0);}
  async function showNextDeliveryCompletion(){
    if(activeCompletion||!completionQueue.length)return;
    activeCompletion=completionQueue.shift();
    selectedServiceRating=0;
    serviceReviewSaved=false;
    const detail=activeCompletion;
    await load();
    const t=completionText();
    const completedTitle=document.querySelector("#delivery-complete-title");
    const description=document.querySelector("#delivery-complete-description");
    const earnedNode=document.querySelector("#delivery-complete-earned");
    const balanceNode=document.querySelector("#delivery-complete-balance");
    const ratingTitle=document.querySelector("#customer-service-review-title");
    const ratingPrompt=document.querySelector("#customer-service-review-prompt");
    const ratingLabel=document.querySelector("#customer-service-review-label");
    const reviewText=document.querySelector("#customer-service-review-text");
    const reviewMessage=document.querySelector("#customer-service-review-message");
    const submit=document.querySelector("#customer-service-review-submit");
    const later=document.querySelector("#customer-service-review-later");
    const earnedPoints=pointsForSubtotal(detail.subtotal);
    if(completedTitle)completedTitle.textContent=detail.orderType==="pickup"?t.pickupTitle:t.deliveryTitle;
    if(description)description.textContent=(detail.orderType==="pickup"?t.pickupText:t.deliveryText).replace("{number}",String(detail.orderNumber||""));
    if(earnedNode)earnedNode.textContent=loyaltySettings?.enabled?t.earned.replace("{points}",String(earnedPoints)):t.noPoints;
    if(balanceNode)balanceNode.textContent=loyaltySettings?.enabled?t.balance.replace("{points}",String(loyaltySettings.points)).replace("{value}",formatGhs(loyaltySettings.points/loyaltySettings.pointsPerGhsRedeemed)):"";
    if(ratingTitle)ratingTitle.textContent=t.ratingTitle;
    if(ratingPrompt)ratingPrompt.textContent=t.ratingPrompt;
    if(ratingLabel)ratingLabel.textContent=t.ratingLabel;
    if(reviewText)reviewText.placeholder=t.ratingPlaceholder;
    if(reviewMessage)reviewMessage.textContent="";
    if(submit){submit.textContent=t.send;submit.disabled=false}
    if(later){later.textContent=t.later}
    completionModal.querySelectorAll("[data-service-rating]").forEach(button=>{button.setAttribute("aria-pressed","false")});
    if(reviewText)reviewText.value="";
    completionModal.hidden=false;
  }
  function showDeliveryCompletion(detail){
    const token=String(detail?.trackingToken||"");
    if(!token||completionHandled.has(token)||!detail.orderId)return;
    completionHandled.add(token);
    completionQueue.push(detail);
    void showNextDeliveryCompletion();
  }
  window.AL_SHAMI_SHOW_DELIVERY_COMPLETE=showDeliveryCompletion;
  (window.AL_SHAMI_PENDING_DELIVERY_COMPLETIONS||[]).splice(0).forEach(showDeliveryCompletion);
  completionModal.querySelector(".customer-service-stars")?.addEventListener("click",event=>{
    const button=event.target instanceof Element?event.target.closest("[data-service-rating]"):null;
    if(!button)return;
    selectedServiceRating=Number(button.dataset.serviceRating||0);
    completionModal.querySelectorAll("[data-service-rating]").forEach(star=>{
      const value=Number(star.dataset.serviceRating||0);
      star.setAttribute("aria-pressed",value<=selectedServiceRating?"true":"false");
    });
    const message=document.querySelector("#customer-service-review-message");
    if(message)message.textContent="";
  });
  document.querySelector("#customer-service-review-later")?.addEventListener("click",closeCompletionModal);
  document.querySelector("#customer-service-review-submit")?.addEventListener("click",async()=>{
    const t=completionText();
    const message=document.querySelector("#customer-service-review-message");
    const submit=document.querySelector("#customer-service-review-submit");
    const later=document.querySelector("#customer-service-review-later");
    if(serviceReviewSaved){closeCompletionModal();return;}
    if(!activeCompletion||!selectedServiceRating){if(message)message.textContent=t.choose;return;}
    const {data:{session}}=await db.auth.getSession();
    if(!session?.user){if(message)message.textContent="Sign in again to send your rating.";return;}
    if(submit)submit.disabled=true;
    const {error}=await db.rpc("submit_customer_service_review",{
      p_order_id:activeCompletion.orderId,
      p_rating:selectedServiceRating,
      p_review_text:document.querySelector("#customer-service-review-text")?.value||""
    });
    if(error){
      if(message)message.textContent=t.saveError;
      if(submit)submit.disabled=false;
      return;
    }
    serviceReviewSaved=true;
    if(message)message.textContent=t.thanks;
    if(submit){submit.textContent=t.done;submit.disabled=false}
    if(later)later.textContent=t.done;
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&!completionModal.hidden)closeCompletionModal();
  });

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
