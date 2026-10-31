
-- Accurate cash shift reconciliation for this cash-only order workflow.
-- Keep a single open drawer shift so order and cash-expense totals cannot overlap.
create unique index if not exists cash_shifts_single_open_shift_idx
  on public.cash_shifts(status) where status = 'open';

create or replace function public.close_cash_shift(
  p_shift_id uuid,
  p_counted_cash numeric,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_opened_at timestamptz;
  v_closed_at timestamptz := now();
  v_opening_cash numeric(12,2);
  v_sales numeric(12,2) := 0;
  v_cash_expenses numeric(12,2) := 0;
  v_expected_cash numeric(12,2);
  v_difference numeric(12,2);
begin
  if not public.is_current_user_admin() then
    raise exception 'Not authorised.';
  end if;

  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'Counted cash cannot be negative.';
  end if;

  select opened_at, opening_cash
    into v_opened_at, v_opening_cash
  from public.cash_shifts
  where id = p_shift_id and status = 'open'
  for update;

  if not found then
    raise exception 'Open shift not found.';
  end if;

  -- In this version orders are cash-only; a completed order is counted as a cash sale
  -- when its status was last changed to completed during this shift.
  select coalesce(sum(total), 0)
    into v_sales
  from public.orders
  where status = 'completed'
    and updated_at >= v_opened_at
    and updated_at <= v_closed_at;

  select coalesce(sum(amount), 0)
    into v_cash_expenses
  from public.expenses
  where payment_method = 'cash'
    and created_at >= v_opened_at
    and created_at <= v_closed_at;

  v_expected_cash := v_opening_cash + v_sales - v_cash_expenses;
  v_difference := p_counted_cash - v_expected_cash;

  update public.cash_shifts
  set closed_by = auth.uid(),
      closed_at = v_closed_at,
      expected_cash = v_expected_cash,
      counted_cash = p_counted_cash,
      difference = v_difference,
      notes = coalesce(nullif(trim(coalesce(p_notes,'')), ''), notes),
      status = 'closed'
  where id = p_shift_id and status = 'open'
  returning id into v_id;

  if v_id is null then
    raise exception 'Open shift not found.';
  end if;

  insert into public.audit_log(
    actor_id, action, entity_type, entity_id, details
  )
  values(
    auth.uid(),
    'cash_shift_closed',
    'cash_shift',
    v_id::text,
    jsonb_build_object(
      'opening_cash', v_opening_cash,
      'completed_cash_sales', v_sales,
      'cash_expenses', v_cash_expenses,
      'expected_cash', v_expected_cash,
      'counted_cash', p_counted_cash,
      'difference', v_difference
    )
  );

  return v_id;
end;
$$;

revoke all on function public.close_cash_shift(uuid,numeric,text) from public;
grant execute on function public.close_cash_shift(uuid,numeric,text) to authenticated;
