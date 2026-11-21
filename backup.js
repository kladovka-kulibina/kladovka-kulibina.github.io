const tables=["clients","tools","rentals","expenses","employees","timesheet"];
const id=v=>v==null||v===""?null:String(v);
const day=()=>new Date().toLocaleDateString("sv-SE");
function array(x,name){if(!Array.isArray(x))throw Error("Некорректный раздел копии: "+name);return x}
function checkRows(rows,key){
  const seen=new Set();
  return array(rows,key).map(row=>{
    if(!row||typeof row!=="object"||Array.isArray(row))throw Error("Некорректная запись: "+key);
    const uuid=id(row.id)||crypto.randomUUID();
    if(seen.has(uuid))throw Error("Повтор идентификатора: "+key);seen.add(uuid);return {...row,id:uuid};
  });
}
export function normalizeBackup(source){
  if(!source||typeof source!=="object")throw Error("Ожидается JSON-копия CRM");
  const raw=source.localStorage||source;
  const get=k=>typeof raw[k]==="string"?JSON.parse(raw[k]):raw[k];
  const web=source.app==="Кладовка Кулибина Web"||Array.isArray(raw.rentals);
  if(!web&&!["clients","tools","contracts","expenses","employees","timesheet"].some(k=>k in raw))throw Error("Формат резервной копии не распознан");
  if(web&&(!Array.isArray(raw.rentals)||!Array.isArray(raw.clients)||!Array.isArray(raw.tools)))throw Error("Копия неполная: требуются договоры, клиенты и каталог.");
  const out={};
  out.clients=checkRows(get("clients")??[],"Клиенты").map(c=>({...c,full_name:c.full_name||c.clientName||c.name||"Клиент",phone:c.phone||c.clientPhone||"",phone2:c.phone2||c.clientPhone2||"",address:c.address||c.clientAddress||"",birth_date:c.birth_date||c.clientBirthDate||null,passport_series:c.passport_series||c.passportSeries||"",passport_number:c.passport_number||c.passportNumber||"",passport_issued_by:c.passport_issued_by||c.passportIssuedBy||"",passport_date:c.passport_date||c.passportDate||null}));
  out.tools=checkRows(get("tools")??[],"Каталог").map(t=>({...t,name:t.name||t.toolName||"Инструмент",category:t.category||"Без категории",inventory_no:t.inventory_no||t.toolInventory||t.inventory||"",serial_no:t.serial_no||t.toolSerial||t.serial||"",rental_price:t.rental_price??t.rentPrice??null,estimated_value:t.estimated_value??t.estimatedValue??null,status:t.status||(t.available===false?"repair":"available")}));
  out.rentals=checkRows((web?get("rentals"):get("contracts"))??[],"Договоры").map(r=>{
    if(web)return {...r,client_id:id(r.client_id),items:array(r.items??[],"Позиции договора").map(i=>({...i,tool_id:id(i.tool_id)}))};
    const client=id(r.client_id??r.clientId)||out.clients.find(c=>r.clientName&&c.full_name===r.clientName)?.id||null;
    const tool=id(r.tool_id??r.toolId)||out.tools.find(t=>r.toolInventory&&t.inventory_no===r.toolInventory)?.id||null;
    const days=Number(r.days_count??r.daysCount??1),total=Number(r.total_amount??r.totalAmount??0),deposit=Number(r.deposit_amount??r.deposit??0);
    return {...r,contract_number:String(r.contract_number||r.contractNumber||r.id),contract_date:r.contract_date||r.contractDate||r.issueDate||day(),client_id:client,client_name_snapshot:r.clientName||"",client_phone_snapshot:r.clientPhone||"",issue_date:r.issue_date||r.issueDate||day(),return_date:r.return_date||r.returnDate||day(),return_time:r.return_time||r.returnTime||"18:00",days_count:days,total_amount:total,deposit_amount:deposit,status:r.status||(r.returned?"returned":"active"),items:[{tool_id:tool,tool_name_snapshot:r.toolName||"",inventory_snapshot:r.toolInventory||"",serial_snapshot:r.toolSerial||"",rental_price:Number(r.rentPrice||0),deposit,days_count:days,subtotal:total}]};
  });
  out.expenses=checkRows(get("expenses")??[],"Расходы").map(e=>({...e,expense_date:e.expense_date||e.date||day(),category:e.category||"Прочее",amount:Number(e.amount||0)}));
  out.employees=checkRows(get("employees")??[],"Сотрудники").map(e=>({...e,full_name:e.full_name||e.name||"Сотрудник",active:e.active!==false}));
  const shifts=get("timesheet")??[];
  if(Array.isArray(shifts))out.timesheet=checkRows(shifts,"Табель").map(x=>({...x,employee_id:id(x.employee_id??x.employeeId),work_date:x.work_date||x.date}));
  else{
    out.timesheet=[];
    for(const [employee,dates] of Object.entries(shifts)){
      if(!dates||typeof dates!=="object")throw Error("Неизвестный формат табеля. Проверьте поле timesheet.");
      for(const [date,value] of Object.entries(dates)){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error("Неизвестный формат даты в табеле.");
        out.timesheet.push({id:crypto.randomUUID(),employee_id:employee,work_date:date,status:typeof value==="string"?value:value.status||""});
      }
    }
  }
  for(const record of out.rentals){
    if(!record.contract_number||!record.issue_date||!record.return_date||!["active","returned","cancelled"].includes(record.status))
      throw Error("У договора отсутствует номер, дата или статус.");
    if(!Number.isFinite(Number(record.total_amount??0))||!Number.isFinite(Number(record.deposit_amount??0)))
      throw Error("Некорректная сумма в договоре.");
  }
  return out;
}
export function cloudBackup(data,current,web){
  const maps={},uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  for(const k of tables){maps[k]=new Map();for(const row of data[k]){
    const old=row.id,legacy=row.legacy_id||(!web||!uuid.test(old)?old:null);
    const existing=current[k]?.find(x=>x.id===old||(legacy&&x.legacy_id===legacy)||(k==="timesheet"&&x.employee_id===maps.employees?.get(row.employee_id)&&x.work_date===row.work_date));
    row.id=existing?.id||(uuid.test(old)?old:crypto.randomUUID());maps[k].set(old,row.id);if(k!=="timesheet")row.legacy_id=legacy;delete row.created_by;
  }}
  const ref=(table,value)=>{if(value==null)return null;const result=maps[table].get(String(value));if(!result)throw Error("В копии отсутствует связанная запись: "+table);return result};
  for(const r of data.rentals){r.client_id=ref("clients",r.client_id);for(const i of r.items){i.tool_id=ref("tools",i.tool_id);delete i.id}}
  for(const e of data.expenses)e.rental_id=ref("rentals",e.rental_id);
  for(const t of data.timesheet)t.employee_id=ref("employees",t.employee_id);
  return data;
}

