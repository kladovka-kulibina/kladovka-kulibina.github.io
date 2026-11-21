const rowsPerPage = 25;
const columnsPerPage = 10;
const collator = new Intl.NumberFormat("ru-RU");
const time = stamp => stamp ? new Date(stamp).toLocaleString("ru-RU", {dateStyle:"short",timeStyle:"short"}) : "—";
const letter = column => column > 26 ? letter(Math.floor((column - 1) / 26)) + letter((column - 1) % 26 + 1) : String.fromCharCode(64 + column);
const normalized = value => String(value ?? "").toLocaleLowerCase("ru-RU").replaceAll("ё","е");
const display = cell => cell.v === true ? "Да" : cell.v === false ? "Нет" : cell.v == null ? cell.f || "" : String(cell.v);
const searchable = cell => normalized([display(cell), cell.f, cell.note, cell.by, cell.link].filter(Boolean).join(" "));
function externalLink(raw) {
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

export async function renderWorkbook({root, db, state, online, esc, toast}) {
  const panel = document.createElement("section");
  panel.className = "panel workbook-panel";
  root.replaceChildren(panel);
  const current = () => panel.parentNode === root && state.user && state.role === "owner" && state.view === "workbook";
  if (!online || state.role !== "owner") {
    panel.textContent = "Таблица доступна после входа владельца в общую базу.";
    return;
  }
  const read = async (part, tab_name = null) => {
    const result = await db.rpc("kk_sheet_read", {part, tab_name});
    if (result.error) throw result.error;
    return result.data;
  };
  const refresh = () => renderWorkbook({root, db, state, online, esc, toast});
  panel.innerHTML = '<p role="status">Загрузка списка листов…</p>';
  let manifest;
  try { manifest = await read("manifest"); }
  catch {
    if (current()) {
      panel.innerHTML = '<p role="alert">Не удалось загрузить книгу.</p><button class="btn">Повторить</button>';
      panel.querySelector("button").onclick = refresh;
    }
    return;
  }
  if (!current()) return;
  const tabs = manifest?.sheets || [];
  const review = manifest?.review || [];
  panel.innerHTML = `<div class="panel-head"><div><h3>Рабочая книга</h3><p class="muted">Листов ${tabs.length} · Заполненных строк ${collator.format(tabs.reduce((sum,t) => sum + t.count, 0))}</p></div>
    <div class="wb-actions"><button class="btn" data-refresh>Обновить</button><button class="btn primary" data-download ${tabs.length ? "" : "disabled"}>Скачать Excel</button></div></div>
    <p class="muted wb-times">Последняя проверка ${esc(time(manifest?.checked_at))} · Данные изменились ${esc(time(manifest?.changed_at))}</p>
    ${review.length ? `<details class="wb-review"><summary>Прайс · требуют проверки (${review.length})</summary><ul>${review.map(x => `<li><button class="text-btn" data-line="${Number(x.line)}">Строка ${Number(x.line)}</button> — ${esc(x.reason)}</li>`).join("")}</ul></details>` : ""}
    ${tabs.length ? `<div class="wb-controls"><label class="field">Лист<select data-tab>${tabs.map((t,i) => `<option value="${i}">${esc(t.name)}</option>`).join("")}</select></label>
    <label class="field">Поиск по листу<input type="search" data-search placeholder="Значение, формула или примечание"></label></div>
    <div data-body aria-live="polite"></div>` : '<p>Книга появится после первого импорта.</p>'}`;
  const el = selector => panel.querySelector(selector);
  el("[data-refresh]").onclick = refresh;
  el("[data-download]").onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const data = await read("archive");
      if (!current()) return;
      if (!data?.base64) throw Error();
      const bytes = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
      const link = document.createElement("a");
      link.href = url; link.download = "Кладовка Кулибина.xlsx"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch { if (current()) toast("Не удалось скачать книгу. Повторите попытку.", true); }
    finally { button.disabled = false; }
  };
  if (!tabs.length) return;
  const select = el("[data-tab]"), search = el("[data-search]"), body = el("[data-body]");
  select.value = String(Math.max(0, tabs.findIndex(x => x.name === state.filters.workbookTab)));
  let index = 0, colStart = 1, rows = [], matches = [], generation = 0;
  function cellHtml(cell) {
    if (!cell) return "";
    const label = esc(display(cell)), href = externalLink(cell.link);
    const more = [cell.f ? `Формула: ${cell.f}` : "",cell.note ? `${cell.by ? cell.by + ": " : ""}${cell.note}` : "",cell.link && !href ? cell.link : ""].filter(Boolean);
    return (href ? `<a href="${esc(href)}" rel="noopener noreferrer" target="_blank">${label || "Открыть ссылку"}</a>` : label)
      + (more.length ? `<details><summary>Подробности</summary>${more.map(v => `<div>${esc(v)}</div>`).join("")}</details>` : "");
  }
  function render() {
    const totalCols = tabs[Number(select.value)].columns, end = Math.min(colStart + columnsPerPage - 1, totalCols);
    const cols = Array.from({length:Math.max(0,end-colStart+1)}, (_,i) => colStart+i);
    const slice = matches.slice(index,index+rowsPerPage);
    body.innerHTML = `<div class="wb-pages"><div><button class="btn" data-prev ${index ? "" : "disabled"} aria-label="Предыдущие строки">←</button>
      <span>${matches.length ? `${index+1}–${index+slice.length} из ${collator.format(matches.length)}` : "Строк нет"}</span>
      <button class="btn" data-next ${index+rowsPerPage < matches.length ? "" : "disabled"} aria-label="Следующие строки">→</button></div>
      ${totalCols>columnsPerPage ? `<div><button class="btn" data-left ${colStart>1 ? "" : "disabled"} aria-label="Предыдущие столбцы">←</button>
      <span>Столбцы ${letter(colStart)}–${letter(end)}</span><button class="btn" data-right ${end<totalCols ? "" : "disabled"} aria-label="Следующие столбцы">→</button></div>` : ""}</div>
      ${slice.length ? `<div class="wb-scroll" tabindex="0" aria-label="Строки листа"><table class="wb-table"><thead><tr><th scope="col">№</th>${cols.map(c => `<th scope="col">${letter(c)}</th>`).join("")}</tr></thead><tbody>
      ${slice.map(([n,values]) => `<tr><th scope="row">${n}</th>${cols.map(c => `<td>${cellHtml(values[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "<p>Совпадений нет.</p>"}`;
    el("[data-prev]").onclick = () => {index-=rowsPerPage;render()};
    el("[data-next]").onclick = () => {index+=rowsPerPage;render()};
    if (el("[data-left]")) {
      el("[data-left]").onclick = () => {colStart=Math.max(1,colStart-columnsPerPage);render()};
      el("[data-right]").onclick = () => {colStart+=columnsPerPage;render()};
    }
  }
  function filter() {
    const q=normalized(search.value.trim());
    index=0;colStart=1;
    matches=q ? rows.filter(([,values]) => Object.values(values).some(c => searchable(c).includes(q))) : rows;
    if(q && matches.length) {
      const first=Object.entries(matches[0][1]).find(([,cell])=>searchable(cell).includes(q));
      colStart=1+columnsPerPage*Math.floor((Number(first[0])-1)/columnsPerPage);
    }
    render();
  }
  async function load(line) {
    const ticket=++generation, tab=tabs[Number(select.value)];
    state.filters.workbookTab=tab.name;search.value="";search.disabled=true;rows=[];matches=[];
    body.innerHTML='<p role="status">Загрузка листа…</p>';
    try {
      const result = await read("rows",tab.name);
      if (!current() || ticket !== generation) return;
      if (!Array.isArray(result)) throw Error();
      rows=result;matches=rows;colStart=1;
      index=line ? Math.max(0,Math.floor(rows.findIndex(([r]) => r===line)/rowsPerPage)*rowsPerPage) : 0;
      search.disabled=false;render();
      if(line) for(const tr of body.querySelectorAll("tbody tr")) if(Number(tr.firstElementChild.textContent)===line) {
        tr.classList.add("wb-selected");tr.scrollIntoView({block:"nearest"});break;
      }
    } catch {
      if (!current() || ticket !== generation) return;
      body.innerHTML='<p role="alert">Не удалось загрузить лист.</p><button class="btn">Повторить</button>';
      body.querySelector("button").onclick=()=>load(line);
    }
  }
  select.onchange=()=>load();search.oninput=filter;
  panel.querySelectorAll("[data-line]").forEach(b => b.onclick=()=>{
    const priceIndex=tabs.findIndex(t=>normalized(t.name.trim())==="прайс");
    if(priceIndex>=0){ select.value=String(priceIndex);load(Number(b.dataset.line)); }
  });
  await load();
}

