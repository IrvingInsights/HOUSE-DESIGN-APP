"use strict";

const $ = (id) => document.getElementById(id);
let pollTimer = null;
let lastProgressLen = 0;

/* ---------- startup ---------- */
async function health() {
  try {
    const h = await (await fetch("/api/health")).json();
    const bits = [];
    if (h.mock_claude) bits.push("offline demo");
    if (h.dev_mode_freecad) bits.push("no FreeCAD");
    const badge = $("mode-badge");
    if (bits.length) {
      badge.textContent = bits.join(" · ");
      badge.hidden = false;
    }
  } catch (e) { /* ignore */ }
}

/* ---------- file input label ---------- */
$("images").addEventListener("change", () => {
  const n = $("images").files.length;
  $("upload-text").textContent = n
    ? `${n} image${n > 1 ? "s" : ""} attached`
    : "Attach sketches, photos, or notes";
});

/* ---------- run ---------- */
function setRunning(running) {
  $("run-btn").disabled = running;
  $("sample-btn").disabled = running;
  $("run-btn").querySelector(".btn-label").textContent = running ? "Working…" : "Run design";
}

async function startJob(formData) {
  setRunning(true);
  lastProgressLen = 0;
  $("progress-panel").hidden = false;
  $("results-panel").hidden = true;
  $("timeline").innerHTML = "";
  $("spinner").classList.remove("done");
  $("status-line").textContent = "Submitting…";
  $("progress-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  try {
    const r = await fetch("/api/jobs", { method: "POST", body: formData });
    if (!r.ok) {
      const err = await r.json().catch(() => ({ detail: r.statusText }));
      throw new Error(err.detail || "Request failed");
    }
    poll((await r.json()).job_id);
  } catch (e) {
    $("status-line").textContent = "Error: " + e.message;
    $("spinner").classList.add("done");
    setRunning(false);
  }
}

function poll(jobId) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const s = await (await fetch(`/api/jobs/${jobId}`)).json();
      renderProgress(s);
      if (s.status === "done" || s.status === "error") {
        clearInterval(pollTimer);
        $("spinner").classList.add("done");
        setRunning(false);
        if (s.status === "done") loadResults(jobId, s);
        else $("status-line").textContent = "Error: " + (s.error || "run failed");
      }
    } catch (e) { /* keep polling */ }
  }, 1200);
}

function renderProgress(s) {
  const label = s.status === "done" ? "Complete" :
    s.status === "error" ? "Error" :
    "Designing" + (s.current_revision ? ` · revision ${s.current_revision}` : "");
  $("status-line").textContent = label;

  const items = s.progress || [];
  const list = $("timeline");
  for (let k = lastProgressLen; k < items.length; k++) {
    const li = document.createElement("li");
    li.textContent = items[k];
    li.className = "new";
    list.appendChild(li);
  }
  lastProgressLen = items.length;
}

/* ---------- results ---------- */
async function loadResults(jobId, status) {
  $("results-panel").hidden = false;
  const outcome = (status.result_status || status.status).replace(/_/g, " ");
  $("result-summary").textContent =
    `Outcome: ${outcome}. ${status.iterations || 0} revision(s); ` +
    `final version v${status.final_revision || 1}.`;
  selectTab("report");
  $("results-panel").scrollIntoView({ behavior: "smooth", block: "start" });

  // Report (rendered markdown)
  try {
    const rep = await fetch(`/api/jobs/${jobId}/report`);
    $("report").innerHTML = rep.ok
      ? window.renderMarkdown(await rep.text())
      : "<p>Report not available.</p>";
  } catch (e) { $("report").innerHTML = "<p>Report not available.</p>"; }

  // Manifest -> files + drawings
  let manifest = { artifacts: [] };
  try { manifest = await (await fetch(`/api/jobs/${jobId}/manifest`)).json(); }
  catch (e) { /* ignore */ }
  renderFiles(jobId, manifest);
  renderDrawings(jobId, manifest);
}

function fileIcon() {
  return '<svg class="file-icon" viewBox="0 0 24 24" width="18" height="18" ' +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 ' +
    '2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
}

function renderFiles(jobId, manifest) {
  const ul = $("files-list");
  ul.innerHTML = "";
  (manifest.artifacts || []).forEach((a) => {
    const li = document.createElement("li");
    if (a.path) {
      li.innerHTML = fileIcon() +
        `<a href="/api/jobs/${jobId}/artifacts/${a.path}" target="_blank" ` +
        `rel="noopener">${a.label}</a>`;
    } else {
      li.innerHTML = fileIcon() +
        `<span class="skipped">${a.label} — ${a.status}</span>`;
      li.classList.add("skipped");
    }
    ul.appendChild(li);
  });
  if (!ul.children.length) ul.innerHTML = "<li class='skipped'>No files.</li>";
}

function renderDrawings(jobId, manifest) {
  const body = $("drawings-body");
  const drawings = (manifest.artifacts || []).filter(
    (a) => a.label.startsWith("Drawing:") && a.path
  );

  if (!drawings.length) {
    body.innerHTML =
      '<div class="drawing-note">Dimensioned drawing sheets (floor plan, ' +
      "elevations, section, roof plan) are produced when the design is built " +
      "with FreeCAD. This run did not generate them (dev mode or FreeCAD not " +
      "found). Install FreeCAD and run again to see them here.</div>";
    return;
  }

  const first = drawings[0];
  body.innerHTML =
    `<embed class="drawing-preview" id="drawing-frame" type="application/pdf" ` +
    `src="/api/jobs/${jobId}/artifacts/${first.path}" />` +
    `<div class="drawing-thumbs" id="drawing-thumbs"></div>`;

  const thumbs = $("drawing-thumbs");
  drawings.forEach((d, idx) => {
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = d.label.replace("Drawing: ", "");
    if (idx === 0) a.classList.add("is-active");
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      $("drawing-frame").src = `/api/jobs/${jobId}/artifacts/${d.path}`;
      thumbs.querySelectorAll("a").forEach((x) => x.classList.remove("is-active"));
      a.classList.add("is-active");
    });
    thumbs.appendChild(a);
  });
}

/* ---------- tabs ---------- */
function selectTab(name) {
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("is-active", t.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) =>
    p.classList.toggle("is-active", p.id === "tab-" + name));
}
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => selectTab(t.dataset.tab)));

/* ---------- buttons ---------- */
$("run-btn").addEventListener("click", () => {
  const fd = new FormData();
  fd.append("text", $("brief").value || "");
  const files = $("images").files;
  for (let i = 0; i < files.length; i++) fd.append("images", files[i]);
  startJob(fd);
});
$("sample-btn").addEventListener("click", () => {
  const fd = new FormData();
  fd.append("use_sample", "true");
  startJob(fd);
});

health();
