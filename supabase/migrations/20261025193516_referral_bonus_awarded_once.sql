begin;
alter table public.customer_referrals
  add column if not exists bonus_awarded_at timestamptz;

create or replace function public.al_shami_award_customer_loyalty()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cfg public.customer_loyalty_settings%rowtype;
  v_points integer;
  v_referrer uuid;
begin
  if new.status='completed'
     and (tg_op='INSERT' or old.status is distinct from new.status)
     and new.customer_user_id is not null then
    select * into v_cfg from public.customer_loyalty_settings where id=1;
    if coalesce(v_cfg.enabled,false) then
      v_points:=floor(greatest(0,new.subtotal)*v_cfg.points_per_ghs)::integer;
      if v_points>0 then
        insert into public.customer_loyalty_ledger(customer_user_id,order_id,entry_type,amount,reason)
        values(new.customer_user_id,new.id,'points',v_points,'completed_order')
        on conflict do nothing;
      end if;
      insert into public.customer_loyalty_ledger(customer_user_id,order_id,entry_type,amount,reason)
      values(new.customer_user_id,new.id,'stamp',1,'completed_order')
      on conflict do nothing;

      if v_cfg.referral_bonus_points>0 then
        update public.customer_referrals
          set bonus_awarded_at=now()
          where referred_user_id=new.customer_user_id
            and bonus_awarded_at is null
          returning referrer_user_id into v_referrer;
        if found then
          insert into public.customer_loyalty_ledger(customer_user_id,order_id,entry_type,amount,reason)
          values(v_referrer,new.id,'points',v_cfg.referral_bonus_points,'referral_completed_order')
          on conflict do nothing;
        end if;
      end if;
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.al_shami_award_customer_loyalty() from public, anon, authenticated;
commit;
