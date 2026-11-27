import { renderCash, renderShiftMonth, renderNotebook, renderTemplateEditor } from "./workspace.js?v=owner-workspace";
import { initSounds, playFeedback } from "./sound.js";
import { partyFieldsMarkup, partyFromForm, fillParty, rentalParty, accessoryRows, contractMarkup, yakutskMoment } from "./contract.js?v=owner-workspace";
import { renderWorkbook } from "./workbook.js";
import { renderEmployer } from "./employer.js?v=owner-workspace";
import { icon, mountIcons } from "./icons.js?v=action-sounds";
import { normalizeBackup, cloudBackup } from "./backup.js?v=owner-workspace";

const CFG = window.KK_CONFIG || {};
const configured = Boolean(CFG.url && CFG.publishableKey && !/YOUR-PROJECT|YOUR_SUPABASE/i.test(CFG.url + CFG.publishableKey));
let supabase = null;
const $ = (s, p=document) => p.querySelector(s);
const $$ = (s, p=document) => [...p.querySelectorAll(s)];
const formatter = new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2});
const money = v => formatter.format(Number(v)||0) + " ₽";
const esc = v => String(v ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const localDate = d => [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
const isoToday = () => localDate(new Date());
const fmtDate = v => v ? new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString("ru-RU") : "—";
const uid = () => crypto.randomUUID();
const collections = ["clients","tools","rentals","expenses","employees","timesheet"];
const extraCollections=["staff_notes","cash_entries","templates"];
const roleNames={owner:"Владелец",manager:"Менеджер",employee:"Сотрудник"};
const titles={notes:"Блокнот",shifts:"Табель",template:"Бланк договора",workbook:"Таблица проката",employer:"Кабинет владельца",dashboard:"Обзор проката",rentals:"Договоры аренды",tools:"Каталог инструментов",clients:"Клиенты",finance:"Касса",reports:"Отчёты",employees:"Сотрудники",settings:"Настройки"};
const state={user:null,profile:null,role:"employee",mode:"local",view:"dashboard",filters:{},theme:localStorage.getItem("kk-web-theme")||"light"};
const cloud=()=>state.mode==="cloud";
const manager=()=>["owner","manager"].includes(state.role);
const hosted=CFG.hosted===true;
const dbKey=hosted?"kk-web-public-demo-v1":"kk-web-workspace-v2";
function toast(msg,error=false){
  const el=$("#toast");
  if($("#modal").open && error){
    let line=$(".form-error",$("#modalContent"));
    if(!line){line=document.createElement("p");line.className="form-error";line.setAttribute("role","alert");$("#modalContent").append(line)}
    line.textContent=msg;line.scrollIntoView({block:"nearest"});return;
  }
  el.textContent=msg;el.classList.toggle("error",error);el.classList.add("show");
  clearTimeout(window.__toast);window.__toast=setTimeout(()=>el.classList.remove("show"),3500);
}
function setSync(online,text){$("#syncDot").classList.toggle("online",online);$("#syncText").textContent=text}
function applyTheme(){
  document.documentElement.classList.toggle("dark",state.theme==="dark");
  $("#themeBtn").innerHTML=icon(state.theme==="dark"?"sun":"moon");
  $("#themeBtn").setAttribute("aria-pressed",String(state.theme==="dark"));
}
function openModal(title,body){
  const d=$("#modal");delete d.dataset.dirty;$("#modalContent").innerHTML=`<h2 id="dialogTitle">${esc(title)}</h2><div class="modal-inner">${body}</div>`;
  if(!d.open)d.showModal();
  const el=d.querySelector("input:not([type=hidden]),select,.modal-inner button");if(el)el.focus();
}
function closeModal(){if($("#modal").open)$("#modal").close()}
function setMenu(open){$(".main").inert=open;document.body.classList.toggle("menu-open",open);$("#menuShade").hidden=!open;$("#menuBtn").setAttribute("aria-expanded",String(open));$("#sidebar").inert=matchMedia("(max-width:850px)").matches&&!open}
const modal=$("#modal");
function discardModal(){if(!modal.dataset.dirty || confirm("Закрыть форму и потерять введённые изменения?"))closeModal()}
modal.addEventListener("input",()=>{if(modal.querySelector("form"))modal.dataset.dirty="yes"});
modal.addEventListener("cancel",event=>{event.preventDefault();discardModal()});
modal.addEventListener("click",event=>{
  if(event.target.closest("#cancelModal,#cancelReturn,[data-discard]")){event.stopPropagation();discardModal()}
},true);
$("#modalClose").onclick=discardModal;
$("#menuShade").onclick=()=>{setMenu(false);$("#menuBtn").focus()};$("#menuBtn").onclick=()=>{setMenu(true);$(".nav-item.active").focus()};
matchMedia("(max-width:850px)").addEventListener("change",()=>setMenu(false));
document.addEventListener("keydown",e=>{
 if(e.key==="Escape" && document.body.classList.contains("menu-open")){$("#menuShade").click()}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k" && state.user&&!$("#modal").open){e.preventDefault();openSearch()}
});
let signingUp=false;
function authMode(register){
  signingUp=register;
  $("#loginIdLabel").textContent=register?"Почта":"Логин или почта";
  $("#loginEmail").type=register?"email":"text";$("#loginForm button").textContent=register?"Создать заявку":"Войти";
  $("#loginPassword").autocomplete=register?"new-password":"current-password";$("#loginPassword").minLength=register?8:1;
  $("#signupSwitch").textContent=register?"Вернуться ко входу":"Запросить доступ сотрудника";
}
$("#signupSwitch").onclick=()=>{authMode(!signingUp);$("#authStatus").textContent=signingUp?"Новый сотрудник получает доступ после подтверждения владельцем.":""};
function showAuth(message=""){
  authMode(false);$("#signupSwitch").hidden=!supabase;
  $("#demoBtn").textContent=hosted?"Открыть демоверсию":"Открыть локальный кабинет";
  $("#auth").classList.remove("hidden");$("#app").classList.add("hidden");$("#loginForm").hidden=!supabase;$("#authStatus").textContent=message;
}
async function enter(user,mode,audible=false){
  state.mode=mode;state.user=user;state.filters={};
  if(cloud()){
    const {data,error}=await supabase.from("profiles").select("*").eq("id",user.id).single();
    if(error)throw error;if(!data?.active)throw Error(data?.reviewed_at?"Доступ отключён. Обратитесь к владельцу.":"Заявка ожидает одобрения владельца.");
    state.profile=data;state.role=data.role;await cloudLoad();setSync(true,"Общая база · Supabase");
  }else{
    state.role="owner";state.profile={full_name:hosted?"Демоверсия":"Локальный кабинет"};await demoLoad();setSync(false,hosted?"Демо · только в этом браузере":"На этом устройстве");
  }
  sessionStorage.removeItem("kk-web-logged-out");
  $("#accountName").textContent=state.profile.full_name||user.email;$("#accountRole").textContent=roleNames[state.role]||"Сотрудник";
  $("#initials").textContent=$("#accountName").textContent.split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  $("#auth").classList.add("hidden");$("#app").classList.remove("hidden");
  state.view=location.hash.slice(1)||(cloud()&&state.role==="owner"?"employer":"dashboard");applyRoleUI();setView(state.view);
  if(audible)playFeedback("welcome");
}
async function enterLocal(audible=false){try{await enter({id:"demo"},"local",audible)}catch(err){state.user=null;showAuth("Не удалось открыть локальную базу. "+err.message)}}
async function authInit(){
  mountIcons();initSounds($("#soundBtn"),icon);applyTheme();setMenu(false);
  if(!configured&&hosted){showAuth("Общая база ещё не подключена. Демоверсия сохраняет изменения в этом браузере.");return}
  if(!configured){if(sessionStorage.getItem("kk-web-logged-out"))showAuth("Данные сохраняются в этом браузере.");else await enterLocal();return}
  const {createClient}=await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  supabase=createClient(CFG.url,CFG.publishableKey);
  const {data,error}=await supabase.auth.getSession();if(error)throw error;
  if(!state.user){if(data.session)await enter(data.session.user,"cloud");else showAuth()}
  supabase.auth.onAuthStateChange((event)=>{if(event==="SIGNED_OUT"&&cloud())resetAccount()});
}
function resetAccount(){$("#modalContent").replaceChildren();$("#workbookView").replaceChildren();$("#employerView").replaceChildren();closeModal();setMenu(false);state.user=null;state.profile=null;state.role="employee";state.view="dashboard";state.filters={};[...collections,...extraCollections].forEach(k=>{state[k]=[]});for(const id of ["notesView","templateView","shiftsView","financeView"])$("#"+id).replaceChildren();sessionStorage.setItem("kk-web-logged-out","1");history.replaceState(null,"",location.pathname+location.search);showAuth(configured?"":"Данные сохраняются в этом браузере.")}
$("#loginForm").onsubmit=async e=>{
  e.preventDefault();const b=e.submitter;b.disabled=true;
  if(signingUp){
    try{
      const {error}=await supabase.auth.signUp({email:$("#loginEmail").value.trim(),password:$("#loginPassword").value,options:{emailRedirectTo:location.origin+location.pathname}});
      if(error)throw error;$("#loginPassword").value="";showAuth("Проверьте почту для подтверждения адреса. Владелец сможет одобрить заявку в своём кабинете.");
    }catch(err){$("#authStatus").textContent=err.message}finally{b.disabled=false}
    return;
  }
  try{const login=$("#loginEmail").value.trim().toLowerCase();
    const email=login.includes("@")?login:login+"@accounts.kladovka.invalid";
    const {data,error}=await supabase.auth.signInWithPassword({email,password:$("#loginPassword").value});if(error)throw error;$("#loginPassword").value="";await enter(data.user,"cloud",true)}
  catch(err){state.user=null;showAuth(err.message)}finally{b.disabled=false}
};
$("#demoBtn").onclick=()=>enterLocal(true);
$("#logoutBtn").onclick=async()=>{if(cloud()&&supabase){const {error}=await supabase.auth.signOut();if(error)return toast(error.message,true)}resetAccount()};
$("#themeBtn").onclick=()=>{state.theme=state.theme==="dark"?"light":"dark";localStorage.setItem("kk-web-theme",state.theme);applyTheme()};
$("#newRentalBtn").onclick=()=>openRentalForm();
function applyRoleUI(){
  $$(".owner-only").forEach(el=>el.classList.toggle("hidden",state.role!=="owner"));
  $$(".manager-only").forEach(el=>el.classList.toggle("hidden",!manager()));
}


async function cloudLoad(){
  async function read(table){
    const rows=[];const size=500;
    for(let start=0;;start+=size){
      const {data,error}=await supabase.from(table).select("*").order("id").range(start,start+size-1);
      if(error)throw error;rows.push(...data);if(data.length<size)return rows;
    }
  }
  const keys=["clients","tools","rentals","rental_items","staff_notes",...(manager()?["expenses","employees","timesheet","cash_entries"]:[])];
  const fetched=Object.fromEntries(await Promise.all(keys.map(async k=>[k,await read(k)])));
  const items=new Map();
  fetched.rental_items.forEach(i=>{if(!items.has(i.rental_id))items.set(i.rental_id,[]);items.get(i.rental_id).push(i)});
  fetched.rentals.forEach(r=>{r.items=items.get(r.id)||[]});
  [...collections,...extraCollections].forEach(k=>{state[k]=fetched[k]||[]});
}
function applyLocal(data){
  for(const key of [...collections,...extraCollections])state[key]=data[key]??[];
  state.revision=data.revision||0;
}
async function seedRows(){
  const resp=await fetch("data/tools.seed.json");if(!resp.ok)throw Error("Не удалось загрузить исходный каталог");
  return (await resp.json()).map(t=>({...t,id:uid(),status:t.available===false?"repair":"available"}));
}
async function demoLoad(){
  const raw=localStorage.getItem(dbKey);
  if(raw){applyLocal(JSON.parse(raw));return}
  const data={};for(const k of collections){const old=hosted?null:localStorage.getItem("kk-web-"+k);data[k]=old?JSON.parse(old):[]}
  if(hosted||localStorage.getItem("kk-web-tools")===null)data.tools=await seedRows();
  const existing=localStorage.getItem(dbKey);if(existing){applyLocal(JSON.parse(existing));return}
  applyLocal(normalizeBackup({...data,app:"Кладовка Кулибина Web"}));persistDemo();
}
function persistDemo(){
  if(cloud())throw Error("Выбран общий кабинет");
  const raw=localStorage.getItem(dbKey),prev=raw?JSON.parse(raw):null;
  if((prev?.revision||0)!==state.revision){applyLocal(prev||{});renderAll();throw Error("База обновлена в другой вкладке. Проверьте данные и повторите действие.")}
  const revision=state.revision+1;
  try{localStorage.setItem(dbKey,JSON.stringify({...Object.fromEntries([...collections,...extraCollections].map(k=>[k,state[k]])),revision}));state.revision=revision}
  catch(err){if(prev)applyLocal(prev);throw Error("Не удалось сохранить данные в браузере. Проверьте свободное место.")}
}
window.addEventListener("storage",ev=>{if(ev.key===dbKey&&state.user&&!cloud()&&!$("#modal").open&&ev.newValue){applyLocal(JSON.parse(ev.newValue));renderAll()}});
async function upsert(table,row){
  if(cloud()){const {data,error}=await supabase.from(table).upsert(row).select().single();if(error)throw error;return data}
  const index=state[table].findIndex(x=>row.id&&x.id===row.id);
  const saved={...(state[table][index]||{}),...row,id:row.id||uid()};if(index<0)state[table].unshift(saved);else state[table][index]=saved;
  persistDemo();return saved;
}
const saveClient=row=>upsert("clients",row),saveTool=row=>upsert("tools",row),saveExpense=row=>upsert("expenses",row);
async function saveRental(row,items){
  if(cloud()){
    const {data,error}=await supabase.rpc("kk_save_rental",{payload:row,lines:items});if(error)throw error;return data;
  }
  if(state.rentals.some(r=>r.id!==row.id&&r.contract_number===row.contract_number))throw Error("Такой номер договора уже используется.");
  return upsert("rentals",{...row,items:items.map(i=>({...i,id:i.id||uid()}))});
}
async function reloadData(){if(cloud())await cloudLoad();else await demoLoad();renderAll()}


function activeRentals(){return state.rentals.filter(r=>r.status==="active")}
function overdueRentals(){const t=isoToday();return activeRentals().filter(r=>r.return_date<t)}
function todayReturns(){const t=isoToday();return activeRentals().filter(r=>r.return_date===t)}
function revenueFor(from,to){return state.rentals.filter(r=>String(r.contract_date||r.issue_date)>=from&&String(r.contract_date||r.issue_date)<=to&&r.status!=="cancelled").reduce((s,r)=>s+Number(r.total_amount||0),0)}
function expenseFor(from,to){return state.expenses.filter(x=>String(x.expense_date)>=from&&String(x.expense_date)<=to).reduce((s,x)=>s+Number(x.amount||0),0)}
function activeDeposits(){return activeRentals().reduce((s,r)=>s+Number(r.deposit_amount||0),0)}
function freeTools(){return state.tools.filter(t=>!t.archived&&t.status!=="repair"&&t.status!=="broken"&&t.status!=="retired"&&!activeRentals().some(r=>r.items?.some(i=>i.tool_id===t.id))).length}



function setView(request,push=false){
  const permitted=Object.hasOwn(titles,request)&&!(["settings","employer","workbook"].includes(request)&&state.role!=="owner")&&!(["employees","finance","reports","shifts"].includes(request)&&!manager());
  const v=permitted?request:"dashboard";state.view=v;
  if(location.hash.slice(1)!==v)history[push?"pushState":"replaceState"](null,"","#"+v);
  $("#pageKicker").textContent=v==="dashboard"?"Обзор":titles[v];$("#pageTitle").textContent=titles[v];document.title=`${titles[v]} · Кладовка Кулибина`;
  $("#todayDate").textContent=new Date().toLocaleDateString("ru-RU",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  $$(".view").forEach(el=>el.classList.toggle("hidden",el.id!==v+"View"));
  $$(".nav-item").forEach(b=>{const current=b.dataset.view===v;b.classList.toggle("active",current);if(current)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
  setMenu(false);renderView(v);
  if(push){window.scrollTo(0,0);$("#pageTitle").focus({preventScroll:true})}
}
window.addEventListener("hashchange",()=>{if(state.user)setView(location.hash.slice(1))});
function renderAll(){applyRoleUI();setView(state.view)}
function renderView(v){
  const context={state,root:$("#"+v+"View"),online:cloud(),db:supabase,esc,money,today:isoToday,addDays,fmtDate,openModal,closeModal,toast,reloadData,upsert,getPrintTemplate,previewRental,openExpenseForm,playFeedback,persistDemo};
  const run={notes:()=>renderNotebook(context),template:()=>renderTemplateEditor(context),shifts:()=>renderShiftMonth(context),workbook:()=>renderWorkbook({root:$("#workbookView"),db:supabase,state,online:cloud(),esc,toast}),employer:()=>renderEmployer({root:$("#employerView"),state,online:cloud(),db:supabase,esc,money,today:isoToday,addDays,revenueFor,expenseFor,openModal,closeModal,toast,reloadData}),dashboard:renderDashboard,rentals:renderRentals,tools:renderTools,clients:renderClients,finance:()=>renderCash(context),reports:renderReports,employees:renderEmployees,settings:renderSettings};
  run[v]();
  const relatedSheet={rentals:"ежедневный отчёт",tools:"Прайс",finance:"выручка",employees:"Табель",shifts:"Табель",clients:"ЧС"};
  const workbookLink=$("#relatedWorkbook");
  workbookLink.hidden=state.role!=="owner" || !cloud() || !relatedSheet[v];
  if(!workbookLink.hidden){
    workbookLink.textContent="Лист «"+relatedSheet[v]+"»";
    workbookLink.onclick=()=>{state.filters.workbookTab=relatedSheet[v];setView("workbook",true)};
  }
  for(const id of ["rentalSearch","rentalStatus","toolFilter","toolCat","toolStatus","clientFilter"]){
    const el=document.getElementById(id);
    if(el&&el.closest(".view").id===v+"View"){el.value=state.filters[id]||"";el.setAttribute("aria-label",el.getAttribute("placeholder")||el.options?.[0]?.textContent||"Поиск")}
  }
  if(v==="tools")renderToolGrid();if(v==="clients")renderClientList();if(v==="rentals")renderRentalList();
}
document.addEventListener("input",e=>{if(["rentalSearch","toolFilter","clientFilter"].includes(e.target.id))state.filters[e.target.id]=e.target.value});
document.addEventListener("change",e=>{if(["rentalStatus","toolCat","toolStatus"].includes(e.target.id))state.filters[e.target.id]=e.target.value});
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-view],[data-open-view],[data-rental-filter],[data-free-catalog],[data-category]");if(!b)return;
  if(b.hasAttribute("data-free-catalog")||b.hasAttribute("data-category")){
    Object.assign(state.filters,{toolCat:b.dataset.category||"",toolStatus:b.hasAttribute("data-free-catalog")?"free":"",toolFilter:""});setView("tools",true);
  }else if(b.dataset.rentalFilter){Object.assign(state.filters,{rentalSearch:"",rentalStatus:b.dataset.rentalFilter});setView("rentals",true)}
  else setView(b.dataset.view||b.dataset.openView,true)
});
function emptyState(symbol,title,detail,action=""){
  return `<div class="empty"><i class="empty-icon">${icon(symbol)}</i><b>${esc(title)}</b><p>${esc(detail)}</p>${action}</div>`;
}
function cleanCategory(name){return String(name||"Без категории").replace(/^[IVXL]+\.\s{0,}/,"")}
function renderDashboard(){
  $("#kpiRevenue").textContent=money(revenueFor(isoToday(),isoToday()));$("#kpiActive").textContent=activeRentals().length;
  $("#kpiToday").textContent=todayReturns().length;$("#kpiOverdue").textContent=overdueRentals().length;
  $("#fleetReady").textContent=freeTools();$("#fleetTotal").textContent=`из ${state.tools.filter(t=>!t.archived).length} позиций`;
  const attention=activeRentals().sort((a,b)=>(a.return_date+(a.return_time||"")).localeCompare(b.return_date+(b.return_time||""))).slice(0,4);
  $("#attentionList").innerHTML=attention.length?attention.map(r=>`<button class="attention" data-edit-rental="${esc(r.id)}"><div><b>${esc(clientName(r.client_id,r))}</b><small>${esc(toolName(r))}</small></div><span class="pill ${rentalStatus(r)[1]}">${r.return_date<=isoToday()?rentalStatus(r)[0]:fmtDate(r.return_date)}</span></button>`).join(""):emptyState("check","Возвратов пока нет","Здесь появятся ближайшие сроки по активным договорам.");
  const cats=new Map();state.tools.filter(t=>!t.archived).forEach(t=>cats.set(t.category||"Без категории",(cats.get(t.category||"Без категории")||0)+1));
  $("#categories").innerHTML=[...cats].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([name,n])=>`<button class="category" data-category="${esc(name)}" title="${esc(name)}"><i>${icon("tools")}</i><b>${esc(cleanCategory(name))}</b><small>${n}</small>${icon("chevron")}</button>`).join("")||emptyState("tools","Каталог пуст","Добавьте первый инструмент в разделе «Каталог».");
  const rec=[...state.rentals].sort((a,b)=>String(b.contract_date||b.issue_date).localeCompare(String(a.contract_date||a.issue_date))||String(b.contract_number).localeCompare(String(a.contract_number),"ru",{numeric:true})).slice(0,5);
  $("#recentRentals").innerHTML=rec.length?renderRentalTable(rec,true):emptyState("rentals","Пока нет договоров","Оформите первую выдачу, и договор появится в списке.",'<button class="text-btn" data-create-rental>Оформить выдачу →</button>');
  renderChart();
}
function renderChart(){
 const days=Array.from({length:7},(_,idx)=>{const d=addDays(isoToday(),idx-6);return [d,revenueFor(d,d)]});
 const max=Math.max(1,...days.map(x=>x[1]));$("#chartPeriod").textContent=money(days.reduce((sum,x)=>sum+x[1],0));
 $("#revenueChart").innerHTML=days.map(([d,v])=>`<div class="bar" style="height:${Math.max(2,v/max*95)}px" title="${fmtDate(d)} · ${money(v)}"><span>${v?money(v):""}</span><b>${fmtDate(d).slice(0,5)}</b></div>`).join("");
}
const fold=v=>String(v??"").toLocaleLowerCase("ru").replaceAll("ё","е").trim();
function matches(q,...parts){
 const text=fold(parts.filter(x=>x!=null).join(" "));const tokens=fold(q).split(/\s+/);
 if(tokens.every(w=>text.includes(w)))return true;
 const digits=String(q).replace(/\D/g,"");return digits.length>=4&&/^[+()\d\s-]+$/.test(q)&&parts.some(v=>String(v??"").replace(/\D/g,"").includes(digits));
}
function openSearch(){
  openModal("Поиск по базе",`<div class="search-dialog"><input id="quickQuery" type="search" aria-label="Поиск по базе" placeholder="Договор, инструмент, клиент или телефон"><div id="quickResults" class="search-results"></div></div>`);
  const q=$("#quickQuery"),out=$("#quickResults");
  function search(){
    const term=q.value.trim();if(!term){out.innerHTML='<p class="empty">Введите название, номер или телефон.</p>';return}
    const groups=[
      ["Договоры","rental","rentals",state.rentals,r=>[r.contract_number,clientName(r.client_id,r),toolName(r),r.client_phone_snapshot]],
      ["Инструменты","tool","tools",state.tools.filter(t=>!t.archived),t=>[t.name,t.inventory_no,t.serial_no,t.category,t.location]],
      ["Клиенты","client","clients",state.clients,c=>[c.full_name,c.phone,c.phone2]]
    ];
    out.innerHTML=groups.map(([label,kind,symbol,rows,fields])=>{
      const hits=rows.filter(r=>matches(term,...fields(r))).slice(0,6);if(!hits.length)return "";
      return `<h3>${label}</h3>`+hits.map(r=>{const [title,sub]=fields(r);return `<button class="result" data-edit-${kind}="${esc(r.id)}"><i>${icon(symbol)}</i><div><b>${esc(title)}</b><small>${esc(sub||"")}</small></div></button>`}).join("")
    }).join("")||emptyState("search","Совпадений нет","Попробуйте часть названия или несколько цифр телефона.");
  }
  q.oninput=search;q.onkeydown=e=>{if(e.key==="Enter")out.querySelector("button")?.click()};search();q.focus();
}
$("#globalSearch").onclick=openSearch;


function clientName(id,r){return state.clients.find(c=>c.id===id)?.full_name || r.client_name_snapshot || "Клиент"}
function toolName(r){return r.items?.map(i=>i.tool_name_snapshot).join(", ")||"Инструмент"}

function rentalStatus(r){
  if(r.status==="returned")return["Возвращён","green"];
  if(r.status==="cancelled")return["Отменён","red"];
  if(r.return_date<isoToday())return["Просрочен","red"];
  if(r.return_date===isoToday())return["Сегодня","orange"];
  return["Активен","green"];
}
function renderRentalTable(arr,actions=true){
  if(!arr.length)return`<div class="empty">Нет договоров.</div>`;
  return `<table class="data-table"><thead><tr><th>Договор</th><th>Клиент</th><th>Инструмент</th><th>Возврат</th><th>Сумма</th><th>Статус</th>${actions?"<th></th>":""}</tr></thead><tbody>`+
  arr.map(r=>{const [st,cl]=rentalStatus(r);return `<tr><td><b>${esc(r.contract_number)}</b><small class="muted">${fmtDate(r.contract_date||r.issue_date)}</small></td><td>${esc(clientName(r.client_id,r))}</td><td>${esc(toolName(r))}</td><td>${fmtDate(r.return_date)} ${esc(r.return_time||"")}</td><td class="money">${money(r.total_amount)}</td><td><span class="pill ${cl}">${st}</span></td>${actions?`<td><button class="text-btn" data-edit-rental="${esc(r.id)}">Открыть</button>${r.status==="active"?`<button class="text-btn" data-return-rental="${esc(r.id)}">Вернуть</button>`:""}</td>`:""}</tr>`}).join("")+
  "</tbody></table>";
}
function renderRentals(){
  const html=`<div class="toolbar"><input id="rentalSearch" class="search" placeholder="Поиск договора, клиента, телефона, инструмента…"><select id="rentalStatus" class="select"><option value="">Все статусы</option><option value="active">Активные</option><option value="today">Сегодня</option><option value="overdue">Просроченные</option><option value="returned">Возвращённые</option><option value="cancelled">Отменённые</option></select></div><div class="panel"><div class="panel-head"><div><h3>История договоров</h3></div><span id="rentalCount" class="muted"></span></div><div id="rentalTable"></div></div>`;
  $("#rentalsView").innerHTML=html; $("#rentalSearch").oninput=renderRentalList;$("#rentalStatus").onchange=renderRentalList;renderRentalList();
}
function renderRentalList(){
  const q=$("#rentalSearch")?.value.trim().toLowerCase()||"",f=$("#rentalStatus")?.value||"",today=isoToday();
  const arr=state.rentals.filter(r=>{
    const txt=[r.contract_number,clientName(r.client_id,r),r.client_phone_snapshot,toolName(r)].join(" ").toLowerCase();
    if(q&&!matches(q,txt,r.client_phone_snapshot,state.clients.find(c=>c.id===r.client_id)?.phone))return false;
    if(f==="cancelled"&&r.status!=="cancelled")return false;if(f==="active"&&r.status!=="active")return false;if(f==="returned"&&r.status!=="returned")return false;
    if(f==="today"&&!(r.status==="active"&&r.return_date===today))return false;if(f==="overdue"&&!(r.status==="active"&&r.return_date<today))return false;
    return true;
  });
  arr.sort((a,b)=>String(b.contract_date||b.issue_date).localeCompare(String(a.contract_date||a.issue_date))||String(b.contract_number).localeCompare(String(a.contract_number),"ru",{numeric:true}));
  $("#rentalCount").textContent=`Найдено ${arr.length}`;$("#rentalTable").innerHTML=renderRentalTable(arr,true);
}



function toolUiStatus(t){
  if(["repair","broken","retired"].includes(t.status))return [t.status==="repair"?"Ремонт":t.status==="broken"?"Сломан":"Списан",t.status==="broken"?"red":"orange"];
  if(activeRentals().some(r=>r.items?.some(i=>i.tool_id===t.id)))return["В аренде","red"];
  return["Свободен","green"];
}


function renderTools(){
  const cats=[...new Set(state.tools.filter(t=>!t.archived).map(t=>t.category).filter(Boolean))].sort((a,b)=>cleanCategory(a).localeCompare(cleanCategory(b),"ru"));
  $("#toolsView").innerHTML=`<div class="toolbar"><input id="toolFilter" class="search" type="search" placeholder="Название, номер или место хранения"><select id="toolCat" class="select"><option value="">Все категории</option>${cats.map(c=>`<option value="${esc(c)}">${esc(cleanCategory(c))}</option>`).join("")}</select><select id="toolStatus" class="select"><option value="">Все статусы</option><option value="free">Свободен</option><option value="rented">В аренде</option><option value="repair">В ремонте</option><option value="broken">Сломан</option><option value="retired">Списан</option></select><button class="btn primary" id="toolNew">＋ Инструмент</button></div><section class="panel"><div class="panel-head"><h3>Инструменты</h3><span id="toolCount" class="catalog-count"></span></div><div id="toolGrid" class="catalog-list"></div><button class="btn more" id="toolMore" hidden>Показать ещё</button></section>`;
  $("#toolNew").onclick=()=>openToolForm();
  for(const el of [$("#toolFilter"),$("#toolCat"),$("#toolStatus")])el[el.tagName==="INPUT"?"oninput":"onchange"]=()=>{state.toolLimit=30;renderToolGrid()};
  $("#toolMore").onclick=()=>{state.toolLimit=(state.toolLimit||30)+30;renderToolGrid()};
}
function renderToolGrid(){
  const q=$("#toolFilter").value,cat=$("#toolCat").value,sf=$("#toolStatus").value;
  const rented=new Set(activeRentals().flatMap(r=>(r.items||[]).map(i=>i.tool_id)));
  const arr=state.tools.filter(t=>{
    if(t.archived)return false;
    if((cat&&t.category!==cat)||!matches(q,t.name,t.category,t.inventory_no,t.serial_no,t.location))return false;
    const status=t.status&&t.status!=="available"?t.status:rented.has(t.id)?"rented":"free";return !sf||sf===status;
  }).sort((a,b)=>a.name.localeCompare(b.name,"ru",{numeric:true}));
  const limit=state.toolLimit||30;$("#toolMore").hidden=arr.length<=limit;
  $("#toolCount").textContent=`Найдено ${arr.length} из ${state.tools.filter(t=>!t.archived).length}`;
  $("#toolGrid").innerHTML=arr.slice(0,limit).map(t=>{
    const [st,cl]=toolUiStatus(t);return `<article class="catalog-row"><div class="catalog-name"><button class="text-btn" data-edit-tool="${esc(t.id)}">${esc(t.name)}</button><small>${esc(cleanCategory(t.category))} · Инв. ${esc(t.inventory_no||"—")} · Сер. ${esc(t.serial_no||"—")}</small></div><span class="catalog-location">${esc(t.location||"Место не указано")}</span><b>${t.rental_price==null?"Цена не задана":money(t.rental_price)+" / сут."}</b><span class="pill ${cl}">${st}</span><div>${st==="Свободен"?`<button class="text-btn" data-rent-tool="${esc(t.id)}">Выдать</button>`:""}</div></article>`;
  }).join("")||emptyState("search","Инструменты не найдены","Измените запрос или условия отбора.",'<button class="text-btn" data-reset-tools>Сбросить фильтры</button>');
}


function renderClients(){
  $("#clientsView").innerHTML=`<div class="toolbar"><input id="clientFilter" class="search" type="search" placeholder="ФИО, телефон…"><button class="btn primary" id="clientNew">＋ Клиент</button></div><div class="panel"><div class="panel-head"><div><h3>Клиенты</h3></div><span class="muted">${state.clients.length}</span></div><div id="clientTable" class="table-scroll"></div></div>`;
  $("#clientNew").onclick=()=>openClientForm();$("#clientFilter").oninput=renderClientList;renderClientList();
}
function renderClientList(){
  const q=$("#clientFilter")?.value.trim().toLowerCase()||"";
  const arr=state.clients.filter(c=>matches(q,c.full_name,c.phone,c.phone2)).sort((a,b)=>a.full_name.localeCompare(b.full_name,"ru"));
  $("#clientTable").innerHTML=arr.length?`<table class="data-table"><thead><tr><th>Клиент</th><th>Телефон</th><th>Договоров</th><th>Статус</th><th></th></tr></thead><tbody>${arr.map(c=>{const cnt=state.rentals.filter(r=>r.client_id===c.id).length;return `<tr><td><b>${esc(c.full_name)}</b><small class="muted">${c.blacklist?"В ЧС":"Клиент"}</small></td><td>${esc(c.phone||"—")}</td><td>${cnt}</td><td><span class="pill ${c.blacklist?"red":"green"}">${c.blacklist?"ЧС":"Активен"}</span></td><td><button class="text-btn" data-edit-client="${esc(c.id)}">Открыть</button></td></tr>`}).join("")}</tbody></table>`:`<div class="empty">Клиенты не найдены.</div>`;
}

function renderReports(){
  const from=state.filters.financeFrom||isoToday().slice(0,8)+"01",to=state.filters.financeTo||isoToday();
  const arr=state.rentals.filter(r=>String(r.contract_date||r.issue_date)>=from&&String(r.contract_date||r.issue_date)<=to&&r.status!=="cancelled");
  const revenue=arr.reduce((s,r)=>s+Number(r.total_amount||0),0),expenses=expenseFor(from,to),profit=revenue-expenses;
  const top={};arr.forEach(r=>r.items?.forEach(i=>{top[i.tool_name_snapshot]=(top[i.tool_name_snapshot]||0)+Number(i.subtotal||0)}));
  const topRows=Object.entries(top).sort((a,b)=>b[1]-a[1]).slice(0,10);
  $("#reportsView").innerHTML=`<div class="toolbar"><label class="field">С <input id="repFrom" type="date" value="${from}"></label><label class="field">По <input id="repTo" type="date" value="${to}"></label><button class="btn primary" id="repApply">Сформировать</button><button class="btn" id="repPrint">Печать</button></div><section id="reportPrintable" class="panel"><div class="report-box"><h2>Отчёт за ${fmtDate(from)} — ${fmtDate(to)}</h2><div class="finance-grid"><article class="kpi"><span>Договоров</span><b>${arr.length}</b></article><article class="kpi"><span>Выручка</span><b>${money(revenue)}</b></article><article class="kpi"><span>Затраты</span><b>${money(expenses)}</b></article><article class="kpi"><span>Результат</span><b>${money(profit)}</b></article></div></div><div class="two-col"><div class="report-box"><h3>Статусы</h3><p>Активных: <b>${arr.filter(r=>r.status==="active").length}</b></p><p>Возвращено: <b>${arr.filter(r=>r.status==="returned").length}</b></p><p>Просрочено сейчас: <b>${overdueRentals().length}</b></p><p>Залогов на руках: <b>${money(activeDeposits())}</b></p></div><div class="report-box"><h3>Что приносит деньги</h3>${topRows.length?`<table class="data-table"><thead><tr><th>Инструмент</th><th>Выручка</th></tr></thead><tbody>${topRows.map(x=>`<tr><td>${esc(x[0])}</td><td class="money">${money(x[1])}</td></tr>`).join("")}</tbody></table>`:`<p class="muted">Нет данных.</p>`}</div></div></section>`;
  $("#repApply").onclick=()=>applyPeriod("rep",renderReports);
  $("#repPrint").onclick=()=>printSection("Отчёт",$("#reportPrintable").outerHTML);
}
function applyPeriod(prefix,render){
  const from=$("#"+prefix+"From").value,to=$("#"+prefix+"To").value;
  if(!from||!to||from>to)return toast("Проверьте начало и конец периода.",true);
  state.filters.financeFrom=from;state.filters.financeTo=to;render();
}


function nextContractNumber(){
  const y=new Date().getFullYear(), nums=state.rentals.map(r=>String(r.contract_number||"")).filter(x=>x.startsWith(String(y)+"-")).map(x=>Number(x.split("-").pop())).filter(Number.isFinite);return `${y}-${String((Math.max(0,...nums)+1)).padStart(3,"0")}`;
}


function addDays(day,count){const d=new Date(day+"T12:00:00");d.setDate(d.getDate()+count);return localDate(d)}
function printSection(title,markup){
  const w=window.open("","_blank");
  if(!w){toast("Разрешите всплывающее окно для печати.",true);return}
  w.document.write(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:15px/1.5 Arial,sans-serif;color:#162d25;max-width:900px;margin:40px auto;padding:0 15px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ccc;padding:8px;text-align:left}.kpi{display:inline-grid;margin:8px 20px 8px 0}button{display:none}</style><body>${markup}</body></html>`);w.document.close();w.focus();w.print();
}
function rentalSummary(r){
  return `<h3>Договор № ${esc(r.contract_number)}</h3><p>${esc(clientName(r.client_id,r))} · ${esc(r.client_phone_snapshot||"")}</p><p>Выдача ${fmtDate(r.issue_date)} · Возврат ${fmtDate(r.return_date)} ${esc(r.return_time||"")}</p><table class="data-table"><thead><tr><th>Инструмент</th><th>Суток</th><th>Сумма</th></tr></thead><tbody>${(r.items||[]).map(i=>`<tr><td>${esc(i.tool_name_snapshot)}</td><td>${esc(i.days_count)}</td><td>${money(i.subtotal)}</td></tr>`).join("")}</tbody></table><p><b>Итого ${money(r.total_amount)}</b> · Залог ${money(r.deposit_amount)}</p>${r.notes?`<p>${esc(r.notes)}</p>`:""}`;
}
async function getPrintTemplate(version) {
  if(!cloud() && state.templates?.length){const found=version?state.templates.find(t=>t.version===version):state.templates.find(t=>t.active);if(found)return found}
  if (cloud()) {
    let query=supabase.from("rental_print_templates").select("version,document");
    query=version ? query.eq("version",version) : query.eq("active",true);
    const {data,error}=await query.single();
    if(error || !data) throw Error("Не удалось загрузить бланк договора. Проверьте подключение к общей базе.");
    return data;
  }
  const path=hosted ? "data/contract-demo.json" : "data/contract-local.json";
  const res=await fetch(path,{cache:"no-store"});
  if(!res.ok)throw Error("Бланк договора недоступен. Обновите страницу и повторите.");
  return res.json();
}
async function previewRental(r,template) {
  const account=state.user;
  try{
    const source=template || await getPrintTemplate(r.contract_details?.template_version);
    if(account!==state.user || !account)return;
    const client=state.clients.find(c=>c.id===r.client_id);
    const html=contractMarkup(source.document,r,client,state.tools);
    openModal("Договор № "+r.contract_number,'<div class="contract-preview"><div class="toolbar"><button class="btn primary" id="sendContractPrint" disabled>Печать / PDF</button><button class="btn" id="exitContractPrint">Закрыть</button></div><iframe title="Предпросмотр договора" sandbox="allow-same-origin allow-modals"></iframe></div>');
    const frame=$(".contract-preview iframe"),button=$("#sendContractPrint");
    frame.onload=()=>{button.disabled=false};
    frame.srcdoc=html;
    button.onclick=()=>{frame.contentWindow.focus();frame.contentWindow.print()};
    $("#exitContractPrint").onclick=closeModal;
  }catch(err){toast(err.message,true)}
}
function returnDialog(r) {
  const now=yakutskMoment(new Date());
  openModal("Возврат по договору № "+r.contract_number,'<form id="returnForm" class="stack"><div class="form-grid"><label class="field">Дата возврата<input type="date" name="day" required></label><label class="field">Время в Якутске<input type="time" name="clock" required></label><label class="field">Скидка на аренду, ₽<input name="discount" type="number" min="0" step=".01" value="0" required></label></div><div class="toolbar"><button type="submit" class="btn primary">Принять возврат</button><button type="button" class="btn" id="cancelReturn">Отмена</button></div></form>');
  const form=$("#returnForm"), f=form.elements;
  f.day.value=now.day;f.day.min=r.issue_date;f.clock.value=now.time;f.discount.max=r.total_amount;
  $("#cancelReturn").onclick=closeModal;
  form.onsubmit=async event=>{
    event.preventDefault();
    const at=new Date(f.day.value+"T"+f.clock.value+":00+09:00");
    if(!Number.isFinite(at.getTime()) || at>Date.now()+60000) return toast("Проверьте фактические дату и время возврата.",true);
    const discount=Number(f.discount.value);
    const patch={status:"returned",actual_return_at:at.toISOString(),return_discount:discount,total_amount:Math.round((Number(r.total_amount)-discount)*100)/100};
    try{
      if(cloud()){
        let query=supabase.from("rentals").update(patch).eq("id",r.id).eq("status","active");
        if(r.updated_at)query=query.eq("updated_at",r.updated_at);
        const {data,error}=await query.select("id").maybeSingle();
        if(error)throw error;if(!data)throw Error("Договор изменился. Обновите список перед возвратом.");
      }else{await upsert("rentals",{...r,...patch})}
    }catch(err){toast(err.message,true);return}
    playFeedback("returned");closeModal();
    try{await reloadData()}catch{toast("Возврат сохранён. Обновите список договоров.",true)}
    await previewRental({...r,...patch});
  };
  lockSubmit(form);
}

function openRentalForm(existing=null,initialTool=""){
  const r=existing||{},date=isoToday(),available=state.tools.filter(t=>(!t.archived && toolUiStatus(t)[0]==="Свободен")||r.items?.some(i=>i.tool_id===t.id));
  if(existing&&r.status!=="active"){openModal("Карточка договора",`<div class="stack"><div class="table-scroll">${rentalSummary(r)}</div><span class="pill">${rentalStatus(r)[0]}</span><button class="btn" id="printRental">Распечатать</button></div>`);$("#printRental").onclick=()=>previewRental(r);return}
  const rentalId=r.id||uid();let newClientId=uid();
  const options=state.clients.slice().sort((a,b)=>a.full_name.localeCompare(b.full_name,"ru")).map(c=>`<option value="${esc(c.id)}">${esc(c.full_name)}${c.phone?" · "+esc(c.phone):""}${c.blacklist?" · Чёрный список":""}</option>`).join("");
  openModal(r.id?"Договор № "+r.contract_number:"Новый договор",`<form id="rentalForm" class="stack">
    <div class="form-grid"><label class="field">Номер договора<input name="contract_number" value="${esc(r.contract_number||nextContractNumber())}" required></label><label class="field">Дата договора<input name="contract_date" type="date" value="${esc(r.contract_date||r.issue_date||date)}" required></label>
    <label class="field full">Клиент<select name="client_id" required><option value="">Выберите клиента</option>${options}<option value="__new">＋ Новый клиент</option></select></label>
    <fieldset class="rental-line full"><legend>Реквизиты арендатора в договоре</legend><div class="form-grid">${partyFieldsMarkup()}</div></fieldset>
    <label class="field">Время оформления в Якутске<input name="agreement_time" type="time" value="${esc(r.contract_details?.time ?? (r.id ? "" : yakutskMoment(new Date()).time))}"></label>
    <label class="field">Дата выдачи<input name="issue_date" type="date" value="${esc(r.issue_date||date)}" required></label><label class="field">Дата возврата<input name="return_date" type="date" value="${esc(r.return_date||addDays(date,1))}" required></label><label class="field">Время возврата<input name="return_time" type="time" value="${esc(r.return_time||"18:00")}"></label><label class="field">Суток<input name="days_count" type="number" min="1" step="1" required value="${esc(r.days_count||1)}"></label></div>
    <div id="rentalLines" class="stack"></div><button class="btn" type="button" id="addLine">＋ Ещё инструмент</button>
    <fieldset class="rental-line"><legend>Дополнительные позиции</legend><div id="extraRows"></div><button type="button" class="text-btn" id="addExtra">＋ Дополнительная позиция</button></fieldset>
    <label class="field">Дополнительные условия для печати<textarea name="additional_terms">${esc(r.contract_details?.additional_terms||"")}</textarea></label>
    <label class="field">Комментарий<textarea name="notes">${esc(r.notes||"")}</textarea></label>
    <div class="report-box"><b id="rentalTotal"></b><small id="rentalDeposit"></small></div>
    <div class="toolbar"><button class="btn primary" type="submit">Сохранить договор</button><button class="btn" type="submit" id="saveAndPrint">Сохранить и открыть печать</button>${r.id?'<button class="btn" type="button" id="printSavedContract">Печать сохранённого договора</button>':""}<button class="btn" type="button" id="cancelModal">Отмена</button></div></form>`);
  const f=$("#rentalForm"),fields=f.elements,lines=$("#rentalLines");
  if(r.id && !state.clients.some(c=>c.id===r.client_id))fields.client_id.add(new Option(r.client_name_snapshot||"Клиент из договора","__history"));
  fields.client_id.value=r.id ? (state.clients.some(c=>c.id===r.client_id)?r.client_id:"__history") : (!state.clients.length?"__new":"");
  function toggleClient(){
    const id=fields.client_id.value,person=state.clients.find(c=>c.id===id);
    const same=r.id && (id===r.client_id||id==="__history");
    fillParty(f,same?rentalParty(r,person):person);
    fields.party_full_name.required=true;
  }
  toggleClient();fields.client_id.onchange=()=>{newClientId=uid();toggleClient()};fields.return_date.min=fields.issue_date.value;
  if(r.id)$("#printSavedContract").onclick=()=>{if(!modal.dataset.dirty || confirm("Открыть сохранённый договор и закрыть несохранённые изменения?"))previewRental(r)};
  const extras=accessoryRows($("#extraRows"),r.contract_details?.extras,total);
  $("#addExtra").onclick=()=>extras.add();
  function total(){
    const rows=$$(".rental-line",lines);
    $("#rentalTotal").textContent="Аренда · "+money(($$("[name=extra_rate]",f).reduce((v,input)=>v+Math.round(Number(input.value)*100),0)+rows.reduce((v,el)=>v+Math.round(Number($("[name=price]",el).value)*100),0))*Number(fields.days_count.value)/100);
    $("#rentalDeposit").textContent="Залог отдельно · "+money(rows.reduce((v,el)=>v+Number($("[name=deposit]",el).value),0));
    rows.forEach(el=>$("[data-remove]",el).hidden=rows.length===1);
  }
  function addLine(item={},fromCatalog=""){
    const el=document.createElement("fieldset");el.className="rental-line";
    el.innerHTML=`<legend>Инструмент</legend><label class="field">Найти в каталоге<input type="search" placeholder="Название или инвентарный номер"></label><label class="field">Позиция<select name="tool_id" required></select></label><div class="form-grid"><label class="field">Наименование в договоре<input name="printed_name" required></label><label class="field">Серийный номер<input name="printed_serial"></label><label class="field">Инвентарный номер<input name="printed_inventory"></label><label class="field">Оценочная стоимость, ₽<input name="estimate" type="number" min="0" step=".01"></label><label class="field">Цена за сутки, ₽<input name="price" type="number" min="0" step=".01" required></label><label class="field">Залог, ₽<input name="deposit" type="number" min="0" step=".01" required></label></div><button type="button" class="text-btn" data-remove>Убрать позицию</button>`;
    lines.append(el);const sel=$("select",el),find=$("input[type=search]",el),price=$("[name=price]",el),deposit=$("[name=deposit]",el);
    const chosen=item.tool_id||fromCatalog||"";const originalMissing=item.tool_name_snapshot&&!state.tools.some(t=>t.id===chosen);
    function populate(keep){
      const choices=available.filter(t=>t.id===keep||matches(find.value,t.name,t.inventory_no,t.serial_no));
      sel.innerHTML=`<option value="">Выберите инструмент</option>`+choices.map(t=>`<option value="${esc(t.id)}">${esc(t.name)} · ${esc(t.inventory_no||"без №")}</option>`).join("");
      if(originalMissing){const historical=new Option(item.tool_name_snapshot,"__history");sel.add(historical)}
      sel.value=keep; if(sel.selectedIndex<0)sel.value="";
    }
    el.savedLine=item;populate(originalMissing?"__history":chosen);
    find.oninput=()=>{populate(sel.value)};
    function tariff(){const t=state.tools.find(x=>x.id===sel.value);el.elements.printed_name.value=t?.name||"";el.elements.printed_serial.value=t?.serial_no||"";
      el.elements.printed_inventory.value=t?.inventory_no||"";el.elements.estimate.value=t?.estimated_value??"";price.value=t?.rental_price??0;deposit.value=t?.deposit??0;total()}
    sel.onchange=tariff;tariff();
    if(item.tool_name_snapshot){
      el.elements.printed_name.value=item.tool_name_snapshot;el.elements.printed_inventory.value=item.inventory_snapshot||"";
      el.elements.printed_serial.value=item.serial_snapshot||"";
      const saved=r.contract_details?.positions?.find(x=>item.tool_id ? x.tool_id===item.tool_id : !x.tool_id && x.name===item.tool_name_snapshot && x.serial===item.serial_snapshot);
      if(saved)el.elements.estimate.value=saved.estimate??"";
    }
    if(item.rental_price!=null)price.value=item.rental_price;if(item.deposit!=null)deposit.value=item.deposit;
    $("[data-remove]",el).onclick=()=>{el.remove();total()};total();
  }
  if(r.items?.length)r.items.forEach(i=>addLine(i));else addLine({},initialTool);
  $("#addLine").onclick=()=>addLine();$("#cancelModal").onclick=closeModal;
  f.oninput=e=>{
    const start=fields.issue_date.value,end=fields.return_date.value;
    if(["issue_date","return_date"].includes(e.target.name)&&start&&end){
      fields.return_date.min=start;
      fields.days_count.value=Math.max(1,(Date.parse(end)-Date.parse(start))/86400000);
    }else if(e.target===fields.days_count&&start&&fields.days_count.validity.valid)fields.return_date.value=addDays(start,Number(fields.days_count.value));
    total();
  };
  f.onsubmit=async e=>{
    e.preventDefault();if(f.dataset.saving)return;f.dataset.saving="yes";
    const buttons=$$("button[type=submit]",f);buttons.forEach(b=>b.disabled=true);
    const printing=e.submitter?.id==="saveAndPrint";
    try{
      const number=fields.contract_number.value.trim(),days=Number(fields.days_count.value);
      if(!number)throw Error("Укажите номер договора.");
      if(state.rentals.some(x=>x.id!==r.id&&x.contract_number===number))throw Error("Такой номер договора уже используется.");
      const positions=[],additional=extras.values();const used=new Set();const items=$$(".rental-line",lines).map(el=>{
        const id=$("select",el).value,price=Number($("[name=price]",el).value),deposit=Number($("[name=deposit]",el).value);
        const t=state.tools.find(x=>x.id===id),old=el.savedLine;
        if(id!=="__history"&&(!t||used.has(id)||(!r.items?.some(i=>i.tool_id===id)&&toolUiStatus(t)[0]!=="Свободен")))throw Error("Выберите разные свободные инструменты.");
        const name=el.elements.printed_name.value.trim(),serial=el.elements.printed_serial.value.trim();
        if(!name)throw Error("Укажите наименование инструмента в договоре.");
        positions.push({tool_id:t?.id||null,name,serial,estimate:el.elements.estimate.value===""?null:Number(el.elements.estimate.value)});
        used.add(id);return {id:old.id,tool_id:t?.id||null,tool_name_snapshot:name,inventory_snapshot:el.elements.printed_inventory.value.trim(),serial_snapshot:serial,rental_price:price,days_count:days,deposit,subtotal:Math.round(price*days*100)/100};
      });
      const party=partyFromForm(f);
      if(!party.full_name)throw Error("Укажите ФИО арендатора.");
      let client=state.clients.find(x=>x.id===fields.client_id.value);
      const historical=fields.client_id.value==="__history" && r.id;
      if(!client && !historical && fields.client_id.value!=="__new")throw Error("Выберите клиента.");
      if(client?.blacklist&&!confirm("Клиент в чёрном списке. Оформить договор?"))return;
      const template=await getPrintTemplate(r.contract_details?.template_version);
      if(fields.client_id.value==="__new"){
        client=await saveClient({id:newClientId,...party,birth_date:party.birth_date||null,passport_date:party.passport_date||null,created_by:state.user.id});
        if(!state.clients.some(x=>x.id===client.id))state.clients.push(client);
        fields.client_id.add(new Option(party.full_name,client.id));fields.client_id.value=client.id;
      }
      const details={...r.contract_details,template_version:template.version,time:fields.agreement_time.value,party,positions,extras:additional,additional_terms:fields.additional_terms.value.trim()};
      const row={id:rentalId,legacy_id:r.legacy_id,contract_number:number,contract_date:fields.contract_date.value,contract_details:details,client_id:client?.id||null,client_name_snapshot:party.full_name,client_phone_snapshot:party.phone,issue_date:fields.issue_date.value,return_date:fields.return_date.value,return_time:fields.return_time.value||null,days_count:days,total_amount:(items.reduce((v,i)=>v+Math.round(i.subtotal*100),0)+additional.reduce((v,i)=>v+Math.round(i.rate*100)*days,0))/100,deposit_amount:items.reduce((v,i)=>v+i.deposit,0),status:"active",notes:fields.notes.value,created_by:r.created_by||state.user.id};
      const saved=await saveRental(row,items);playFeedback("saved");closeModal();
      try{await reloadData();toast("Договор "+number+" сохранён")}catch{toast("Договор сохранён. Обновите список.",true)}
      if(printing)await previewRental({...row,...saved,items},template);
    }catch(err){toast(err.message,true)}finally{delete f.dataset.saving;buttons.forEach(b=>b.disabled=false)}
  };
}


function lockSubmit(form){
  const submit=form.onsubmit;
  form.onsubmit=async event=>{
    event.preventDefault();
    const button=form.querySelector("button[type=submit]");
    if(button.disabled)return;
    button.disabled=true;
    try{await submit(event)}finally{button.disabled=false}
  };
}

async function openToolForm(existing){
  const t=existing||{};
  openModal(existing?"Инструмент":"Новый инструмент",`<form id="toolForm" class="stack"><div class="form-grid">
  <label class="field"><span>Название</span><input name="name" value="${esc(t.name||"")}" required></label>
  <label class="field"><span>Категория</span><input name="category" value="${esc(t.category||"Без категории")}"></label>
  <label class="field"><span>Инв. №</span><input name="inventory_no" value="${esc(t.inventory_no||"")}"></label>
  <label class="field"><span>s/n</span><input name="serial_no" value="${esc(t.serial_no||"")}"></label>
  <label class="field"><span>Аренда / сутки</span><input name="rental_price" type="number" min="0" step=".01" value="${esc(t.rental_price??"")}"></label>
  <label class="field"><span>Залог</span><input name="deposit" type="number" min="0" step=".01" value="${esc(t.deposit??"")}"></label>
  <label class="field"><span>Оценочная стоимость</span><input name="estimated_value" type="number" min="0" step=".01" value="${esc(t.estimated_value??"")}"></label>
  <label class="field"><span>Статус</span><select name="status">${["available","repair","broken","retired"].map(s=>`<option value="${s}" ${t.status===s?"selected":""}>${s==="available"?"Свободен":s==="repair"?"Ремонт":s==="broken"?"Сломан":"Списан"}</option>`).join("")}</select></label>
  <label class="field full">Место хранения<input name="location" value="${esc(t.location||"")}" placeholder="Например, склад 1, стеллаж Б"></label><label class="field full">Комплектация<textarea name="kit">${esc(t.kit||"")}</textarea></label><label class="field full">Описание<textarea name="description">${esc(t.description||"")}</textarea></label><label class="field full">Обслуживание<textarea name="service_note">${esc(t.service_note||t.service||"")}</textarea></label><label class="field full"><span>Примечание</span><textarea name="note">${esc(t.note||"")}</textarea></label>
  </div><div class="toolbar"><button class="btn primary" type="submit">Сохранить</button><button class="btn ghost" type="button" id="cancelModal">Отмена</button>${existing&&manager()?'<button class="text-btn danger" type="button" id="archiveTool">Удалить карточку</button>':""}</div></form>`);
  $("#cancelModal").onclick=closeModal;
  if($("#archiveTool"))$("#archiveTool").onclick=async event=>{
    if(activeRentals().some(r=>r.items?.some(i=>i.tool_id===t.id)))return toast("Сначала оформите возврат инструмента.",true);
    if(!confirm("Убрать «"+t.name+"» из каталога? История договоров сохранится."))return;
    const button=event.currentTarget;button.disabled=true;
    try{if(cloud()){const {error}=await supabase.rpc("kk_archive_tool",{tool:t.id,expected:t.updated_at});if(error)throw error}
      else await upsert("tools",{id:t.id,archived:true,status:"retired"});
      closeModal();await reloadData();toast("Карточка удалена из каталога")
    }catch(err){toast(err.message,true)}finally{button.disabled=false}
  };
  $("#toolForm").onsubmit=async e=>{e.preventDefault();try{const fd=new FormData(e.currentTarget);const row={id:t.id||undefined,legacy_id:t.legacy_id||undefined,name:String(fd.get("name")).trim(),category:String(fd.get("category")||"Без категории"),inventory_no:String(fd.get("inventory_no")||""),serial_no:String(fd.get("serial_no")||""),rental_price:fd.get("rental_price")===""?null:Number(fd.get("rental_price")),deposit:fd.get("deposit")===""?null:Number(fd.get("deposit")),estimated_value:fd.get("estimated_value")===""?null:Number(fd.get("estimated_value")),status:String(fd.get("status")),note:String(fd.get("note")||""),location:String(fd.get("location")||"").trim(),kit:String(fd.get("kit")||""),description:String(fd.get("description")||""),service_note:String(fd.get("service_note")||""),created_by:t.created_by||state.user?.id};if(!row.name)throw Error("Укажите название.");if(cloud()&&t.id){
    const {id,created_by,legacy_id,...fields}=row;
    const {data,error}=await supabase.from("tools").update(fields).eq("id",id).eq("updated_at",t.updated_at).eq("archived",false).select("id").maybeSingle();
    if(error)throw error;if(!data)throw Error("Карточка уже изменена. Скопируйте свои правки и откройте её заново.");
  }else await saveTool(row);playFeedback("saved");closeModal();await reloadData();toast("Инструмент сохранён")}catch(err){toast(err.message,true)}};
  lockSubmit($("#toolForm"));
}

function openClientForm(existing){
  const c=existing||{};
  openModal(existing?"Клиент":"Новый клиент",`<form id="clientForm" class="stack"><div class="form-grid">
  <label class="field"><span>ФИО</span><input name="full_name" value="${esc(c.full_name||"")}" required></label>
  <label class="field"><span>Телефон</span><input type="tel" name="phone" value="${esc(c.phone||"")}"></label>
  <label class="field"><span>Доп. телефон</span><input type="tel" name="phone2" value="${esc(c.phone2||"")}"></label>
  <label class="field"><span>Дата рождения</span><input name="birth_date" type="date" value="${esc(c.birth_date||"")}"></label>
  <label class="field"><span>Паспорт серия</span><input name="passport_series" value="${esc(c.passport_series||"")}"></label>
  <label class="field"><span>Паспорт номер</span><input name="passport_number" value="${esc(c.passport_number||"")}"></label>
  <label class="field"><span>Код подразделения</span><input name="passport_code" value="${esc(c.passport_code||"")}"></label>
  <label class="field"><span>Кем выдан</span><input class="full" name="passport_issued_by" value="${esc(c.passport_issued_by||"")}"></label>
  <label class="field"><span>Дата выдачи</span><input name="passport_date" type="date" value="${esc(c.passport_date||"")}"></label>
  <label class="field full"><span>Адрес</span><textarea name="address">${esc(c.address||"")}</textarea></label>
  <label class="field full"><span>Заметки</span><textarea name="notes">${esc(c.notes||"")}</textarea></label>
  <label style="display:flex;align-items:center;gap:8px"><input name="blacklist" type="checkbox" ${c.blacklist?"checked":""}> В чёрном списке</label>
  </div><div class="toolbar"><button class="btn primary" type="submit">Сохранить</button><button class="btn ghost" type="button" id="cancelModal">Отмена</button></div></form>`);
  $("#cancelModal").onclick=closeModal;
  $("#clientForm").onsubmit=async e=>{e.preventDefault();try{const fd=new FormData(e.currentTarget);const row={id:c.id||undefined,legacy_id:c.legacy_id||undefined,full_name:String(fd.get("full_name")).trim(),phone:String(fd.get("phone")||""),phone2:String(fd.get("phone2")||""),birth_date:fd.get("birth_date")||null,passport_series:String(fd.get("passport_series")||""),passport_code:String(fd.get("passport_code")||""),passport_number:String(fd.get("passport_number")||""),passport_issued_by:String(fd.get("passport_issued_by")||""),passport_date:fd.get("passport_date")||null,address:String(fd.get("address")||""),notes:String(fd.get("notes")||""),blacklist:fd.get("blacklist")==="on",created_by:state.user?.id};if(!row.full_name)throw Error("Укажите ФИО.");await saveClient(row);playFeedback("saved");closeModal();await reloadData();toast("Клиент сохранён")}catch(err){toast(err.message,true)}};
  lockSubmit($("#clientForm"));
}

function openExpenseForm(){
  openModal("Новый расход",`<form id="expenseForm" class="stack"><div class="form-grid">
    <label class="field"><span>Дата</span><input name="expense_date" type="date" value="${isoToday()}" required></label>
    <label class="field"><span>Категория</span><select name="category"><option>Ремонт</option><option>Запчасти</option><option>Расходники</option><option>Доставка / топливо</option><option>Прочее</option></select></label>
    <label class="field full"><span>Сумма</span><input name="amount" type="number" min=".01" step=".01" required></label>
    <label class="field full"><span>Комментарий</span><textarea name="note"></textarea></label>
  </div><div class="toolbar"><button class="btn primary" type="submit">Добавить расход</button><button class="btn ghost" type="button" id="cancelModal">Отмена</button></div></form>`);
  $("#cancelModal").onclick=closeModal;$("#expenseForm").onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);try{await saveExpense({expense_date:String(fd.get("expense_date")),category:String(fd.get("category")),amount:Number(fd.get("amount")),note:String(fd.get("note")||""),created_by:state.user?.id});state.filters.cashMonth=String(fd.get("expense_date")).slice(0,7);closeModal();await reloadData();playFeedback("saved");toast("Расход добавлен")}catch(err){toast(err.message,true)}}
  lockSubmit($("#expenseForm"));
}

function openEmployeeForm(existing){
  const e=existing||{};
  openModal(existing?"Сотрудник":"Новый сотрудник",`<form id="employeeForm" class="stack"><div class="form-grid"><label class="field"><span>ФИО</span><input name="full_name" value="${esc(e.full_name||"")}" required></label><label class="field"><span>Телефон</span><input type="tel" name="phone" value="${esc(e.phone||"")}"></label><label class="field"><span>Должность</span><input name="position" value="${esc(e.position||"")}"></label><label class="field"><span>Активен</span><select name="active"><option value="true" ${e.active!==false?"selected":""}>Да</option><option value="false" ${e.active===false?"selected":""}>Нет</option></select></label></div><div class="toolbar"><button class="btn primary" type="submit">Сохранить</button><button class="btn ghost" type="button" id="cancelModal">Отмена</button></div></form>`);
  $("#cancelModal").onclick=closeModal;$("#employeeForm").onsubmit=async ev=>{ev.preventDefault();const fd=new FormData(ev.currentTarget),row={id:e.id||undefined,legacy_id:e.legacy_id||undefined,full_name:String(fd.get("full_name")),phone:String(fd.get("phone")||""),position:String(fd.get("position")||""),active:fd.get("active")==="true"};try{await upsert("employees",row);playFeedback("saved");closeModal();await reloadData();toast("Сотрудник сохранён")}catch(err){toast(err.message,true)}}
  lockSubmit($("#employeeForm"));
}

document.addEventListener("click",async e=>{
  if(e.target.closest("[data-create-rental]"))return openRentalForm();
  const rentTool=e.target.closest("[data-rent-tool]");if(rentTool)return openRentalForm(null,rentTool.dataset.rentTool);
  if(e.target.closest("[data-reset-tools]")){Object.assign(state.filters,{toolFilter:"",toolCat:"",toolStatus:""});state.toolLimit=30;return renderView("tools")}

  const er=e.target.closest("[data-edit-rental]");if(er){const r=state.rentals.find(x=>x.id===er.dataset.editRental);if(r)openRentalForm(r)}
  const rr=e.target.closest("[data-return-rental]");if(rr){const r=state.rentals.find(x=>x.id===rr.dataset.returnRental);if(r)returnDialog(r)}
  const et=e.target.closest("[data-edit-tool]");if(et){const t=state.tools.find(x=>x.id===et.dataset.editTool);if(t)openToolForm(t)}
  const ec=e.target.closest("[data-edit-client]");if(ec){const c=state.clients.find(x=>x.id===ec.dataset.editClient);if(c)openClientForm(c)}
  const ee=e.target.closest("[data-edit-employee]");if(ee){const x=state.employees.find(x=>x.id===ee.dataset.editEmployee);if(x)openEmployeeForm(x)}
});



function renderSettings(){
  $("#settingsView").innerHTML=`<div class="two-col"><section class="setting-card"><h3>Резервная копия</h3><p class="muted">Сохраните договоры, каталог, клиентов, расходы, сотрудников и табель в одном JSON-файле.</p><button class="btn primary" id="exportCurrent">Скачать копию</button></section>
    <section class="setting-card"><h3>Восстановить данные</h3><p class="muted">${cloud()?"Записи из копии будут добавлены или обновлены в общей базе.":"Копия заменит данные локального кабинета в этом браузере."} Поддерживаются копии этой и прежней версии CRM.</p><div class="stack"><label class="field">Резервная копия<input id="legacyFile" type="file" accept=".json,application/json"></label><button class="btn" id="legacyImport">Проверить копию</button></div></section></div>
    <div class="two-col"><section class="setting-card"><h3>Исходный каталог</h3><p class="muted">Добавить отсутствующие позиции из каталога проекта. Ручные изменения и связи с договорами сохраняются.</p><button class="btn" id="seedCatalog">Дополнить каталог</button></section><section class="setting-card"><h3>Кабинет</h3><p>${esc(state.profile.full_name)} · ${esc(roleNames[state.role])}</p><p class="muted">${cloud()?"Данные хранятся в общей базе Supabase.":"Данные хранятся на этом устройстве в выбранном браузере. Для общего доступа подключите Supabase по инструкции в README."}</p></section></div>`;
  $("#exportCurrent").onclick=exportCurrent;$("#legacyImport").onclick=()=>importBackup($("#legacyFile").files[0]);$("#seedCatalog").onclick=seedCatalog;
  if(hosted&&cloud())$("#seedCatalog").closest("section").hidden=true;
}
async function importBackup(file){
  if(!file)return toast("Выберите файл резервной копии.",true);
  try{
    const source=JSON.parse((await file.text()).replace(/^\uFEFF/,"")),data=normalizeBackup(source);
    const labels=["Клиенты","Инструменты","Договоры","Расходы","Сотрудники","Записи табеля"];
    openModal("Проверка резервной копии",`<div class="stack"><p>${esc(file.name)}</p><div>${collections.map((k,i)=>`<div class="attention"><b>${labels[i]}</b><span>${data[k].length}</span></div>`).join("")}</div><p>${cloud()?"Совпадающие записи в общей базе будут обновлены.":"После подтверждения текущие локальные данные будут заменены содержимым файла."}</p><div class="toolbar"><button class="btn primary" id="confirmImport">Восстановить</button><button class="btn" id="cancelModal">Отмена</button></div></div>`);
    $("#cancelModal").onclick=closeModal;$("#confirmImport").onclick=async e=>{
      const b=e.currentTarget;b.disabled=true;
      try{
        if(cloud()){const pack=cloudBackup(structuredClone(data),state,source.app==="Кладовка Кулибина Web"||Array.isArray(source.rentals));const {error}=await supabase.rpc("kk_restore_workspace",{pack});if(error)throw error}
        else{const revision=state.revision;applyLocal({...Object.fromEntries(extraCollections.map(k=>[k,state[k]])),...data,revision});persistDemo()}
        closeModal();await reloadData();playFeedback("saved");toast("Данные восстановлены");
      }catch(err){toast(err.message,true)}finally{b.disabled=false}
    };
  }catch(err){toast("Не удалось прочитать копию. "+err.message,true)}
}
async function seedCatalog(){
  try{
    const existing=new Set(state.tools.map(t=>t.legacy_id).filter(Boolean));
    const rows=(await seedRows()).filter(t=>!existing.has(t.legacy_id));
    if(!rows.length)return toast("Все исходные позиции уже есть в каталоге");
    if(!confirm(`Добавить отсутствующие позиции: ${rows.length}?`))return;
    if(cloud()){
      const payload=rows.map(({id,legacy_id,name,category,inventory_no,serial_no,rental_price,deposit,estimated_value,status,note,description,video,service})=>({id,legacy_id,name,category,inventory_no,serial_no,rental_price,deposit,estimated_value,status,note,description,video_url:video,service_note:service}));
      const {error}=await supabase.from("tools").upsert(payload,{onConflict:"legacy_id",ignoreDuplicates:true});if(error)throw error
    }else{state.tools.push(...rows);persistDemo()}
    await reloadData();playFeedback("saved");toast("Каталог дополнен");
  }catch(err){toast(err.message,true)}
}
function renderEmployees(){
  const day=state.filters.shiftDay||isoToday();
  $("#employeesView").innerHTML=`<div class="toolbar"><button class="btn primary" id="empNew">＋ Сотрудник</button></div><section class="panel"><div class="panel-head"><h3>Команда</h3><span class="muted">${state.employees.length}</span></div><div id="employeeList"></div></section><section class="panel"><div class="panel-head"><h3>Табель</h3><label class="field">Дата смены<input type="date" id="shiftDay" value="${esc(day)}"></label></div><div id="shiftList"></div></section>`;
  $("#empNew").onclick=()=>openEmployeeForm();$("#shiftDay").onchange=e=>{state.filters.shiftDay=e.target.value||isoToday();renderEmployees()};
  $("#employeeList").innerHTML=state.employees.map(e=>`<div class="employee-row"><div><b>${esc(e.full_name)}</b><small>${esc(e.position||"")}</small></div><span>${esc(e.phone||"")}</span><span class="pill ${e.active?"green":""}">${e.active?"Активен":"Отключён"}</span><button class="text-btn" data-edit-employee="${esc(e.id)}">Изменить</button></div>`).join("")||emptyState("team","Сотрудников пока нет","Добавьте сотрудника, чтобы вести табель смен.");
  const statuses=["На смене","Выходной","Отпуск","Больничный"];
  const shifts=Array.isArray(state.timesheet)?state.timesheet:[];
  $("#shiftList").innerHTML=state.employees.filter(e=>e.active||shifts.some(s=>s.employee_id===e.id&&s.work_date===day)).map(e=>{
    const current=shifts.find(s=>s.employee_id===e.id&&s.work_date===day)?.status||"";
    return `<label class="employee-row"><b>${esc(e.full_name)}</b><select aria-label="Смена: ${esc(e.full_name)}" data-shift="${esc(e.id)}"><option value="">Без отметки</option>${[...new Set([...statuses,...(current?[current]:[])])].map(s=>`<option ${s===current?"selected":""}>${esc(s)}</option>`).join("")}</select></label>`;
  }).join("")||'<p class="empty">Нет сотрудников для отметки.</p>';
  $("#shiftList").onchange=async e=>{
    const el=e.target;if(!el.matches("[data-shift]"))return;el.disabled=true;
    const employee_id=el.dataset.shift,old=shifts.find(x=>x.employee_id===employee_id&&x.work_date===day);
    try{if(cloud()){const {error}=await supabase.from("timesheet").upsert({employee_id,work_date:day,status:el.value},{onConflict:"employee_id,work_date"});if(error)throw error}
    else await upsert("timesheet",{id:old?.id,employee_id,work_date:day,status:el.value});
    await reloadData();playFeedback("saved");toast("Табель сохранён")}catch(err){toast(err.message,true);renderEmployees()}
  };
}


async function exportCurrent(){
  const pack={app:"Кладовка Кулибина Web",version:3,createdAt:new Date().toISOString(),clients:state.clients,tools:state.tools,rentals:state.rentals,expenses:state.expenses,employees:state.employees,timesheet:state.timesheet,staff_notes:state.staff_notes,cash_entries:state.cash_entries,templates:state.templates};
  if(cloud()){const {data,error}=await supabase.from("rental_print_templates").select("version,active,document");if(error)return toast(error.message,true);pack.templates=data}
  const blob=new Blob([JSON.stringify(pack,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`kladovka-web-backup-${isoToday()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}


authInit().catch(err=>{if(state.user&&!cloud())return;state.user=null;showAuth("Не удалось подключиться. "+err.message)});
