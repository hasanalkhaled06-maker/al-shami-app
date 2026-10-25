/* AL SHAMI rider arrival/failure events, GPS freshness, and nearest assigned deliveries. */
(() => {
  "use strict";
  const cfg=window.AL_SHAMI_CONFIG||{};
  if(!window.supabase||!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY)return;
  const db=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{
    auth:{storageKey:"al-shami-rider-auth-v1",persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
  });
  const $=s=>document.querySelector(s), esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const dash=$("#rider-dashboard");if(!dash)return;
  const panel=document.createElement("section");panel.className="location-panel";panel.id="rider-ops-panel";
  panel.style.cssText="display:block;margin:16px 0;padding:18px";
  panel.innerHTML='<div><strong>Delivery check-ins & nearest stops</strong><p id="rider-ops-status" role="status">Loading delivery details…</p><button id="sort-nearest" class="secondary-button" type="button">Sort by nearest from my current position</button></div><div id="rider-ops-list"></div>';
  const anchor=$("#delivery-list");anchor?.parentElement?.insertBefore(panel,anchor);
  const reasonLabels={customer_no_answer:"Customer did not answer",cannot_reach_address:"Could not reach the address",customer_unavailable:"Customer unavailable",unsafe_location:"Unsafe location",other:"Other"};
  let position=null;
  function dist(a,b){const rad=x=>x*Math.PI/180, dlat=rad(b.lat-a.lat),dlng=rad(b.lng-a.lng),h=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlng/2)**2;return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}
  function time(v){if(!v)return "Not recorded";const d=new Date(v);return Number.isNaN(d.getTime())?"Unknown":d.toLocaleString("en-GH",{dateStyle:"short",timeStyle:"short"});}
  let orders=[];
  function render(){
    const sorted=[...orders].sort((a,b)=>{
      if(!position)return new Date(a.created_at)-new Date(b.created_at);
      const da=a.delivery_latitude!==null&&a.delivery_latitude!==undefined&&Number.isFinite(Number(a.delivery_latitude))?dist(position,{lat:Number(a.delivery_latitude),lng:Number(a.delivery_longitude)}):Infinity;
      const dbb=b.delivery_latitude!==null&&b.delivery_latitude!==undefined&&Number.isFinite(Number(b.delivery_latitude))?dist(position,{lat:Number(b.delivery_latitude),lng:Number(b.delivery_longitude)}):Infinity;
      return da-dbb;
    });
    $("#rider-ops-list").innerHTML=sorted.length?sorted.map((o,i)=>{
      const distance=position&&o.delivery_latitude!==null&&o.delivery_latitude!==undefined&&Number.isFinite(Number(o.delivery_latitude))?'<small> · '+dist(position,{lat:Number(o.delivery_latitude),lng:Number(o.delivery_longitude)}).toFixed(1)+' km away</small>':"";
      return '<article class="delivery-card" style="margin:10px 0;padding:12px"><strong>'+(position&&i===0?"Closest · ":"")+'Order #'+esc(o.order_number)+'</strong>'+distance+'<p>'+esc(o.delivery_address||"Delivery location not provided")+'</p><p><small>Last GPS update: '+esc(time(o.gps_updated_at))+'</small></p><p><small>Arrived at restaurant: '+esc(time(o.arrived_at))+' · Left restaurant: '+esc(time(o.left_at))+'</small></p><div class="feature-row"><button class="secondary-button" data-event="arrived_at_restaurant" data-order="'+esc(o.id)+'" '+(o.arrived_at?"disabled":"")+'>Arrived at restaurant</button><button class="secondary-button" data-event="left_restaurant" data-order="'+esc(o.id)+'" '+(o.left_at?"disabled":"")+'>Left restaurant</button><select data-reason="'+esc(o.id)+'"><option value="">Failed delivery reason…</option>'+Object.entries(reasonLabels).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join("")+'</select><button class="secondary-button" data-failed="'+esc(o.id)+'">Record failed attempt</button></div></article>';
    }).join(""):'<p>No active assigned deliveries.</p>';
  }
  async function load(){
    if($("#rider-dashboard")?.hidden)return;
    const {data,error}=await db.rpc("get_my_delivery_ops");
    if(error){$("#rider-ops-status").textContent="Arrival and failed-delivery actions appear after the optional delivery operations migration is applied.";return;}
    orders=Array.isArray(data)?data:[];
    $("#rider-ops-status").textContent=orders.length+" assigned active delivery"+(orders.length===1?"":"ies")+". Last GPS timestamp is shown for each order.";
    render();
  }
  async function record(order,type,reason){
    const {error}=await db.rpc("record_my_delivery_event",{p_order_id:order,p_event_type:type,p_failure_reason:reason||null,p_note:null});
    if(error){$("#rider-ops-status").textContent="Could not record the event: "+(error.message||"check connection");return;}
    $("#rider-ops-status").textContent="Delivery event saved.";
    await load();
  }
  panel.addEventListener("click",async e=>{
    const btn=e.target.closest("button");if(!btn)return;
    if(btn.id==="sort-nearest"){
      if(!navigator.geolocation){$("#rider-ops-status").textContent="This device does not provide GPS.";return;}
      btn.disabled=true;
      navigator.geolocation.getCurrentPosition(p=>{position={lat:p.coords.latitude,lng:p.coords.longitude};btn.disabled=false;btn.textContent="Nearest stops sorted";render();},()=>{btn.disabled=false;$("#rider-ops-status").textContent="Allow location access to sort deliveries by distance.";},{enableHighAccuracy:true,maximumAge:30000,timeout:12000});
      return;
    }
    if(btn.dataset.event){await record(btn.dataset.order,btn.dataset.event,null);return;}
    if(btn.dataset.failed){
      const select=panel.querySelector('[data-reason="'+CSS.escape(btn.dataset.failed)+'"]');
      if(!select?.value){$("#rider-ops-status").textContent="Choose a failed-delivery reason first.";return;}
      await record(btn.dataset.failed,"failed_attempt",select.value);
    }
  });
  db.auth.onAuthStateChange(()=>setTimeout(()=>void load(),0));
  void load();window.setInterval(()=>void load(),30000);
})();
