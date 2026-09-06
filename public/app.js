const $ = (id) => document.getElementById(id);

// Populate provider dropdown.
fetch("/api/providers")
  .then((r) => r.json())
  .then((providers) => {
    $("provider").innerHTML = providers
      .map((p) => `<option value="${p.name}">${p.label}</option>`)
      .join("");
  })
  .catch(() => setStatus("No se pudieron cargar los proveedores."));

// Load a dropped/selected file into the textarea.
$("file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (file) $("players").value = await file.text();
});

$("run").addEventListener("click", run);

function setStatus(msg) {
  $("status").textContent = msg;
}

async function run() {
  let players;
  try {
    players = JSON.parse($("players").value);
    if (!Array.isArray(players)) throw new Error();
  } catch {
    setStatus("El JSON de jugadores no es válido.");
    return;
  }

  $("run").disabled = true;
  setStatus("Resolviendo nombres y extrayendo… (puede tardar)");

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
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error del servidor");
    render(data);
    setStatus(`Listo · ${data.count} jugadores.`);
  } catch (err) {
    setStatus(err.message);
  } finally {
    $("run").disabled = false;
  }
}

function render(data) {
  const rows = data.rows ?? [];
  const panel = $("resultsPanel");
  const table = $("results");

  if (rows.length === 0) {
    table.innerHTML = "";
    panel.hidden = false;
    return;
  }

  // Union of all stat columns across rows, preserving first-seen order.
  const cols = [];
  for (const r of rows) {
    for (const k of Object.keys(r.stats)) if (!cols.includes(k)) cols.push(k);
  }

  const head = `<thead><tr><th>Jugador</th>${cols
    .map((c) => `<th>${c}</th>`)
    .join("")}</tr></thead>`;

  const body = rows
    .map((r) => {
      const cells = cols.map((c) => `<td>${r.stats[c] ?? ""}</td>`).join("");
      const cls = r.found ? "" : ' class="not-found"';
      const name = r.found ? r.personaName : `${r.personaName} (no encontrado)`;
      return `<tr${cls}><td>${name}</td>${cells}</tr>`;
    })
    .join("");

  table.innerHTML = head + `<tbody>${body}</tbody>`;
  panel.hidden = false;
}
