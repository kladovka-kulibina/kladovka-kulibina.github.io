begin;
alter table public.tools add column if not exists location text;
alter table public.tools add column if not exists archived boolean not null default false;
create table if not exists public.staff_notes (
  id text primary key check (id in ('rules','duties')),
  body text not null default '', revision int not null default 0
);
alter table public.staff_notes enable row level security;
insert into public.staff_notes(id) values ('rules'),('duties') on conflict do nothing;
revoke all on public.staff_notes from public, anon, authenticated;
grant select, update(body,revision) on public.staff_notes to authenticated;
drop policy if exists notes_read on public.staff_notes;
drop policy if exists notes_edit on public.staff_notes;
create policy notes_read on public.staff_notes for select to authenticated
  using (public.is_in_role(array['owner','manager','employee']));
create policy notes_edit on public.staff_notes for update to authenticated
  using (public.is_owner()) with check (public.is_owner());

create or replace function public.kk_archive_tool(tool uuid, expected timestamptz)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if not public.is_manager_or_owner() then raise exception 'Недостаточно прав'; end if;
  perform pg_advisory_xact_lock(22857501);
  if exists (select from public.rental_items i join public.rentals r on r.id=i.rental_id
             where i.tool_id=tool and r.status='active') then raise exception 'Сначала оформите возврат инструмента'; end if;
  update public.tools set archived=true,status='retired' where id=tool and updated_at=expected and not archived;
  if not found then raise exception 'Карточка изменилась. Откройте её ещё раз.'; end if;
end $$;
create or replace function public.kk_publish_template(previous_version text, new_document jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare next_version text := gen_random_uuid()::text;
begin
  if not public.is_owner() then raise exception 'Редактировать бланк может владелец'; end if;
  if jsonb_typeof(new_document->'paragraphs') is distinct from 'array'
     or jsonb_array_length(new_document->'paragraphs')<>75
     or jsonb_typeof(new_document->'footer') is distinct from 'string'
     or octet_length(new_document::text)>300000 then raise exception 'Некорректный бланк'; end if;
  update public.rental_print_templates set active=false where active and version=previous_version;
  if not found then raise exception 'Бланк уже изменён. Откройте его ещё раз.'; end if;
  insert into public.rental_print_templates(version,active,document) values(next_version,true,new_document);
  return next_version;
end $$;
revoke all on function public.kk_publish_template(text,jsonb),public.kk_archive_tool(uuid,timestamptz) from public,anon;
grant execute on function public.kk_publish_template(text,jsonb),public.kk_archive_tool(uuid,timestamptz) to authenticated;
create table if not exists public.cash_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  kind text not null check (kind in ('receipt','refund')),
  amount numeric(12,2) not null check (amount>0),
  rental_id uuid references public.rentals(id) on delete set null,
  note text not null default ''
);
alter table public.cash_entries enable row level security;
revoke all on public.cash_entries from public,anon,authenticated;
grant select,insert on public.cash_entries to authenticated;
drop policy if exists cash_read on public.cash_entries;
drop policy if exists cash_insert on public.cash_entries;
create policy cash_read on public.cash_entries for select to authenticated using (public.is_manager_or_owner());
create policy cash_insert on public.cash_entries for insert to authenticated with check (public.is_manager_or_owner());
create or replace function public.kk_restore_workspace(pack jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare active_version text;
begin
  if not public.is_owner() then raise exception 'Требуются права владельца'; end if;
  perform public.kk_restore_backup(pack);
  update public.tools t set location=case when p ? 'location' then p->>'location' else t.location end,
    archived=coalesce((p->>'archived')::boolean,t.archived)
    from jsonb_array_elements(pack->'tools') p where t.id=(p->>'id')::uuid and (p ? 'location' or p ? 'archived');
  insert into public.cash_entries(id,entry_date,kind,amount,rental_id,note)
    select e.id,e.entry_date,e.kind,e.amount,e.rental_id,coalesce(e.note,'')
    from jsonb_populate_recordset(null::public.cash_entries,pack->'cash_entries') e on conflict(id) do nothing;
  update public.staff_notes n set body=p->>'body',revision=n.revision+1
    from jsonb_array_elements(pack->'staff_notes') p where n.id=p->>'id';
  insert into public.rental_print_templates(version,active,document)
    select p->>'version',false,p->'document' from jsonb_array_elements(pack->'templates') p on conflict(version) do nothing;
  if jsonb_array_length(coalesce(pack->'templates','[]'::jsonb))>0 then
    select p->>'version' into strict active_version from jsonb_array_elements(pack->'templates') p where (p->>'active')::boolean;
    update public.rental_print_templates set active=false where active;
    update public.rental_print_templates set active=true where version=active_version;
  end if;
end $$;
revoke all on function public.kk_restore_workspace(jsonb) from public,anon;
grant execute on function public.kk_restore_workspace(jsonb) to authenticated;

create or replace function public.kk_cash_sheet_month(month_start date)
returns table(day date,income numeric,expense numeric)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_manager_or_owner() or to_regclass('kk_sheet_private.tabs') is null then return; end if;
  return query with rows as (
    select r->1 as cells from kk_sheet_private.tabs cross join lateral jsonb_array_elements(sheet_rows) r where name='выручка'
  ), values_by_day as (
    select case when cells->'1'->>'v' ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}(T|$)' then left(cells->'1'->>'v',10)::date end as d,
      case when cells->'2'->>'v' ~ '^-?[0-9]+([.][0-9]+)?$' then (cells->'2'->>'v')::numeric else 0 end as inc,
      case when cells->'3'->>'v' ~ '^-?[0-9]+([.][0-9]+)?$' then (cells->'3'->>'v')::numeric else 0 end as exp
    from rows
  ) select d,sum(inc),sum(exp) from values_by_day where d>=month_start and d<month_start+interval '1 month'
    and (inc<>0 or exp<>0) group by d order by d;
end $$;
revoke all on function public.kk_cash_sheet_month(date) from public,anon;
grant execute on function public.kk_cash_sheet_month(date) to authenticated;

do $$ begin
  if to_regclass('kk_sheet_private.tabs') is not null then
    with tasks as (select (r->>0)::int as n,trim(r->1->'3'->>'v') as task from kk_sheet_private.tabs
      cross join lateral jsonb_array_elements(sheet_rows) r where name='Должност инструкция'),
    sections as (select string_agg(case when n=4 then 'Рабочая смена'||chr(10) when n=21 then chr(10)||'Выдача инструмента'||chr(10)
      when n=31 then chr(10)||'Возврат инструмента'||chr(10) else '' end||'• '||task,chr(10) order by n) as body
      from tasks where (n between 4 and 17 or n between 21 and 28 or n between 31 and 35) and task<>'')
    update public.staff_notes n set body=s.body,revision=1 from sections s where n.id='duties' and n.revision=0 and s.body is not null;
  end if;
  with rules as (select string_agg(p,chr(10)||chr(10) order by ord) as body from public.rental_print_templates t
    cross join lateral jsonb_array_elements_text(t.document->'paragraphs') with ordinality parts(p,ord) where t.active and ord between 44 and 49)
  update public.staff_notes n set body=r.body,revision=1 from rules r where n.id='rules' and n.revision=0 and r.body is not null;
end $$;
notify pgrst,'reload schema';
commit;
