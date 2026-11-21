export function renderEmployer({root,state,online,db,esc,money,today,addDays,revenueFor,expenseFor,openModal,closeModal,toast,reloadData}) {
  if(state.role!=="owner"){root.replaceChildren();return}
  const now=today(),period=state.filters.ownerPeriod||"month";
  const start={today:now,week:addDays(now,-6),month:now.slice(0,8)+"01"}[period];
  const revenue=revenueFor(start,now),expense=expenseFor(start,now);
  const active=state.rentals.filter(r=>r.status==="active"),late=active.filter(r=>r.return_date<now);
  const team=state.employees.filter(e=>e.active!==false);
  const entries=(Array.isArray(state.timesheet)?state.timesheet:[]).filter(x=>x.work_date===now);
  const statusFor=e=>entries.find(x=>x.employee_id===e.id)?.status||"Без отметки";
  const onDuty=team.filter(e=>statusFor(e)==="На смене");
  const block=(name,value,detail)=>`<article class="kpi"><span>${name}</span><b>${value}</b><small>${detail}</small></article>`;
  root.innerHTML=`<section class="panel owner-summary"><div class="panel-head"><h3>Результаты проката</h3><div class="owner-period" aria-label="Период отчёта">${[["today","Сегодня"],["week","7 дней"],["month","С начала месяца"]].map(([id,title])=>`<button type="button" data-period="${id}" aria-pressed="${id===period}">${title}</button>`).join("")}</div></div>
    <div class="finance-grid">${block("Выручка",money(revenue),"Стоимость договоров")}${block("Расходы",money(expense),"По журналу расходов")}${block("Результат",money(revenue-expense),"Выручка за вычетом расходов")}</div></section>
    <div class="grid-2"><section class="panel"><div class="panel-head"><h3>Смена сегодня</h3><button class="text-btn" data-open-view="employees">Открыть табель</button></div>
      <p><b>${onDuty.length}</b> на смене из ${team.length}</p>${team.length?`<ul class="owner-roster">${team.slice().sort((a,b)=>a.full_name.localeCompare(b.full_name,"ru")).map(e=>`<li><span>${esc(e.full_name)}</span><span class="pill ${statusFor(e)==="На смене"?"green":""}">${esc(statusFor(e))}</span></li>`).join("")}</ul>`:'<p class="muted">Добавьте сотрудников в табеле, чтобы видеть состав смены.</p>'}</section>
    <section class="panel"><div class="panel-head"><h3>Контроль возвратов</h3></div>${[["active","Активные договоры",active.length],["today","Вернуть сегодня",active.filter(r=>r.return_date===now).length],["overdue","Просроченные",late.length]].map(([f,label,n])=>`<button class="owner-link" data-rental-filter="${f}"><span>${label}</span><b>${n}</b></button>`).join("")}</section></div>
    <section class="panel"><div class="panel-head"><h3>Доступ к общей базе</h3>${online?'<button id="refreshAccounts" class="btn">Обновить</button>':''}</div><div id="ownerAccounts" aria-live="polite"></div></section>`;
  const accounts=root.querySelector("#ownerAccounts");
  root.querySelectorAll("[data-period]").forEach(el=>el.onclick=()=>{state.filters.ownerPeriod=el.dataset.period;renderEmployer({root,state,online,db,esc,money,today,addDays,revenueFor,expenseFor,openModal,closeModal,toast,reloadData})});
  if(!online){accounts.innerHTML='<p class="muted">Сейчас открыт кабинет этого браузера. Заявки и права сотрудников доступны владельцу после входа в общую базу.</p>';return}
  const label={owner:"Владелец",manager:"Менеджер",employee:"Сотрудник"};
  let rows=[],serial=0;
  const status=p=>p.active?"Активен":p.reviewed_at?"Отключён":"Ожидает решения";
  const valid=()=>accounts.isConnected&&state.role==="owner"&&state.mode==="cloud"&&state.view==="employer";
  function draw(){
    if(!valid())return;
    accounts.innerHTML=`<div class="toolbar"><input type="search" id="ownerFilter" class="search" aria-label="Найти пользователя" placeholder="Имя или почта сотрудника"><select id="ownerAccessFilter" aria-label="Статус учётной записи"><option value="">Все статусы</option>${["Ожидает решения","Активен","Отключён"].map(v=>`<option>${v}</option>`).join("")}</select></div><div id="ownerAccountList"></div>`;
    const filter=accounts.querySelector("#ownerFilter"),select=accounts.querySelector("select"),list=accounts.querySelector("#ownerAccountList");
    function filterRows(){
      const q=filter.value.trim().toLowerCase(),found=rows.filter(p=>(!select.value||select.value===status(p))&&[p.full_name,p.email].some(v=>String(v||"").toLowerCase().includes(q)));
      list.innerHTML=found.map(p=>`<div class="owner-person"><div><b>${esc(p.full_name||p.email||"Пользователь")}</b><small>${esc(p.email||"")}</small></div><span>${label[p.role]}</span><span class="pill ${p.active?"green":"orange"}">${status(p)}</span>${p.role==="owner"?"":`<button class="text-btn" data-person="${esc(p.id)}">${p.active||p.reviewed_at?"Изменить доступ":"Рассмотреть"}</button>`}</div>`).join("")||'<p class="empty">Пользователи не найдены.</p>';
    }
    filter.oninput=filterRows;select.onchange=filterRows;filterRows();
    list.onclick=e=>{
      const b=e.target.closest("[data-person]");if(!b)return;
      const p=rows.find(row=>row.id===b.dataset.person);if(!p||p.role==="owner"||p.id===state.user.id)return;
      openModal("Доступ сотрудника",`<form id="accessForm" class="stack"><div><b>${esc(p.full_name||p.email)}</b><small>${esc(p.email)}</small></div><label class="field">Роль<select name="role"><option value="employee">Сотрудник — прокат и клиенты</option><option value="manager">Менеджер — также финансы и команда</option></select></label><label class="field">Доступ<select name="active"><option value="yes">Разрешить вход</option><option value="no">Отключить вход</option></select></label><div class="toolbar"><button class="btn primary">Сохранить</button><button type="button" class="btn" id="cancelAccess">Отмена</button></div></form>`);
      const form=document.querySelector("#accessForm");form.elements.role.value=p.role;form.elements.active.value=p.active?"yes":"no";
      form.querySelector("#cancelAccess").onclick=closeModal;
      form.onsubmit=async event=>{
        event.preventDefault();const submit=form.querySelector(".primary");if(submit.disabled)return;submit.disabled=true;
        try{const {error}=await db.rpc("kk_manage_access",{target_id:p.id,new_role:form.elements.role.value,enabled:form.elements.active.value==="yes",expected_update:p.updated_at});if(error)throw error;
          closeModal();await load();toast("Права доступа сохранены")}
        catch(err){toast(err.message||"Не удалось изменить права",true)}finally{submit.disabled=false}
      };
    };
  }
  async function load(){
    const ticket=++serial;accounts.textContent="Загружаю пользователей…";
    try{
      const all=[],size=250;
      for(let start=0;;start+=size){const {data,error}=await db.rpc("kk_access_list").range(start,start+size-1);if(error)throw error;all.push(...data);if(data.length<size)break}
      if(ticket!==serial||!valid())return;rows=all;draw();
    }catch(err){if(ticket===serial&&valid())accounts.textContent="Не удалось загрузить пользователей. "+(err.message||"Проверьте соединение.")}
  }
  root.querySelector("#refreshAccounts").onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{await reloadData()}catch(err){toast(err.message,true);button.disabled=false}};
  load();
}

