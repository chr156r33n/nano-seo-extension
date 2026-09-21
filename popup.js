
let snapshot = null;
let settings = null;
let analysisRun = null;

const taskResults = {
  page_type: {},
  intent: {},
  alignment: {},
  link_group: {},
  false_positive: {},
  dom_diff_triage: {}
};

let linkCursor = 0;
let domDiffCursor = 0;
let domDiff = null;

const $ = s => document.querySelector(s);

function setStatus(t, error = false) {
  const el = $("#status");
  el.style.display = t ? "block" : "none";
  el.textContent = t || "";
  el.style.background = error ? "#8b1e1e" : "#111";
}

async function sw(msg) {
  const r = await chrome.runtime.sendMessage(msg);

  if (!r?.ok) {
    throw new Error(r?.error || "Extension request failed");
  }

  return r.value;
}

function selectedInputMode() {
  return document.querySelector('input[name="inputMode"]:checked')?.value || "digest";
}

function modesToRun() {
  const selected = selectedInputMode();

  return selected === "all"
    ? ["raw", "markdown", "digest"]
    : [selected];
}

function ensureModeStore(task, mode) {
  taskResults[task] ||= {};
  taskResults[task][mode] ||= {};
}

function enabledProviders() {
  return [...document.querySelectorAll("[data-provider]:checked")]
    .map(x => x.dataset.provider);
}

function renderProviders() {
  const box = $("#providers");
  box.innerHTML = "";

  for (const [id, cfg] of Object.entries(settings.providers)) {
    const label = document.createElement("label");

    label.innerHTML =
      `<input type="checkbox" data-provider="${id}" ${cfg.enabled ? "checked" : ""}> ` +
      `${id}${cfg.model ? ` <span class="muted small">${cfg.model}</span>` : ""}`;

    box.appendChild(label);
  }
}

function updatePageMeta() {
  $("#pageMeta").textContent = snapshot
    ? `${snapshot.title || "(untitled)"} · ${snapshot.url}`
    : "No page captured.";

  $("#runMeta").textContent = analysisRun
    ? `run ${analysisRun.id.slice(0, 8)} · started ${new Date(analysisRun.startedAt).toLocaleString()}`
    : "";
}

function providerCard(provider, result, mode = null) {
  const d = document.createElement("div");
  d.className = "card";

  const meta = result?._meta || {};
  const clean = result ? {...result} : {};
  delete clean._meta;

  d.innerHTML =
    `<h3>${mode ? `${mode} · ` : ""}${provider} ` +
    `${meta.cacheHit ? "· cache" : ""}` +
    `${meta.durationMs ? ` · ${meta.durationMs}ms` : ""}</h3>` +
    `<pre>${escapeHtml(JSON.stringify(clean, null, 2))}</pre>`;

  return d;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

async function runAcross(task, payload, target, mode = null) {
  const providers = enabledProviders();

  if (!providers.length) {
    throw new Error("Select at least one provider.");
  }

  if (!analysisRun?.id) {
    throw new Error("Start a new analysis run by capturing the page first.");
  }

  if (!target) {
    throw new Error(`No result container found for task: ${task}`);
  }

  if (mode) {
    ensureModeStore(task, mode);
  } else if (!taskResults[task]) {
    taskResults[task] = {};
  }

  for (const provider of providers) {
    setStatus(`Running ${task}${mode ? ` · ${mode}` : ""} · ${provider}…`);

    try {
      const result = await sw({
        type: "RUN_TASK",
        task,
        provider,
        payload: mode ? {...payload, inputMode: mode} : payload,
        analysisRunId: analysisRun.id,
        useCache: $("#useCache").checked
      });

      if (mode) {
        taskResults[task][mode][provider] = result;
      } else {
        taskResults[task][provider] = result;
      }

      target.appendChild(
        providerCard(provider, result, mode)
      );
    } catch (e) {
      const card = document.createElement("div");
      card.className = "card";

      card.innerHTML =
        `<h3>${mode ? `${mode} · ` : ""}${provider} · error</h3>` +
        `<pre>${escapeHtml(e?.message || String(e))}</pre>`;

      target.appendChild(card);
    }
  }

  setStatus("");
}

async function runModeTask(task) {
  if (!snapshot) {
    return setStatus("Capture a page first.", true);
  }

  const target = $("#intentResults");
  target.innerHTML = "";

  for (const mode of modesToRun()) {
    await runAcross(
      task,
      {snapshot},
      target,
      mode
    );
  }
}

function pageContextForIssue(issue) {
  const ctx = {
    url: snapshot.url,
    title: snapshot.title,
    metaDescription: snapshot.metaDescription,
    canonical: snapshot.canonical,
    robots: snapshot.robots,
    viewport: snapshot.viewport,
    h1s: snapshot.h1s,
    h2s: snapshot.h2s.slice(0, 8),
    schemaTypes: snapshot.schemaTypes,
    imageCount: snapshot.imageCount,
    missingAltCount: snapshot.missingAltCount
  };

  if (["h1_presence", "multiple_h1"].includes(issue.code)) {
    ctx.bodyExcerpt = snapshot.bodyText.slice(0, 3500);
  }

  if (issue.code === "images_missing_alt") {
    ctx.bodyExcerpt = snapshot.bodyText.slice(0, 1500);
  }

  return ctx;
}

function renderIssues() {
  const box = $("#issues");
  const summary = $("#auditSummary");

  box.innerHTML = "";
  summary.textContent = "";

  if (!snapshot) return;

  const checks = snapshot.auditChecks || [];
  const findings = checks.filter(x => x.status === "finding");
  const passes = checks.filter(x => x.status === "pass");

  summary.textContent =
    `${checks.length} deterministic checks run · ` +
    `${passes.length} passed · ` +
    `${findings.length} finding(s) available for triage`;

  if (!findings.length) {
    box.innerHTML =
      '<div class="card"><strong>No findings to triage on this page.</strong>' +
      '<div class="muted small">That means the starter deterministic rules did not flag anything here. ' +
      'Passed checks are still recorded in this analysis run.</div></div>';
    return;
  }

  findings.forEach((issue, i) => {
    const d = document.createElement("div");
    d.className = "issue";

    d.innerHTML =
      `<div class="issue-head">` +
        `<div>` +
          `<strong>${escapeHtml(issue.code)}</strong>` +
          `<div class="muted small">${escapeHtml(issue.message)}</div>` +
        `</div>` +
        `<button data-triage="${i}">Triage</button>` +
      `</div>` +
      `<div data-issue-result="${i}"></div>`;

    box.appendChild(d);
  });

  box.querySelectorAll("[data-triage]").forEach(btn => {
    btn.onclick = async () => {
      const i = Number(btn.dataset.triage);
      const issue = findings[i];
      const target = box.querySelector(`[data-issue-result="${i}"]`);

      if (!issue) {
        setStatus(`Could not resolve finding ${i}.`, true);
        return;
      }

      if (!target) {
        setStatus(`Could not find the result container for finding ${i}.`, true);
        return;
      }

      btn.disabled = true;
      target.innerHTML = "";

      try {
        await runAcross(
          "false_positive",
          {
            issue,
            context: pageContextForIssue(issue)
          },
          target
        );
      } catch (e) {
        target.innerHTML =
          `<div class="card"><h3>Triage error</h3><pre>${escapeHtml(e?.message || String(e))}</pre></div>`;

        setStatus(
          e?.message || String(e),
          true
        );
      } finally {
        btn.disabled = false;
      }
    };
  });
}


function renderDomDiffSummary() {
  const el =
    $("#domDiffSummary");

  if (!el) return;

  if (!domDiff) {
    el.textContent =
      "No DOM diff built for this analysis run.";
    return;
  }

  const summary =
    domDiff.summary || {};

  const kinds =
    Object.entries(
      summary.byKind || {}
    )
      .map(
        ([k, v]) =>
          `${k}: ${v}`
      )
      .join(" · ");

  el.textContent =
    `${summary.totalDiffItems ?? 0} semantic difference(s)` +
    ` · ${summary.returnedDiffItems ?? 0} retained for analysis` +
    `${summary.droppedByCap ? ` · ${summary.droppedByCap} dropped by cap` : ""}` +
    `${kinds ? ` · ${kinds}` : ""}`;
}

async function load() {
  settings = await sw({type: "GET_SETTINGS"});
  renderProviders();

  const ctx = await sw({type: "GET_LAST_CONTEXT"});

  snapshot = ctx?.snapshot || null;
  analysisRun = ctx?.analysisRun || null;
  domDiff = snapshot?.domDiff || analysisRun?.domDiff || null;
  domDiffCursor = 0;

  updatePageMeta();
  renderIssues();
  renderDomDiffSummary();
}

$("#captureBtn").onclick = async () => {
  setStatus("Capturing page and starting a new run…");

  try {
    const ctx = await sw({type: "CAPTURE"});

    snapshot = ctx.snapshot;
    analysisRun = ctx.analysisRun;
    linkCursor = 0;
    domDiffCursor = 0;
    domDiff = null;

    for (const task of Object.keys(taskResults)) {
      taskResults[task] = {};
    }

    updatePageMeta();
    renderIssues();
    renderDomDiffSummary();

    const domResult =
      $("#domDiffResults");

    if (domResult) {
      domResult.innerHTML = "";
    }

    setStatus("");
  } catch (e) {
    setStatus(
      e?.message || String(e),
      true
    );
  }
};

$("#settingsBtn").onclick = () =>
  chrome.runtime.openOptionsPage();

$("#pageTypeBtn").onclick = async () => {
  try {
    await runModeTask("page_type");
  } catch (e) {
    setStatus(
      e?.message || String(e),
      true
    );
  }
};

$("#intentBtn").onclick = async () => {
  try {
    await runModeTask("intent");
  } catch (e) {
    setStatus(
      e?.message || String(e),
      true
    );
  }
};

$("#alignmentBtn").onclick = async () => {
  if (!snapshot) {
    return setStatus("Capture a page first.", true);
  }

  const target = $("#intentResults");
  target.innerHTML = "";

  const providers = enabledProviders();

  for (const mode of modesToRun()) {
    for (const provider of providers) {
      const pageTypeResult =
        taskResults.page_type?.[mode]?.[provider];

      const intentResult =
        taskResults.intent?.[mode]?.[provider];

      if (!pageTypeResult || !intentResult) {
        const d = document.createElement("div");
        d.className = "card";

        d.innerHTML =
          `<h3>${mode} · ${provider}</h3>` +
          `<pre>Run both page type and intent for this mode/provider first.</pre>`;

        target.appendChild(d);
        continue;
      }

      setStatus(
        `Running alignment · ${mode} · ${provider}…`
      );

      try {
        const result = await sw({
          type: "RUN_TASK",
          task: "alignment",
          provider,
          analysisRunId: analysisRun.id,
          payload: {
            snapshot,
            inputMode: mode,
            pageTypeResult,
            intentResult
          },
          useCache: $("#useCache").checked
        });

        ensureModeStore("alignment", mode);
        taskResults.alignment[mode][provider] = result;

        target.appendChild(
          providerCard(provider, result, mode)
        );
      } catch (e) {
        const d = document.createElement("div");
        d.className = "card";

        d.innerHTML =
          `<h3>${mode} · ${provider} · error</h3>` +
          `<pre>${escapeHtml(e?.message || String(e))}</pre>`;

        target.appendChild(d);
      }
    }
  }

  setStatus("");
};

$("#classifyLinksBtn").onclick = async () => {
  if (!snapshot) {
    return setStatus("Capture a page first.", true);
  }

  const max =
    settings.limits.maxLinksForClassification;

  const pool =
    snapshot.links.slice(0, max);

  if (!pool.length) {
    return setStatus(
      "No HTTP(S) links found on this page.",
      true
    );
  }

  if (linkCursor >= pool.length) {
    linkCursor = 0;
  }

  const batch =
    pool
      .slice(
        linkCursor,
        linkCursor + settings.limits.linkBatchSize
      )
      .map(l => ({
        id: l.id,
        href: l.href,
        internal: l.internal,
        anchor: l.anchor,
        rel: l.rel,
        zone: l.zone,
        context: l.context
      }));

  linkCursor += batch.length;

  $("#linkProgress").textContent =
    `Classifying links ${Math.max(1, linkCursor - batch.length + 1)}` +
    `–${linkCursor} of ${pool.length}.`;

  $("#linkResults").innerHTML = "";

  try {
    await runAcross(
      "link_group",
      {links: batch},
      $("#linkResults")
    );
  } catch (e) {
    setStatus(
      e?.message || String(e),
      true
    );
  }
};


$("#buildDomDiffBtn").onclick =
  async () => {
    if (!snapshot) {
      return setStatus(
        "Capture a page first.",
        true
      );
    }

    setStatus(
      "Building deterministic server/rendered DOM diff…"
    );

    try {
      domDiff =
        await sw({
          type:
            "BUILD_DOM_DIFF"
        });

      domDiffCursor = 0;

      if (snapshot) {
        snapshot.domDiff =
          domDiff;
      }

      renderDomDiffSummary();

      $("#domDiffResults")
        .innerHTML = "";

      setStatus("");
    } catch (e) {
      setStatus(
        e?.message || String(e),
        true
      );
    }
  };

$("#assessDomDiffBtn").onclick =
  async () => {
    if (!snapshot) {
      return setStatus(
        "Capture a page first.",
        true
      );
    }

    if (!domDiff?.items?.length) {
      return setStatus(
        "Build the DOM diff first.",
        true
      );
    }

    const batchSize =
      settings
        .limits
        .domDiffBatchSize ||
      6;

    if (
      domDiffCursor >=
      domDiff.items.length
    ) {
      domDiffCursor = 0;
    }

    const batch =
      domDiff.items.slice(
        domDiffCursor,
        domDiffCursor +
          batchSize
      );

    domDiffCursor +=
      batch.length;

    const target =
      $("#domDiffResults");

    target.innerHTML = "";

    const batchLabel =
      document.createElement(
        "div"
      );

    batchLabel.className =
      "muted small";

    batchLabel.textContent =
      `Assessing diff items ${Math.max(1, domDiffCursor - batch.length + 1)}–${domDiffCursor} of ${domDiff.items.length}.`;

    target.appendChild(
      batchLabel
    );

    try {
      await runAcross(
        "dom_diff_triage",
        {
          items: batch
        },
        target
      );
    } catch (e) {
      setStatus(
        e?.message || String(e),
        true
      );
    }
  };

$("#historyBtn").onclick = () =>
  chrome.tabs.create({
    url: chrome.runtime.getURL("history.html")
  });

$("#openLogsBtn").onclick = () =>
  chrome.tabs.create({
    url: chrome.runtime.getURL("logs.html")
  });

$("#exportBtn").onclick = async () => {
  try {
    const runs = await sw({
      type: "GET_RUNS",
      limit: 5000
    });

    const blob = new Blob(
      [JSON.stringify(runs, null, 2)],
      {type: "application/json"}
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download =
      `nano-seo-lab-runs-${new Date().toISOString().slice(0, 10)}.json`;

    a.click();

    setTimeout(
      () => URL.revokeObjectURL(url),
      1000
    );
  } catch (e) {
    setStatus(
      e?.message || String(e),
      true
    );
  }
};

load().catch(
  e =>
    setStatus(
      e?.message || String(e),
      true
    )
);
