alter table public.clients add column if not exists passport_code text;
alter table public.rentals add column if not exists contract_details jsonb;
alter table public.rentals add column if not exists return_discount numeric(12,2) check(return_discount>=0);
create table if not exists public.rental_print_templates (
  version text primary key, active boolean not null default false, document jsonb not null
);
create unique index if not exists rental_print_current on public.rental_print_templates(active) where active;
alter table public.rental_print_templates enable row level security;
revoke all on table public.rental_print_templates from public,anon,authenticated;
grant select on table public.rental_print_templates to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='rental_print_templates' and policyname='rental_template_staff') then
    create policy rental_template_staff on public.rental_print_templates for select to authenticated using(public.is_in_role(array['employee','manager','owner']));
  end if;
end $$;
create or replace function public.kk_write_row(entity text, payload jsonb)
returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  allowed text[]; cols text; values_sql text; updates text;
  saved uuid := coalesce((payload->>'id')::uuid,gen_random_uuid());
begin
  allowed := case entity
    when 'clients' then array['legacy_id','full_name','phone','phone2','passport_series','passport_number','passport_code','passport_issued_by','passport_date','birth_date','address','notes','blacklist']
    when 'tools' then array['legacy_id','name','category','inventory_no','serial_no','rental_price','deposit','estimated_value','status','kit','note','description','video_url','service_note']
    when 'employees' then array['legacy_id','full_name','phone','position','active']
    when 'rentals' then array['legacy_id','contract_number','contract_date','client_id','client_name_snapshot','client_phone_snapshot','issue_date','return_date','return_time','actual_return_at','days_count','total_amount','deposit_amount','status','notes','contract_details','return_discount']
    when 'expenses' then array['legacy_id','expense_date','category','amount','note','rental_id']
    when 'timesheet' then array['employee_id','work_date','status']
    else null end;
  if allowed is null then raise exception 'Неизвестная таблица'; end if;
  select string_agg(format('%I',k),',' order by k),
         string_agg(format('rec.%I',k),',' order by k),
         string_agg(format('%I=excluded.%I',k,k),',' order by k)
    into cols,values_sql,updates from unnest(allowed) k where payload ? k;
  if cols is null then raise exception 'Запись не содержит данных'; end if;
  if entity in ('clients','tools','rentals','expenses') then
    cols:=cols||',created_by'; values_sql:=values_sql||',auth.uid()';
  end if;
  execute format('insert into public.%1$I (id,%2$s) select $1,%3$s from jsonb_populate_record(null::public.%1$I,$2) rec on conflict(id) do update set %4$s',entity,cols,values_sql,updates) using saved,payload;
  return saved;
end $$;
notify pgrst,'reload schema';
