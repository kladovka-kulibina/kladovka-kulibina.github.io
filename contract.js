const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const calendar = value => /^\d{4}-\d{2}-\d{2}/.test(value || "") ? value.slice(0,10).split("-").reverse().join(".") : "";
const numberText = value => value == null || value === "" ? "" : Number(value).toLocaleString("ru-RU",{maximumFractionDigits:2});
export const partyFields = [
  ["full_name","ФИО","text"],["birth_date","Дата рождения","date"],
  ["passport_series","Серия паспорта","text"],["passport_number","Номер паспорта","text"],
  ["passport_issued_by","Кем выдан паспорт","text"],["passport_date","Дата выдачи","date"],
  ["passport_code","Код подразделения","text"],["address","Адрес регистрации","text"],
  ["phone","Основной телефон","tel"],["phone2","Дополнительный телефон","tel"]
];
export function partyFieldsMarkup() {
  return partyFields.map(([name,label,type])=>'<label class="field">'+label+'<input name="party_'+name+'" type="'+type+'" autocomplete="off"></label>').join("");
}
export function partyFromForm(form) {
  return Object.fromEntries(partyFields.map(([name])=>[name,form.elements["party_"+name].value.trim()]));
}
export function fillParty(form,person) {
  for (const [name] of partyFields) form.elements["party_"+name].value=person?.[name] || "";
}
export function rentalParty(rental,client) {
  return rental.contract_details?.party || {...client,
    full_name:rental.client_name_snapshot || client?.full_name || "",
    phone:rental.client_phone_snapshot || client?.phone || ""};
}
export function yakutskMoment(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return {day:"",time:""};
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Yakutsk",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date).map(p=>[p.type,p.value]));
  return {day:parts.year+"-"+parts.month+"-"+parts.day,time:parts.hour+":"+parts.minute};
}
export function accessoryRows(container,initial,onRemove) {
  function add(item={}) {
    const row=document.createElement("div");
    row.className="contract-extra form-grid";
    row.innerHTML='<label class="field">Наименование<input name="extra_name"></label><label class="field">Оценочная стоимость, ₽<input name="extra_value" type="number" min="0" step=".01"></label><label class="field">Аренда за сутки, ₽<input name="extra_rate" type="number" min="0" step=".01"></label><button class="text-btn" type="button">Убрать</button>';
    row.querySelector("[name=extra_name]").value=item.name || "";
    row.querySelector("[name=extra_value]").value=item.value ?? "";
    row.querySelector("[name=extra_rate]").value=item.rate ?? "";
    row.querySelector("button").onclick=()=>{row.remove();onRemove?.()};
    container.append(row);
  }
  (initial || []).forEach(add);
  return {add,values() {
    return Array.from(container.children).map(row=>{
      const name=row.querySelector("[name=extra_name]").value.trim(), value=row.querySelector("[name=extra_value]").value;
      const rate=row.querySelector("[name=extra_rate]").value;
      if(!name && (value!=="" || rate!=="")) throw Error("Введите наименование дополнительной позиции.");
      return {name,value:value==="" ? null : Number(value),rate:Number(rate)};
    }).filter(x=>x.name);
  }};
}
function blank(value, width=10) {
  return value === "" || value == null ? "_".repeat(width) : escapeHtml(value);
}
function substitute(text,values) {
  let i=0;
  return escapeHtml(text).replace(/_+/g,(match,index,full)=>{
    if(i>=values.length)return match;
    const value=values[i++];
    const label=blank(value,Math.min(match.length,24));
    if(!value && value!==0)return label;
    const before=/[\p{L}\p{N}№.:)]/u.test(full[index-1]||"")?" ":"";
    const after=/[\p{L}\p{N}№]/u.test(full[index+match.length]||"")?" ":"";
    return before+"<strong>"+label+"</strong>"+after;
  });
}
function para(text,cls="") {return '<p class="'+cls+'">'+text+'</p>'}
function cssString(text) {return '"'+text.replace(/[^А-Яа-яЁёA-Za-z_ /.-]/g," ").replace(/\s+/g," ").trim()+'"'}
export function contractMarkup(template,r,client,tools) {
  const source=template?.paragraphs;
  if(!Array.isArray(source) || source.length!==75) throw Error("Не удалось прочитать шаблон договора.");
  const d=r.contract_details || {}, person=rentalParty(r,client), lines=[];
  const p=(i,values=[],cls="")=>para(substitute(source[i],values).replaceAll("\n","<br>"),cls);
  const when=calendar(r.contract_date || r.issue_date), termDate=calendar(r.return_date);
  lines.push(p(0,[r.contract_number],"title"),'<div class="dateline"><span>'+escapeHtml(source[1].split(/\s{2,}/)[0])+'</span><span>'+blank(when)+' г. &nbsp; Время '+blank(d.time,5)+'</span></div>');
  lines.push(p(3,[person.full_name]),p(5,[calendar(person.birth_date),person.passport_number,person.passport_series]),
    p(7,[person.passport_issued_by,calendar(person.passport_date),person.passport_code]),p(9,[person.address]),p(10,[],"heading"),p(11));
  const items=r.items || [];
  for(let i=0;i<Math.max(3,items.length);i++){
    const item=items[i] || {}, tool=item.tool_id ? tools.find(t=>t.id===item.tool_id) : null;
    const keyed=(d.positions||[]).find(x=>item.tool_id ? x.tool_id===item.tool_id : !x.tool_id && x.name===item.tool_name_snapshot && x.serial===item.serial_snapshot);
    const estimate=keyed ? keyed.estimate : tool?.estimated_value;
    const a=source[12].replace(/^1\./,(i+1)+".");
    lines.push('<div class="keep">'+para(substitute(a,[item.tool_name_snapshot,item.serial_snapshot]))+
      p(13,[numberText(estimate),numberText(item.rental_price),item.inventory_snapshot,numberText(item.deposit)])+'</div>');
  }
  lines.push(p(18,[],"keep-next"));
  const extras=d.extras || [];
  for(let i=0;i<Math.max(3,extras.length);i++){
    const item=extras[i] || {};
    const pattern=source[20].replace(/^2\./,(i+1)+".");
    lines.push(para(substitute(pattern,[item.name,numberText(item.value)])+(item.rate ? " · Аренда "+numberText(item.rate)+" ₽/сут. × "+numberText(r.days_count)+" = "+numberText(item.rate*r.days_count)+" ₽" : ""),item.name?"filled":""));
  }
  if(r.total_amount!=null) lines.push(para("Итого за аренду: "+numberText(r.total_amount)+" ₽"+(r.return_discount?" (скидка "+numberText(r.return_discount)+" ₽)":"")+". Залог: "+numberText(r.deposit_amount||0)+" ₽.","filled"));
  if(d.additional_terms)lines.push(para(escapeHtml(d.additional_terms).replaceAll("\n","<br>"),"filled"));
  lines.push(para(substitute(source[22],[calendar(r.issue_date)])+" "+substitute(source[23],[termDate+(r.return_time?" "+r.return_time.slice(0,5):"")])));
  for(let i=24;i<=57;i++) lines.push(p(i,[],[28,36,40,49,52,57].includes(i)?"heading":"rule"));
  const left=[],right=[];
  for(let i=58;i<=64;i++){
    const [a,b=""]=source[i].split("\t");
    left.push(para(escapeHtml(a)));
    const fields={59:[person.full_name],60:[person.passport_series,person.passport_number],61:[person.address],62:[" "],63:[person.phone],64:[person.phone2]};
    right.push(para(substitute(b,fields[i]||[])));
  }
  lines.push('<section class="parties keep"><div>'+left.join("")+'</div><div>'+right.join("")+'</div></section>');
  const signatures=source[66].trim().split(/\s{2,}/);
  const initials=String(person.full_name||"").trim().split(/\s+/);
  const shortName=initials.length>1 ? initials[0]+" "+initials.slice(1).map(x=>x.charAt(0)+".").join("") : initials[0];
  lines.push('<div class="sig"><span>'+escapeHtml(signatures[0])+'</span><span>'+substitute(signatures.slice(1).join(" ")||"_________________/_____________",[null,shortName])+'</span></div>');
  const returned=r.status==="returned" && r.actual_return_at ? yakutskMoment(r.actual_return_at) : {day:"",time:""};
  lines.push('<section class="return keep">',p(68,[],"heading"),p(69,[r.contract_number,when]),
    p(70,[r.status==="returned"?numberText(r.return_discount):""]),p(71,[calendar(returned.day),...returned.time.split(":")]),
    '<div class="sig">'+source[73].split("\t").map(s=>'<span>'+escapeHtml(s)+'</span>').join("")+'</div></section>');
  const footer=template.footer.trim().split(/\s{2,}|\t/).filter(Boolean);
  const footerLeft=cssString(footer[0]||"______________Арендодатель"), footerRight=cssString(footer.slice(1).join(" ")||"V ___________Арендатор");
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Договор '+escapeHtml(r.contract_number)+'</title><style>'+
    '@page{size:A4 portrait;margin:12.7mm 12.7mm 17mm;@bottom-left{content:'+footerLeft+';font:9pt "Times New Roman",serif}@bottom-right{content:'+footerRight+';font:9pt "Times New Roman",serif}}'+
    '*{box-sizing:border-box}body{font:10pt/1.12 "Times New Roman",Times,serif;color:#000;margin:0;overflow-wrap:anywhere}p{margin:0 0 1.4pt;orphans:2;widows:2}.rule,.filled{font-weight:bold}.title,.heading{text-align:center;font-weight:bold}.title{font-size:11pt;margin-bottom:4pt}.heading{margin:4pt 0 2pt;break-after:avoid}.dateline,.sig,.parties{display:flex;justify-content:space-between;gap:4mm}.dateline{margin:2pt 0 6pt}.sig{margin:6pt 0 4pt;break-inside:avoid}.parties>div{width:50%}.parties p{min-height:1.12em}.parties p:first-child{font-weight:bold}.keep{break-inside:avoid}.keep-next{break-after:avoid}.return{margin-top:5pt}@media screen{html{background:#e5e7e5;padding:8px}body{background:white;max-width:210mm;margin:auto;padding:12.7mm;box-shadow:0 1px 5px #bbb}}'+
    '</style></head><body>'+lines.join("")+'</body></html>';
}
