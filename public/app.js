const $ = (id) => document.getElementById(id);

const opts = (items, placeholder) =>
  (placeholder ? `<option value="">${placeholder}</option>` : "") +
  items.map((v) => `<option value="${v}">${v}</option>`).join("");

// Populate provider dropdown, then load its live filters.
fetch("/api/providers")
  .then((r) => r.json())
  .then((providers) => {
    $("provider").innerHTML = providers
      .map((p) => `<option value="${p.name}">${p.label}</option>`)
      .join("");
    loadFilters();
  })
  .catch(() => setStatus("No se pudieron cargar los proveedores."));

$("provider").addEventListener("change", loadFilters);
$("server").addEventListener("change", loadWeeks);

// Load servers + tabs for the selected provider (opens a browser server-side, ~15s).
async function loadFilters() {
  const provider = $("provider").value;
  setDropdown("server", [], "Cargando servidores…", true);
  setDropdown("week", [], "Elige un servidor", true);
  setDropdown("tab", [], "Cargando…", true);
  setStatus("Leyendo filtros de la página… (puede tardar unos segundos)");
  setBusy(true);
  try {
    const r = await fetch(`/api/filters?provider=${encodeURIComponent(provider)}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Error");
    setDropdown("server", data.servers, "Elige un servidor", false);
    const tabs = data.tabs?.length ? data.tabs : ["Resources"];
    setDropdown("tab", tabs, null, false);
    // Default to Resources if present.
    const res = [...$("tab").options].find((o) => /resources/i.test(o.value));
    if (res) $("tab").value = res.value;
    setStatus("");
  } catch (err) {
    setStatus("No se pudieron leer los filtros: " + err.message, "error");
  } finally {
    setBusy(false);
  }
}

// Load weeks for the selected server (cascades; opens a browser server-side).
async function loadWeeks() {
  const provider = $("provider").value;
  const server = $("server").value;
  if (!server) return;
  setDropdown("week", [], "Cargando semanas…", true);
  setStatus("Leyendo semanas del servidor…");
  setBusy(true);
  try {
    const r = await fetch(
      `/api/weeks?provider=${encodeURIComponent(provider)}&server=${encodeURIComponent(server)}`
    );
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Error");
    setDropdown("week", data.weeks, "Elige una semana", false);
    setStatus("");
  } catch (err) {
    setStatus("No se pudieron leer las semanas: " + err.message, "error");
  } finally {
    setBusy(false);
  }
}

function setDropdown(id, items, placeholder, disabled) {
  const el = $(id);
  el.innerHTML = opts(items, placeholder);
  el.disabled = disabled;
}

// Load a dropped/selected file into the textarea.
$("file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (file) {
    $("players").value = await file.text();
    $("fileLabel").textContent = file.name;
  }
});

$("run").addEventListener("click", run);

function setStatus(msg, kind = "") {
  const el = $("status");
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

function setBusy(on) {
  document.body.classList.toggle("busy", on);
}

async function run() {
  let players;
  try {
    players = JSON.parse($("players").value);
    if (!Array.isArray(players)) throw new Error();
  } catch {
    setStatus("El JSON de jugadores no es válido.", "error");
    return;
  }

  $("run").disabled = true;
  setStatus("Extrayendo estadísticas…");
  setBusy(true);

  try {
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        players,
        provider: $("provider").value,
        server: $("server").value,
        week: $("week").value,
        tab: $("tab").value || "resources",
      }),
    });

    // Validation errors come back as a normal JSON error (non-stream).
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Error del servidor");
    }

    const done = await consumeStream(res);
    render(done);
    const found = done.rows.filter((r) => r.found).length;
    $("resultsMeta").textContent = `${found}/${done.count} encontrados`;
    setStatus(`Listo · ${done.count} jugadores.`, "ok");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    $("run").disabled = false;
    setBusy(false);
    hideProgress();
  }
}

// Read the NDJSON progress stream, driving the progress bar; resolve with the
// final "done" payload.
async function consumeStream(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done = null;

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === "start") {
        showProgress(msg.total);
      } else if (msg.type === "row") {
        updateProgress(msg.done, msg.total, msg.row);
      } else if (msg.type === "error") {
        throw new Error(msg.error);
      } else if (msg.type === "done") {
        done = msg;
      }
    }
  }
  if (!done) throw new Error("La conexión terminó sin resultados.");
  return done;
}

function showProgress(total) {
  const p = $("progress");
  p.hidden = false;
  p.classList.add("indeterminate"); // setup phase (opening browser / filters)
  $("progressFill").style.width = "";
  $("progressCount").textContent = `0/${total}`;
  $("progressPlayer").textContent = "preparando navegador…";
}

function updateProgress(done, total, row) {
  const p = $("progress");
  p.classList.remove("indeterminate");
  $("progressFill").style.width = Math.round((done / total) * 100) + "%";
  $("progressCount").textContent = `${done}/${total}`;
  const name = row.personaName || String(row.alias || "").replace(/^[-*]+/, "");
  $("progressPlayer").textContent = row.found ? name : `${name} · no encontrado`;
}

function hideProgress() {
  const p = $("progress");
  p.hidden = true;
  p.classList.remove("indeterminate");
}

const PLAYER_KEY = "__player";
const state = { rows: [], cols: [], sortKey: null, sortDir: 1 };

function render(data) {
  state.rows = data.rows ?? [];
  // Union of all stat columns across rows, preserving first-seen order.
  // Skip the provider's "Player" column — the Jugador column already shows it.
  const cols = [];
  for (const r of state.rows) {
    for (const k of Object.keys(r.stats)) {
      if (/^player$/i.test(k)) continue;
      if (!cols.includes(k)) cols.push(k);
    }
  }
  state.cols = cols;
  state.sortKey = null;
  state.sortDir = 1;
  draw();
  $("resultsPanel").hidden = false;
}

function draw() {
  const table = $("results");
  if (state.rows.length === 0) {
    table.innerHTML = "";
    return;
  }

  const columns = [{ key: PLAYER_KEY, label: "Jugador" }].concat(
    state.cols.map((c) => ({ key: c, label: c }))
  );

  const head =
    "<thead><tr>" +
    '<th class="rank-col">#</th>' +
    columns
      .map((col) => {
        const active = state.sortKey === col.key;
        const arrow = active ? (state.sortDir === 1 ? " ▲" : " ▼") : "";
        return `<th class="sortable${active ? " active" : ""}" data-key="${esc(
          col.key
        )}">${esc(col.label)}<span class="arrow">${arrow}</span></th>`;
      })
      .join("") +
    "</tr></thead>";

  // Position number reflects the current (sorted) display order, so it updates
  // whenever the sort changes.
  const body = sortedRows()
    .map((r, i) => {
      const cells = state.cols
        .map((c) => `<td>${esc(r.stats[c] ?? "")}</td>`)
        .join("");
      const cls = r.found ? "" : ' class="not-found"';
      return `<tr${cls}><td class="rank-col">${i + 1}</td><td>${playerLabel(
        r
      )}</td>${cells}</tr>`;
    })
    .join("");

  table.innerHTML = head + `<tbody>${body}</tbody>`;

  // Only real (data-key) headers are sortable; the "#" column isn't.
  table.querySelectorAll("thead th[data-key]").forEach((th) => {
    th.addEventListener("click", () => sortBy(th.dataset.key));
  });
}

// "SteamName (alias)" — alias shown without its "--"/"**" marker. When the player
// wasn't found on Moose there's no Steam name, so fall back to alias / steamId.
function playerLabel(r) {
  const alias = String(r.alias || "").replace(/^[-*]+/, "").trim();
  const name = esc(r.personaName || "");
  let base;
  if (name && alias) base = `${name} (${esc(alias)})`;
  else if (name) base = name;
  else base = esc(alias || r.steamId || "");
  return r.found ? base : `${base} <em>· no encontrado</em>`;
}

function sortBy(key) {
  if (state.sortKey === key) {
    state.sortDir *= -1;
  } else {
    state.sortKey = key;
    state.sortDir = 1;
  }
  draw();
}

// Sort matched rows; keep not-found rows pinned at the bottom.
function sortedRows() {
  const found = state.rows.filter((r) => r.found);
  const missing = state.rows.filter((r) => !r.found);
  if (state.sortKey) {
    found.sort((a, b) => cmp(a, b) * state.sortDir);
  }
  return found.concat(missing);
}

function cmp(a, b) {
  const va = valueFor(a), vb = valueFor(b);
  const na = parseNum(va), nb = parseNum(vb);
  if (na !== null && nb !== null) return na - nb;
  return String(va).localeCompare(String(vb), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function valueFor(r) {
  return state.sortKey === PLAYER_KEY ? r.personaName || "" : r.stats[state.sortKey] ?? "";
}

// First number in a cell ("199,501" -> 199501, "27,987 / 12%" -> 27987).
function parseNum(s) {
  const m = String(s).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}
