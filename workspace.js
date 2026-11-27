import { contractMarkup } from "./contract.js?v=owner-workspace";

const $ = (root, selector) => root.querySelector(selector);
const cents = amount => Math.round(Number(amount || 0) * 100);
const monthOf = day => String(day || "").slice(0, 7);
function daysInMonth(month) {
  const [year, number] = month.split("-").map(Number);
  const length = new Date(year, number, 0).getDate();
  return Array.from({length}, (_, index) => month+"-"+String(index+1).padStart(2,"0"));
}
function monthPicker(month) {
  return `<label class="field">Месяц<input type="month" data-month value="${month}" required></label>`;
}
function bindMonth(ctx, key, render) {
  const input = $(ctx.root,"[data-month]");
  input.onchange = () => {
    if(!/^\d{4}-\d{2}$/.test(input.value))return;
    ctx.state.filters[key]=input.value;
    render(ctx);
  };
}
function bindSave(ctx, form, save, message) {
  form.onsubmit=async event=>{
    event.preventDefault();
    const button=form.querySelector("[type=submit]");
    if(button.disabled)return;
    button.disabled=true;
    try {
      await save(new FormData(form));
      ctx.closeModal();ctx.playFeedback("saved");
      await ctx.reloadData();ctx.toast(message);
    }catch(error){ctx.toast(error.message,true)}
    finally{button.disabled=false}
  };
}

export function renderCash(ctx) {
  const {root,state,today,esc,money,fmtDate}=ctx;
  const month=state.filters.cashMonth||monthOf(today());
  const days=daysInMonth(month);
  const groups=new Map(days.map(day=>[day,{contracts:0,tools:0,billed:0,receipts:0,refunds:0,spent:0}]));
  const ledger=[];
  const contractNumbers=new Map(state.rentals.map(r=>[r.id,r.contract_number]));
  for(const r of state.rentals){
    if(r.status==="cancelled")continue;
    const issue=groups.get(r.issue_date),billing=groups.get(r.contract_date||r.issue_date);
    if(issue){issue.contracts++;issue.tools+=r.items?.length||0}
    if(billing)billing.billed+=cents(r.total_amount);
  }
  for(const e of state.cash_entries){
    const group=groups.get(e.entry_date);if(!group)continue;
    const receipt=e.kind==="receipt";
    group[receipt?"receipts":"refunds"]+=cents(e.amount);
    ledger.push([e.entry_date,receipt?"Оплата":"Возврат оплаты",contractNumbers.get(e.rental_id),e.note,(receipt?1:-1)*cents(e.amount)]);
  }
  for(const e of state.expenses){
    const group=groups.get(e.expense_date);if(!group)continue;
    group.spent+=cents(e.amount);
    ledger.push([e.expense_date,e.category||"Расход",contractNumbers.get(e.rental_id),e.note,-cents(e.amount)]);
  }
  const total=Object.fromEntries(Object.keys(groups.get(days[0])).map(key=>[key,0]));
  for(const group of groups.values())for(const key of Object.keys(total))total[key]+=group[key];
  const metric=(label,value,detail)=>`<article class="kpi"><span>${label}</span><b>${value}</b><small>${detail}</small></article>`;
  const net=g=>g.receipts-g.refunds-g.spent;
  root.innerHTML=`<div class="toolbar">${monthPicker(month)}<button class="btn primary" data-income>Записать оплату</button><button class="btn" id="finAddExpense">Добавить расход</button></div>
    <div class="finance-grid">${metric("Выдано инструментов",total.tools,"Договоров выдачи: "+total.contracts)}${metric("Выручка по договорам",money(total.billed/100),"По дате договора, с учётом скидок")}${metric("Получено оплат",money(total.receipts/100),"Возвращено клиентам: "+money(total.refunds/100))}${metric("Расходы",money(total.spent/100),"По журналу расходов")}${metric("Изменение кассы",money(net(total)/100),"Оплаты минус возвраты и расходы")}</div>
    <section class="panel"><div class="panel-head"><h3>Динамика по дням</h3></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Дата</th><th>Выдано, шт.</th><th>По договорам</th><th>Оплаты</th><th>Возвраты</th><th>Расходы</th><th>Изменение кассы</th></tr></thead><tbody>${[...groups].filter(([,g])=>Object.values(g).some(Boolean)).map(([day,g])=>`<tr><td>${fmtDate(day)}</td><td>${g.tools}</td>${[g.billed,g.receipts,g.refunds,g.spent,net(g)].map(x=>`<td>${money(x/100)}</td>`).join("")}</tr>`).join("")||'<tr><td colspan="7">За этот месяц операций ещё нет.</td></tr>'}</tbody></table></div></section>
    <section class="panel"><div class="panel-head"><h3>Журнал кассы</h3></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Дата</th><th>Операция</th><th>Договор</th><th>Комментарий</th><th>Сумма</th></tr></thead><tbody>${ledger.sort((a,b)=>b[0].localeCompare(a[0])).map(x=>`<tr><td>${fmtDate(x[0])}</td><td>${esc(x[1])}</td><td>${esc(x[2]||"—")}</td><td>${esc(x[3]||"—")}</td><td>${money(x[4]/100)}</td></tr>`).join("")||'<tr><td colspan="5">Здесь появятся внесённые оплаты, возвраты и расходы.</td></tr>'}</tbody></table></div></section>`;
  if(ctx.online){
    const panel=document.createElement("section");panel.className="panel";
    panel.innerHTML='<div class="panel-head"><h3>Касса из листа «выручка»</h3></div><p class="muted">Загружаются записи таблицы…</p>';
    root.querySelector(".finance-grid").after(panel);
    ctx.db.rpc("kk_cash_sheet_month",{month_start:days[0]}).then(({data,error})=>{
      if(!panel.isConnected)return;
      if(error){panel.querySelector("p").textContent="Не удалось загрузить лист «выручка». Обновите раздел.";return}
      const incoming=data.reduce((n,r)=>n+cents(r.income),0),outgoing=data.reduce((n,r)=>n+cents(r.expense),0);
      panel.querySelector("p").remove();
      panel.insertAdjacentHTML("beforeend",data.length?`<p><b>Приход ${money(incoming/100)}</b> · Расход ${money(outgoing/100)} · Изменение ${money((incoming-outgoing)/100)}</p><details><summary>По дням</summary><div class="table-scroll"><table class="data-table"><thead><tr><th>Дата</th><th>Приход</th><th>Расход</th></tr></thead><tbody>${data.map(r=>`<tr><td>${fmtDate(r.day)}</td><td>${money(r.income)}</td><td>${money(r.expense)}</td></tr>`).join("")}</tbody></table></div></details><small class="muted">Данные из таблицы показаны отдельно от операций кабинета.</small>`:'<p class="muted">В листе нет операций за выбранный месяц.</p>');
    });
  }
  bindMonth(ctx,"cashMonth",renderCash);
  $(root,"#finAddExpense").onclick=ctx.openExpenseForm;
  $(root,"[data-income]").onclick=()=>{
    ctx.openModal("Кассовая операция",`<form class="stack" id="cashEntry"><label class="field">Операция<select name="kind"><option value="receipt">Оплата аренды</option><option value="refund">Возврат оплаты</option></select></label><div class="form-grid"><label class="field">Дата<input name="entry_date" type="date" required value="${today()}"></label><label class="field">Сумма, ₽<input name="amount" type="number" min=".01" step=".01" required></label></div><label class="field">Договор<select name="rental_id"><option value="">Без привязки</option>${state.rentals.filter(r=>r.status!=="cancelled").sort((a,b)=>String(b.issue_date).localeCompare(String(a.issue_date))).map(r=>`<option value="${esc(r.id)}">№ ${esc(r.contract_number)} · ${esc(r.client_name_snapshot)}</option>`).join("")}</select></label><label class="field">Комментарий<input name="note"></label><button class="btn primary" type="submit">Записать операцию</button></form>`);
    const id=crypto.randomUUID();
    bindSave(ctx,document.querySelector("#cashEntry"),async fd=>{
      const row={...Object.fromEntries(fd),id,rental_id:fd.get("rental_id")||null,amount:Number(fd.get("amount"))};
      if(ctx.online){
        const {error}=await ctx.db.from("cash_entries").insert(row);
        if(error && error.code!=="23505")throw error;
      }else await ctx.upsert("cash_entries",row);
      state.filters.cashMonth=monthOf(row.entry_date);
    },"Операция записана");
  };
}

const shiftMarks={"На смене":"Я","Выходной":"В","Отпуск":"О","Больничный":"Б"};
export function renderShiftMonth(ctx){
  const {root,state,today,esc,fmtDate}=ctx;
  const month=state.filters.shiftMonth||monthOf(today()), days=daysInMonth(month);
  const shifts=new Map(state.timesheet.filter(s=>monthOf(s.work_date)===month).map(s=>[s.employee_id+"/"+s.work_date,s]));
  const people=state.employees.filter(e=>e.active!==false||days.some(day=>shifts.has(e.id+"/"+day))).sort((a,b)=>a.full_name.localeCompare(b.full_name,"ru"));
  const labels=Object.entries(shiftMarks).map(([status,mark])=>mark+" — "+status.toLowerCase()).join(" · ");
  root.innerHTML=`<div class="toolbar">${monthPicker(month)}<button class="btn" data-open-view="employees">Сотрудники</button></div><section class="panel"><div class="panel-head"><h3>Смены за месяц</h3></div><p class="muted">Нажмите на день, чтобы поставить отметку. ${labels}.</p><div class="table-scroll"><table class="data-table shift-month"><thead><tr><th>Сотрудник</th>${days.map(d=>`<th>${d.slice(-2)}</th>`).join("")}<th>Смен</th></tr></thead><tbody>${people.map(person=>{
    let count=0;
    const cells=days.map(day=>{
      const status=shifts.get(person.id+"/"+day)?.status||"";
      if(status==="На смене")count++;
      return `<td><button class="shift-cell" data-person="${esc(person.id)}" data-day="${day}" title="${esc(status||"Без отметки")}" aria-label="${esc(person.full_name)} · ${fmtDate(day)} · ${esc(status||"Без отметки")}">${esc(shiftMarks[status]||status.slice(0,1)||"·")}</button></td>`;
    }).join("");
    return `<tr><th>${esc(person.full_name)}</th>${cells}<td><b>${count}</b></td></tr>`;
  }).join("")||'<tr><td colspan="33">Добавьте сотрудника, чтобы вести табель.</td></tr>'}</tbody></table></div></section>`;
  bindMonth(ctx,"shiftMonth",renderShiftMonth);
  for(const button of root.querySelectorAll("[data-day]"))button.onclick=()=>{
    const {person,day}=button.dataset,old=shifts.get(person+"/"+day);
    ctx.openModal(state.employees.find(e=>e.id===person).full_name+" · "+fmtDate(day),`<form class="stack" id="shiftEdit"><label class="field">Отметка<select name="status"><option value="">Без отметки</option>${[...new Set([...Object.keys(shiftMarks),...(old?.status?[old.status]:[])])].map(s=>`<option ${old?.status===s?"selected":""}>${esc(s)}</option>`).join("")}</select></label><button type="submit" class="btn primary">Сохранить</button></form>`);
    bindSave(ctx,document.querySelector("#shiftEdit"),async fd=>{
      const row={employee_id:person,work_date:day,status:fd.get("status")};
      if(ctx.online){const {error}=await ctx.db.from("timesheet").upsert(row,{onConflict:"employee_id,work_date"});if(error)throw error}
      else await ctx.upsert("timesheet",{id:old?.id,...row});
    },"Отметка сохранена");
  };
}

export function renderNotebook(ctx){
  const {root,state,esc}=ctx;
  const labels={rules:"Правила для MAX",duties:"Должностная инструкция"};
  const key=state.filters.noteTab||"rules",note=state.staff_notes.find(n=>n.id===key);
  const body=note?.body||"";
  root.innerHTML=`<div class="toolbar owner-period">${Object.entries(labels).map(([id,name])=>`<button class="btn" data-note="${id}" aria-pressed="${id===key}">${name}</button>`).join("")}</div><section class="panel"><div class="panel-head"><h3>${labels[key]}</h3><div class="toolbar">${key==="rules"&&body?'<button class="btn" data-copy>Скопировать для MAX</button>':""}${state.role==="owner"?'<button class="btn primary" data-edit-note>Редактировать</button>':""}</div></div><div class="note-text">${esc(body||"Владелец пока не добавил текст.")}</div></section>`;
  for(const b of root.querySelectorAll("[data-note]"))b.onclick=()=>{state.filters.noteTab=b.dataset.note;renderNotebook(ctx)};
  const copy=$(root,"[data-copy]");
  if(copy)copy.onclick=async()=>{try{await navigator.clipboard.writeText(body);ctx.toast("Правила скопированы для MAX")}catch{
    const range=document.createRange();range.selectNodeContents($(root,".note-text"));const selection=getSelection();selection.removeAllRanges();selection.addRange(range);ctx.toast("Текст выделен. Выберите «Копировать».")
  }};
  const edit=$(root,"[data-edit-note]");
  if(edit)edit.onclick=()=>{
    ctx.openModal(labels[key],`<form id="noteEdit" class="stack"><label class="field">Текст<textarea rows="14" name="body" maxlength="50000">${esc(body)}</textarea></label><button type="submit" class="btn primary">Сохранить для команды</button></form>`);
    bindSave(ctx,document.querySelector("#noteEdit"),async fd=>{
      const row={id:key,body:fd.get("body").trim(),revision:(note?.revision||0)+1};
      if(ctx.online){const {data,error}=await ctx.db.from("staff_notes").update({body:row.body,revision:row.revision}).eq("id",key).eq("revision",row.revision-1).select("id").maybeSingle();if(error)throw error;if(!data)throw Error("Текст изменён в другой вкладке. Скопируйте правки и откройте его заново.")}
      else await ctx.upsert("staff_notes",row);
    },"Текст сохранён");
  };
}

const templateGroups=[
  ["Заголовок и арендатор",[0,1,3,5,7,9]],
  ["Инструменты и сроки",[10,11,12,13,18,20,22,23]],
  ["Правила и условия",Array.from({length:34},(_,i)=>24+i)],
  ["Реквизиты и подписи",[58,59,60,61,62,63,64,66]],
  ["Возврат",[68,69,70,71,73]]
];
export async function renderTemplateEditor(ctx){
  const {root,state,esc}=ctx, account=state.user,request=crypto.randomUUID();
  root.dataset.request=request; root.innerHTML='<p class="muted">Загрузка бланка…</p>';
  try{
    const template=await ctx.getPrintTemplate();
    if(state.user!==account||root.dataset.request!==request||state.view!=="template")return;
    const doc=template.document;
    root.innerHTML=`<section class="panel"><div class="panel-head"><h3>Бланк для новых договоров</h3>${state.role==="owner"?'<button class="btn primary" data-template-edit>Редактировать бланк</button>':""}</div><iframe class="blank-preview" title="Действующий бланк договора" sandbox="allow-same-origin"></iframe></section>`;
    $(root,"iframe").srcdoc=contractMarkup(doc,{},null,[]);
    const edit=$(root,"[data-template-edit]");
    if(!edit)return;
    edit.onclick=()=>{
      ctx.openModal("Редактирование бланка",`<form class="stack" id="templateEdit"><p class="muted">Подчёркивания заполняются данными договора. Для дополнительного правила добавьте строку в конце нужного пункта.</p>${templateGroups.map(([title,indices])=>`<details class="template-group"><summary>${title}</summary>${indices.map(i=>`<label class="field">${esc(doc.paragraphs[i].trim().slice(0,46)||"Абзац")}<textarea name="p${i}" rows="3" required>${esc(doc.paragraphs[i])}</textarea></label>`).join("")}</details>`).join("")}<label class="field">Подписи внизу страницы<input name="footer" value="${esc(doc.footer)}" required></label><div class="toolbar"><button type="button" class="btn" data-preview>Проверить бланк</button><button class="btn primary" type="submit">Сохранить новую версию</button></div><iframe class="blank-preview" title="Проверка изменений" sandbox="allow-same-origin" hidden></iframe></form>`);
      const form=document.querySelector("#templateEdit");
      function draft(fd){
        const next=structuredClone(doc);
        for(const [,indices] of templateGroups)for(const i of indices){
          const value=String(fd.get("p"+i));
          const placeholders=text=>(text.match(/_+/g)||[]).length;
          if(!value.trim() || placeholders(value)!==placeholders(doc.paragraphs[i]) || ([58,59,60,61,62,63,64,73].includes(i)&&value.split("\t").length!==doc.paragraphs[i].split("\t").length)){
            const field=form.elements["p"+i];field.closest("details").open=true;field.focus();
            throw Error("Сохраните поля с подчёркиваниями и разделители колонок в выбранном абзаце.");
          }
          next.paragraphs[i]=value;
        }
        next.footer=String(fd.get("footer")).trim();
        return next;
      }
      $(form,"[data-preview]").onclick=()=>{try{const frame=$(form,"iframe");frame.srcdoc=contractMarkup(draft(new FormData(form)),{},null,[]);frame.hidden=false;frame.scrollIntoView()}catch(e){ctx.toast(e.message,true)}};
      bindSave(ctx,form,async fd=>{
        const next=draft(fd);
        if(ctx.online){const {error}=await ctx.db.rpc("kk_publish_template",{previous_version:template.version,new_document:next});if(error)throw error}
        else{
          if(!state.templates.length)state.templates.push({...template,active:true});
          const current=state.templates.find(t=>t.active);if(current?.version!==template.version)throw Error("Бланк уже изменён.");
          current.active=false;state.templates.push({version:crypto.randomUUID(),active:true,document:next});ctx.persistDemo();
        }
      },"Новая версия бланка сохранена");
    };
  }catch(e){if(state.user===account && root.dataset.request===request){root.textContent=e.message}}
}
