create schema if not exists kk_sheet_private;
revoke all on schema kk_sheet_private from public, anon, authenticated;

create table if not exists kk_sheet_private.state (
  singleton boolean primary key check (singleton), key_hash text, file_hash text,
  checked_at timestamptz, changed_at timestamptz, archive bytea,
  manifest jsonb not null default '[]', review jsonb not null default '[]'
);
insert into kk_sheet_private.state(singleton) values(true) on conflict do nothing;
create table if not exists kk_sheet_private.tabs (name text primary key, sheet_rows jsonb not null);
create table if not exists kk_sheet_private.mapping (
  tool_id uuid primary key references public.tools(id) on delete cascade, line int not null, fields jsonb not null
);
alter table kk_sheet_private.state enable row level security;
alter table kk_sheet_private.tabs enable row level security;
alter table kk_sheet_private.mapping enable row level security;
revoke all on all tables in schema kk_sheet_private from public, anon, authenticated;

create or replace function kk_sheet_private.verify_key(access_key text)
returns void language plpgsql stable set search_path='' as $$
begin
  if not exists (select 1 from kk_sheet_private.state where key_hash=encode(sha256(convert_to(access_key,'UTF8')),'hex')) then
    raise exception 'Access denied' using errcode='42501';
  end if;
end $$;

create or replace function public.kk_sheet_check(access_key text,file_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_hash text;
begin
  perform kk_sheet_private.verify_key(access_key);
  if file_hash is null or file_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid digest'; end if;
  select s.file_hash into current_hash from kk_sheet_private.state s for update;
  if current_hash=file_hash then update kk_sheet_private.state set checked_at=clock_timestamp() where singleton; end if;
  return jsonb_build_object('same',coalesce(current_hash=file_hash,false),'previous',current_hash);
end $$;

create or replace function kk_sheet_private.identity_text(input text)
returns text language sql immutable as $$ select nullif(lower(trim(input)),'') $$;

create or replace function kk_sheet_private.serial_text(input text)
returns text language sql immutable as $$
  select case when lower(trim(input)) in ('б/н','бн','без номера','нет','-','—','n/a') then null else kk_sheet_private.identity_text(input) end
$$;

create or replace function public.kk_sheet_import(access_key text,expected_hash text,file_hash text,archive text,sheets jsonb,products jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  prior text; original bytea; tab jsonb; item jsonb; incoming jsonb; previous jsonb; patch jsonb;
  old_tool public.tools; new_tool public.tools; candidate_ids uuid[]; claimed uuid[]:='{}';
  pick uuid; ln int; field text; new_count int:=0; v_manifest jsonb:='[]'; v_review jsonb:='[]';
begin
  perform kk_sheet_private.verify_key(access_key);
  select s.file_hash into prior from kk_sheet_private.state s where singleton for update;
  if prior=file_hash then return jsonb_build_object('added',0,'review',0); end if;
  if prior is distinct from expected_hash then raise exception 'Source version changed, retry'; end if;
  original:=decode(archive,'base64');
  if file_hash is null or original is null or octet_length(original)>18874368 or encode(sha256(original),'hex')<>file_hash or
     jsonb_typeof(sheets) is distinct from 'array' or jsonb_array_length(sheets)=0 or jsonb_typeof(products) is distinct from 'array'
    then raise exception 'Invalid workbook'; end if;

  for tab in select value from jsonb_array_elements(sheets) loop
    if nullif(tab->>'name','') is null or jsonb_typeof(tab->'rows') is distinct from 'array' then raise exception 'Invalid sheet'; end if;
    insert into kk_sheet_private.tabs values(tab->>'name',tab->'rows')
      on conflict(name) do update set sheet_rows=excluded.sheet_rows;
    v_manifest:=v_manifest||jsonb_build_array((tab-'rows')||jsonb_build_object('count',jsonb_array_length(tab->'rows')));
  end loop;
  delete from kk_sheet_private.tabs t where not exists (select 1 from jsonb_array_elements(v_manifest) s where s->>'name'=t.name);

  for item in select value from jsonb_array_elements(products) loop
    incoming:=item->'fields'; ln:=(item->>'line')::int;
    if nullif(trim(incoming->>'name'),'') is null then raise exception 'Catalog name missing'; end if;
    with raw as (
      select t.id,m.line,
        kk_sheet_private.identity_text(coalesce(m.fields->>'name',t.name)) as n,
        kk_sheet_private.serial_text(coalesce(nullif(m.fields->>'serial_no',''),t.serial_no)) as sn,
        kk_sheet_private.identity_text(coalesce(nullif(m.fields->>'inventory_no',''),t.inventory_no)) as inv
      from public.tools t left join kk_sheet_private.mapping m on m.tool_id=t.id
    ), input as (
      select kk_sheet_private.identity_text(incoming->>'name') n,
             kk_sheet_private.serial_text(incoming->>'serial_no') sn,
             kk_sheet_private.identity_text(incoming->>'inventory_no') inv
    ), scores as (
      select r.id, (case when r.sn=i.sn then 8 else 0 end + case when r.inv=i.inv then 4 else 0 end +
        case when r.n=i.n then 3 else 0 end)*4 + case when r.line=ln then 1 else 0 end as score
      from raw r cross join input i
      where r.sn=i.sn or (r.inv=i.inv and (r.n=i.n or r.sn is null or i.sn is null)) or
        (r.n=i.n and (r.sn is null or i.sn is null or r.sn=i.sn) and (r.inv is null or i.inv is null or r.inv=i.inv))
    ) select array_agg(id) into candidate_ids from scores where score=(select max(score) from scores);
    pick:=candidate_ids[1];
    if cardinality(candidate_ids)>1 or pick=any(claimed) then
      v_review:=v_review||jsonb_build_array(jsonb_build_object('line',ln,'reason','Несколько совпадений в каталоге'));
      continue;
    end if;
    if pick is null and not incoming ? 'status' and nullif(incoming->>'inventory_no','') is null and kk_sheet_private.serial_text(incoming->>'serial_no') is null then
      v_review:=v_review||jsonb_build_array(jsonb_build_object('line',ln,'reason','Уточните наличие или инвентарный номер'));
      continue;
    end if;
    if pick is null then
      pick:=gen_random_uuid();
      perform public.kk_write_row('tools',incoming||jsonb_build_object('id',pick,'legacy_id','gs-'||pick::text));
      new_count:=new_count+1;
    else
      select * into strict old_tool from public.tools where id=pick for update;
      select m.fields into previous from kk_sheet_private.mapping m where m.tool_id=pick;
      patch:='{}';
      for field in select jsonb_object_keys(incoming) loop
        if (previous ? field and previous->field is distinct from incoming->field and
            coalesce(nullif(to_jsonb(old_tool)->>field,''),'')=coalesce(nullif(previous->>field,''),''))
          or ((previous is null or not previous ? field) and nullif(to_jsonb(old_tool)->>field,'') is null)
          or (previous ? field and field in ('rental_price','deposit','estimated_value') and
              previous->field=to_jsonb(old_tool)->field and previous->field is distinct from incoming->field)
        then patch:=patch||jsonb_build_object(field,incoming->field); end if;
      end loop;
      if patch<>'{}' then
        select * into new_tool from jsonb_populate_record(old_tool,patch);
        update public.tools set name=new_tool.name,category=new_tool.category,inventory_no=new_tool.inventory_no,
          serial_no=new_tool.serial_no,rental_price=new_tool.rental_price,deposit=new_tool.deposit,
          estimated_value=new_tool.estimated_value,status=new_tool.status,description=new_tool.description,
          service_note=new_tool.service_note,note=new_tool.note,video_url=new_tool.video_url where id=pick;
      end if;
    end if;
    claimed:=array_append(claimed,pick);
    insert into kk_sheet_private.mapping values(pick,ln,incoming) on conflict(tool_id) do update set line=excluded.line,fields=excluded.fields;
  end loop;
  update kk_sheet_private.state set file_hash=kk_sheet_import.file_hash,archive=original,manifest=v_manifest,
    review=v_review,checked_at=clock_timestamp(),changed_at=clock_timestamp() where singleton;
  return jsonb_build_object('added',new_count,'review',jsonb_array_length(v_review));
end $$;

create or replace function public.kk_sheet_read(part text,tab_name text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_owner() then raise exception 'Требуются права владельца' using errcode='42501'; end if;
  if part='manifest' then return (select jsonb_build_object('sheets',manifest,'checked_at',checked_at,'changed_at',changed_at,'review',review) from kk_sheet_private.state);
  elsif part='rows' then return (select sheet_rows from kk_sheet_private.tabs where name=tab_name);
  elsif part='archive' then return (select jsonb_build_object('base64',encode(archive,'base64')) from kk_sheet_private.state);
  else raise exception 'Unknown workbook section'; end if;
end $$;
revoke all on all functions in schema kk_sheet_private from public,anon,authenticated;
revoke all on function public.kk_sheet_read(text,text),public.kk_sheet_check(text,text),public.kk_sheet_import(text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.kk_sheet_read(text,text) to authenticated;
grant execute on function public.kk_sheet_check(text,text), public.kk_sheet_import(text,text,text,text,jsonb,jsonb) to anon;
notify pgrst,'reload schema';

