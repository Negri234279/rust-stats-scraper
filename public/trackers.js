const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const optionsHtml = (items, ph) =>
  (ph ? `<option value="">${ph}</option>` : "") +
  items.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
const setBusy = (on) => document.body.classList.toggle("busy", on);
const fmtNum = (n) => Number(n).toLocaleString("en-US");
const stripAlias = (a) => String(a || "").replace(/^[-*]+/, "").trim();
const shortDate = (d) => { const [, m, day] = d.split("-"); return `${day}/${m}`; };

// Show the app version (from package.json) in the footer.
fetch("/api/version")
  .then((r) => r.json())
  .then(({ version }) => { if (version) $("appVersion").textContent = "v" + version; })
  .catch(() => {});

let allTabs = [];
let detail = null; // current tracker detail
let tabSeries = null; // current whole-tab series
let viewMode = "delta";
let sortCol = null; // column key being sorted ("__player" or a stat column)
let sortDir = 1; // 1 asc, -1 desc
const PLAYER_KEY = "__player";

// --------------------------------------------------------------- create form
fetch("/api/providers").then((r) => r.json()).then((ps) => {
  $("t-provider").innerHTML = ps.map((p) => `<option value="${p.name}">${p.label}</option>`).join("");
  loadFilters();
});
$("t-provider").addEventListener("change", loadFilters);
$("t-server").addEventListener("change", loadWeeks);
$("t-file").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (f) { $("t-players").value = await f.text(); $("t-fileLabel").textContent = f.name; }
});
$("t-create").addEventListener("click", createTracker);

function setTStatus(msg, kind = "") { const el = $("t-status"); el.textContent = msg; el.className = "status" + (kind ? " " + kind : ""); }

async function loadFilters() {
  const provider = $("t-provider").value;
  setDropdown("t-server", [], "Cargando servidores…", true);
  setDropdown("t-week", [], "Elige un servidor", true);
  setBusy(true);
  setTStatus("Leyendo servidores y tabs de la página…");
  try {
    const r = await fetch(`/api/filters?provider=${encodeURIComponent(provider)}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Error");
    // No placeholder: the first server is selected by default.
    setDropdown("t-server", data.servers, null, false);
    allTabs = data.tabs?.length ? data.tabs : ["RESOURCES"];
    $("t-tabcount").textContent = `${allTabs.length}`;
    setTStatus("");
    // Auto-load the weeks for the default (first) server.
    if (data.servers?.length) await loadWeeks();
  } catch (err) { setTStatus("No se pudieron leer los filtros: " + err.message, "error"); }
  finally { setBusy(false); }
}

async function loadWeeks() {
  const provider = $("t-provider").value, server = $("t-server").value;
  if (!server) return;
  setDropdown("t-week", [], "Cargando semanas…", true);
  setBusy(true);
  try {
    const r = await fetch(`/api/weeks?provider=${encodeURIComponent(provider)}&server=${encodeURIComponent(server)}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Error");
    // No placeholder: the most recent week is selected by default.
    setDropdown("t-week", data.weeks, null, false);
    setTStatus("");
  } catch (err) { setTStatus("No se pudieron leer las semanas: " + err.message, "error"); }
  finally { setBusy(false); }
}

function setDropdown(id, items, ph, disabled) { const el = $(id); el.innerHTML = optionsHtml(items, ph); el.disabled = disabled; }

async function createTracker() {
  let players;
  try { players = JSON.parse($("t-players").value); if (!Array.isArray(players)) throw 0; }
  catch { return setTStatus("El JSON de jugadores no es válido.", "error"); }

  const body = {
    name: $("t-name").value.trim(),
    provider: $("t-provider").value,
    server: $("t-server").value,
    week: $("t-week").value,
    tabs: allTabs,
    startDate: $("t-start").value,
    endDate: $("t-end").value, // opcional
    players,
  };
  if (!body.name) return setTStatus("Falta el nombre.", "error");
  if (!body.server || !body.week) return setTStatus("Elige servidor y semana.", "error");
  if (!body.startDate) return setTStatus("Elige la fecha de inicio.", "error");

  $("t-create").disabled = true;
  setTStatus("Creando tracker…");
  try {
    const r = await fetch("/api/trackers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Error");
    setTStatus("Tracker creado · snapshot inicial en curso en segundo plano.", "ok");
    $("t-name").value = ""; $("t-players").value = ""; $("t-fileLabel").textContent = "Arrastra o elige un .json de jugadores";
    loadTrackers();
  } catch (err) { setTStatus(err.message, "error"); }
  finally { $("t-create").disabled = false; }
}

// ---------------------------------------------------------------------- list
async function loadTrackers() {
  const r = await fetch("/api/trackers");
  const list = await r.json();
  $("t-listMeta").textContent = `${list.length} tracker${list.length === 1 ? "" : "s"}`;
  if (!list.length) { $("t-list").innerHTML = `<p class="hint">Aún no hay trackers. Crea uno arriba.</p>`; return; }
  $("t-list").innerHTML = list.map((t) => `
    <div class="tracker-card">
      <div class="tc-main">
        <div class="tc-name">${esc(t.name)}</div>
        <div class="tc-sub">${esc(t.server)} · ${esc(t.week)}<br>${esc(t.startDate)} → ${esc(t.endDate || "sin fin")} · 1/día (medianoche)</div>
      </div>
      <div class="tc-stat"><b>${t.playerCount}</b><span>jugadores</span></div>
      <div class="tc-stat"><b>${t.snapshotCount}</b><span>snapshots</span></div>
      <div class="tc-actions">
        <button class="mini-btn primary" data-act="open" data-id="${t.id}">Ver</button>
        <button class="mini-btn" data-act="snap" data-id="${t.id}">Snapshot</button>
        <button class="mini-btn danger" data-act="del" data-id="${t.id}">Borrar</button>
      </div>
    </div>`).join("");
  $("t-list").querySelectorAll("button[data-act]").forEach((b) => {
    b.addEventListener("click", () => {
      const id = b.dataset.id;
      if (b.dataset.act === "open") openTracker(id);
      else if (b.dataset.act === "snap") { openTracker(id).then(() => triggerSnapshot(id)); }
      else if (b.dataset.act === "del") removeTracker(id);
    });
  });
}

async function removeTracker(id) {
  if (!confirm("¿Borrar este tracker y sus snapshots?")) return;
  await fetch(`/api/trackers/${id}`, { method: "DELETE" });
  if (detail?.id === id) $("t-detail").hidden = true;
  loadTrackers();
}

// -------------------------------------------------------------------- detail
$("d-close").addEventListener("click", () => { $("t-detail").hidden = true; });
$("d-snapshot").addEventListener("click", () => detail && triggerSnapshot(detail.id));
$("d-saveEnd").addEventListener("click", () => setEndDate($("d-end").value));
$("d-endToday").addEventListener("click", () => setEndDate(new Date().toISOString().slice(0, 10)));
$("d-clearEnd").addEventListener("click", () => setEndDate(""));

async function setEndDate(endDate) {
  if (!detail) return;
  const r = await fetch(`/api/trackers/${detail.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endDate }),
  });
  if (!r.ok) { setDStatus("No se pudo guardar el fin.", "error"); return; }
  setDStatus(endDate ? `Fin fijado: ${endDate}.` : "Wipe sin fecha de fin.", "ok");
  await openTracker(detail.id);
  loadTrackers();
}
$("d-tab").addEventListener("change", loadTabSeries);
$("d-day").addEventListener("change", drawTabMatrix);
$("d-toggle").querySelectorAll("button").forEach((b) =>
  b.addEventListener("click", () => {
    viewMode = b.dataset.mode;
    $("d-toggle").querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    drawTabMatrix();
  })
);

async function openTracker(id) {
  const r = await fetch(`/api/trackers/${id}`);
  const data = await r.json();
  if (!r.ok) return;
  detail = data;
  $("t-detail").hidden = false;
  $("d-title").textContent = data.name;
  $("d-meta").innerHTML =
    `<span>Servidor: <b>${esc(data.server)}</b></span>` +
    `<span>Wipe: <b>${esc(data.week)}</b></span>` +
    `<span>Ventana: <b>${esc(data.startDate)} → ${esc(data.endDate || "sin fin")}</b></span>` +
    `<span>Jugadores: <b>${data.playerCount}</b></span>` +
    `<span>Snapshots: <b>${data.snapshotCount}</b></span>` +
    `<span>Cadencia: <b>1/día (medianoche)</b></span>` +
    (data.snapshotRunning ? `<span><b>● snapshot en curso…</b></span>` : "");
  $("d-end").value = data.endDate || "";
  $("t-detail").scrollIntoView({ behavior: "smooth" });

  // Populate the tab selector; the day selector is filled once the series loads.
  const stats = data.stats || [];
  if (!stats.length) {
    $("d-tab").innerHTML = ""; $("d-day").innerHTML = "";
    $("d-table").innerHTML = `<tbody><tr><td class="hint" style="padding:1rem">Sin snapshots todavía. Toma uno para ver datos.</td></tr></tbody>`;
    return;
  }
  $("d-tab").innerHTML = stats.map((s) => `<option value="${esc(s.tab)}">${esc(s.tab)}</option>`).join("");
  loadTabSeries();
}

// Load the whole selected tab (all columns) across days.
async function loadTabSeries() {
  if (!detail) return;
  const tab = $("d-tab").value;
  if (!tab) return;
  const r = await fetch(`/api/trackers/${detail.id}/tab-series?tab=${encodeURIComponent(tab)}`);
  tabSeries = await r.json();
  sortCol = null; sortDir = 1; // reset sort when the tab (columns) changes
  // Fill the day selector, defaulting to the most recent day.
  const days = tabSeries.days || [];
  $("d-day").innerHTML = days.map((d, i) => `<option value="${i}">${shortDate(d)}</option>`).join("");
  $("d-day").value = String(Math.max(0, days.length - 1));
  drawTabMatrix();
}

function cellFor(point) {
  if (!point) return `<td class="delta-zero">–</td>`;
  if (viewMode === "cum") return `<td class="cum-val">${fmtNum(point.cum)}</td>`;
  const d = point.delta;
  const cls = d > 0 ? "delta-pos" : d < 0 ? "delta-neg" : "delta-zero";
  const txt = d > 0 ? "+" + fmtNum(d) : fmtNum(d);
  return `<td class="${cls}">${txt}</td>`;
}

// Value a player is sorted by for the active column/day/view.
function sortValue(p, dayIdx) {
  if (sortCol === PLAYER_KEY) return (p.personaName || stripAlias(p.alias) || "").toLowerCase();
  const pt = (tabSeries.byPlayer[p.steamId] || {})[sortCol]?.[dayIdx];
  if (!pt) return -Infinity;
  return viewMode === "cum" ? pt.cum : pt.delta;
}

function sortBy(key) {
  if (sortCol === key) sortDir *= -1;
  else { sortCol = key; sortDir = key === PLAYER_KEY ? 1 : -1; } // names A→Z, stats high→low
  drawTabMatrix();
}

// Rows = TOTAL (pinned) + players; columns = every stat of the tab, for the day.
function drawTabMatrix() {
  const table = $("d-table");
  if (!tabSeries || !tabSeries.days.length || !tabSeries.columns.length) {
    table.innerHTML = `<tbody><tr><td class="hint" style="padding:1rem">Sin datos para esta tab.</td></tr></tbody>`;
    return;
  }
  const dayIdx = Number($("d-day").value) || 0;
  const cols = tabSeries.columns;
  const arrow = (key) => (sortCol === key ? (sortDir === 1 ? " ▲" : " ▼") : "");

  const th = (key, label, title) =>
    `<th class="sortable${sortCol === key ? " active" : ""}" data-key="${esc(key)}"` +
    (title ? ` title="${esc(title)}"` : "") +
    `>${esc(label)}<span class="arrow">${arrow(key)}</span></th>`;

  const head =
    "<thead><tr>" + th(PLAYER_KEY, "Jugador") +
    cols.map((c) => th(c, c, c)).join("") + "</tr></thead>";

  // Players sorted (TOTAL row stays pinned on top, unsorted).
  const players = [...tabSeries.players];
  if (sortCol) {
    players.sort((a, b) => {
      const va = sortValue(a, dayIdx), vb = sortValue(b, dayIdx);
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb));
      return cmp * sortDir;
    });
  }

  const totalRow =
    `<tr class="total-row"><td>TOTAL COMPAÑÍA</td>` +
    cols.map((c) => cellFor(tabSeries.total[c]?.[dayIdx])).join("") +
    "</tr>";

  const playerRows = players.map((p) => {
    const label = p.personaName ? `${esc(p.personaName)} (${esc(stripAlias(p.alias))})` : esc(stripAlias(p.alias));
    const byCol = tabSeries.byPlayer[p.steamId] || {};
    return `<tr><td title="${label}">${label}</td>${cols.map((c) => cellFor(byCol[c]?.[dayIdx])).join("")}</tr>`;
  }).join("");

  table.innerHTML = head + `<tbody>${totalRow}${playerRows}</tbody>`;
  table.querySelectorAll("thead th[data-key]").forEach((el) => {
    el.addEventListener("click", () => sortBy(el.dataset.key));
  });
}

// --------------------------------------------------------------- snapshot now
function setDStatus(msg, kind = "") { const el = $("d-status"); el.textContent = msg; el.className = "status" + (kind ? " " + kind : ""); }

// Trigger a snapshot; live progress arrives via the SSE stream below.
async function triggerSnapshot(id) {
  $("d-snapshot").disabled = true;
  setDStatus("Iniciando snapshot…");
  try {
    const res = await fetch(`/api/trackers/${id}/snapshot`, { method: "POST" });
    if (res.status === 409) { setDStatus("Ya hay un snapshot en curso.", "error"); $("d-snapshot").disabled = false; return; }
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Error"); }
    // start/progress/done handled by onSnapEvent (SSE)
  } catch (err) { setDStatus(err.message, "error"); $("d-snapshot").disabled = false; }
}

// ------ live snapshot progress via SSE (initial / manual / midnight runs) -----
let snapRunning = false;

function onSnapEvent(e) {
  const g = $("g-progress");
  const mine = detail && detail.id === e.trackerId;
  if (e.type === "start" || e.type === "progress") {
    snapRunning = true;
    setBusy(true);
    g.hidden = false;
    $("g-progressName").textContent = e.trackerName;
    if (e.type === "start") {
      $("g-progressPlayer").textContent = "abriendo navegador…";
      $("g-progressCount").textContent = `0/${e.total}`;
      $("g-progressFill").style.width = "0%";
    } else {
      $("g-progressFill").style.width = Math.round((e.done / e.total) * 100) + "%";
      $("g-progressCount").textContent = `${e.done}/${e.total}`;
      $("g-progressPlayer").textContent = `${e.tab} · ${e.name}`;
    }
    if (mine) { $("d-snapshot").disabled = true; setDStatus("Capturando snapshot…"); }
  } else if (e.type === "done" || e.type === "error") {
    snapRunning = false;
    setBusy(false);
    g.hidden = true;
    if (mine) {
      $("d-snapshot").disabled = false;
      if (e.type === "done") { setDStatus(`Snapshot guardado · ${e.found} encontrados.`, "ok"); openTracker(e.trackerId); }
      else setDStatus("Error: " + e.error, "error");
    }
    // Notify regardless of whether that tracker's detail is open.
    if (e.type === "done") showToast(`${e.trackerName} actualizado · ${e.found} encontrados`, "ok");
    else showToast(`${e.trackerName}: ${e.error}`, "error");
    loadTrackers();
  }
}

// Transient corner notification, auto-dismissed.
function showToast(msg, kind = "ok") {
  const mark = kind === "error" ? "⚠" : "✓";
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.innerHTML = `<span class="t-mark">${mark}</span>${esc(msg)}`;
  $("toasts").appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 320);
  }, 5000);
}

function connectEvents() {
  const es = new EventSource("/api/trackers/events");
  es.onmessage = (ev) => { try { onSnapEvent(JSON.parse(ev.data)); } catch {} };
  es.onerror = () => {}; // EventSource reconnects automatically
}

// boot
connectEvents();
loadTrackers();
