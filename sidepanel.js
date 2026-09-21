
let snapshot = null;
let settings = null;
let analysisRun = null;

const taskResults = {
  page_type: {},
  intent: {},
  alignment: {},
  link_group: {},
  false_positive: {},
  dom_diff_triage: {},
  url_consistency: {},
  jira_ticket: {}
};

let linkCursor = 0;
let domDiffCursor = 0;
let domDiff = null;
let analyseAllRunning = false;

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
    ? ["raw", "raw_html", "clean_html", "markdown", "digest"]
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
    headingDetails: (snapshot.headingDetails || []).slice(0, 20),
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
        `<div class="row">` +
          `<button data-triage="${i}">Triage</button>` +
          `<button class="secondary" data-jira="${i}">Create Jira ticket</button>` +
        `</div>` +
      `</div>` +
      `<div data-issue-result="${i}"></div>` +
      `<div data-jira-result="${i}"></div>`;

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

  box.querySelectorAll("[data-jira]").forEach(btn => {
    btn.onclick = async () => {
      const i =
        Number(
          btn.dataset.jira
        );

      const issue =
        findings[i];

      const target =
        box.querySelector(
          `[data-jira-result="${i}"]`
        );

      if (!issue || !target) {
        setStatus(
          "Could not resolve this finding for Jira generation.",
          true
        );
        return;
      }

      target.innerHTML = "";

      try {
        await createJiraTicket({
          issue,
          context:
            pageContextForIssue(
              issue
            ),
          target,
          button:
            btn
        });
      } catch (e) {
        setStatus(
          e?.message || String(e),
          true
        );
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



function effectiveUrlSignals() {
  if (!snapshot) {
    return null;
  }

  if (snapshot.urlSignals) {
    return {
      ...snapshot.urlSignals,
      _source: "full"
    };
  }

  return {
    currentUrl:
      snapshot.url || "",
    htmlLang:
      snapshot.htmlLang || "",
    canonicals:
      Array.isArray(snapshot.canonicals)
        ? snapshot.canonicals
        : snapshot.canonical
          ? [snapshot.canonical]
          : [],
    hreflangs:
      Array.isArray(snapshot.hreflangs)
        ? snapshot.hreflangs
        : [],
    mobileAnnotations:
      Array.isArray(snapshot.mobileAnnotations)
        ? snapshot.mobileAnnotations
        : [],
    schemaUrlRefs:
      Array.isArray(snapshot.schemaUrlRefs)
        ? snapshot.schemaUrlRefs
        : [],
    environments: [],
    _source: "fallback"
  };
}

function renderUrlSignals() {
  const target =
    $("#urlSignalSummary");

  if (!target) return;

  const u =
    effectiveUrlSignals();

  if (!u) {
    target.innerHTML =
      '<div class="card"><span class="muted">Capture a page to review URL identity signals.</span></div>';
    return;
  }

  const hreflangRows =
    (u.hreflangs || [])
      .map(
        h => {
          const state =
            h.in_agreed_list === false
              ? `not in agreed list${h.suggested_value ? ` → ${h.suggested_value}` : ""}`
              : h.suggested_value
                ? `preferred form → ${h.suggested_value}`
                : "ok";

          return `${h.value || "(empty)"} → ${h.href || "(empty)"} [${state}]`;
        }
      );

  const schemaRows =
    (u.schemaUrlRefs || [])
      .slice(0, 12)
      .map(
        x =>
          `${x.nodeType || "unknown"} ${x.propertyPath}: ${x.value}`
      );

  const mobileRows =
    (u.mobileAnnotations || [])
      .map(
        x =>
          `${x.media || "(no media)"} → ${x.href || "(empty)"}`
      );

  target.innerHTML = `
    <div class="card">
      <h3>Declared identity signals</h3>
      ${
        u._source === "fallback"
          ? '<div class="muted small">Using current URL/canonical from an earlier snapshot. Capture a new analysis run to add hreflang, schema URL refs and mobile annotations.</div>'
          : ''
      }
      <div class="small"><strong>Current:</strong> ${escapeHtml(u.currentUrl || snapshot.url)}</div>
      <div class="small"><strong>HTML lang:</strong> ${escapeHtml(u.htmlLang || "(none)")}</div>
      <div class="small"><strong>Canonical:</strong> ${escapeHtml((u.canonicals || []).join(" | ") || "(none)")}</div>

      <div class="small" style="margin-top:8px"><strong>Hreflang (${hreflangRows.length})</strong></div>
      <pre>${escapeHtml(hreflangRows.join("\n") || "(none)")}</pre>

      <div class="small"><strong>Schema URL refs (${(u.schemaUrlRefs || []).length})</strong></div>
      <pre>${escapeHtml(schemaRows.join("\n") || "(none)")}</pre>

      <div class="small"><strong>Mobile rel=alternate (${mobileRows.length})</strong></div>
      <pre>${escapeHtml(mobileRows.join("\n") || "(none)")}</pre>
    </div>
  `;
}

function domDiffItemCard(item) {
  const value =
    item.rendered ||
    item.raw ||
    "";

  const packed =
    typeof value === "object"
      ? value
      : {text: value};

  const element =
    packed.element ||
    item.element ||
    {};

  const text =
    packed.text ||
    packed.href ||
    String(value || "");

  const d =
    document.createElement("div");

  d.className =
    "card";

  d.innerHTML = `
    <h3>#${item.id} · ${escapeHtml(item.kind)} · ${escapeHtml(item.change_type)}</h3>
    <div class="small"><strong>Element:</strong> ${escapeHtml(element.tag || "(unknown)")}</div>
    <div class="small"><strong>Selector:</strong> ${escapeHtml(element.selector || "(not available)")}</div>
    <div class="small"><strong>Zone/component:</strong> ${escapeHtml(element.zone || "unknown")} / ${escapeHtml(element.component || "unknown")}</div>
    <div class="small"><strong>Semantic weight:</strong> ${escapeHtml(element.semantic_weight ?? "(none)")}</div>
    <pre>${escapeHtml(text)}</pre>
    <button class="secondary" data-dom-jira>Create Jira ticket</button>
    <div data-dom-jira-result></div>
  `;

  const jiraBtn =
    d.querySelector(
      "[data-dom-jira]"
    );

  const jiraTarget =
    d.querySelector(
      "[data-dom-jira-result]"
    );

  jiraBtn.onclick =
    async () => {
      jiraTarget.innerHTML = "";

      try {
        await createJiraTicket({
          issue: item,
          context: {
            url:
              snapshot?.url || "",
            domDiffSummary:
              domDiff?.summary || {},
            domDiffCaveat:
              domDiff?.caveat || "",
            element
          },
          target:
            jiraTarget,
          button:
            jiraBtn
        });
      } catch (e) {
        setStatus(
          e?.message || String(e),
          true
        );
      }
    };

  return d;
}


function jiraTicketText(ticket) {
  return [
    ticket.summary || "Untitled issue",
    "",
    "Current behaviour",
    ticket.current_behavior || "",
    "",
    "Desired behaviour",
    ticket.desired_behavior || "",
    "",
    "Why this is important",
    ticket.why_important || "",
    "",
    "Example URL",
    ticket.example_url || "",
    "",
    "Evidence",
    ...(ticket.evidence || []).map(x => `- ${x}`)
  ].join("\n");
}

function renderJiraTicket(target, ticket) {
  const card =
    document.createElement("div");

  card.className =
    "card";

  const text =
    jiraTicketText(ticket);

  card.innerHTML = `
    <h3>Jira ticket draft</h3>
    <div class="small"><strong>${escapeHtml(ticket.summary || "Untitled issue")}</strong></div>
    <div class="small" style="margin-top:8px"><strong>Current behaviour</strong></div>
    <div class="small">${escapeHtml(ticket.current_behavior || "")}</div>
    <div class="small" style="margin-top:8px"><strong>Desired behaviour</strong></div>
    <div class="small">${escapeHtml(ticket.desired_behavior || "")}</div>
    <div class="small" style="margin-top:8px"><strong>Why this is important</strong></div>
    <div class="small">${escapeHtml(ticket.why_important || "")}</div>
    <div class="small" style="margin-top:8px"><strong>Example URL</strong></div>
    <div class="small">${escapeHtml(ticket.example_url || "")}</div>
    <div class="small" style="margin-top:8px"><strong>Evidence</strong></div>
    <pre>${escapeHtml((ticket.evidence || []).map(x => `- ${x}`).join("\n"))}</pre>
    <button class="secondary" data-copy-jira>Copy ticket</button>
  `;

  card
    .querySelector(
      "[data-copy-jira]"
    )
    .onclick =
      async () => {
        await navigator.clipboard.writeText(
          text
        );

        setStatus(
          "Jira ticket copied."
        );

        setTimeout(
          () =>
            setStatus(""),
          1200
        );
      };

  target.appendChild(card);
}

async function createJiraTicket({
  issue,
  context,
  target,
  button
}) {
  if (!snapshot?.url) {
    throw new Error(
      "Capture a page first."
    );
  }

  button.disabled = true;

  try {
    setStatus(
      "Drafting Jira ticket with Nano…"
    );

    const ticket =
      await sw({
        type: "RUN_TASK",
        task: "jira_ticket",
        provider: "nano",
        analysisRunId: analysisRun?.id || null,
        payload: {
          issue,
          context,
          exampleUrl:
            snapshot.url
        },
        useCache:
          $("#useCache").checked
      });

    renderJiraTicket(
      target,
      ticket
    );

    setStatus("");
  } finally {
    button.disabled = false;
  }
}


function resetTaskResultState() {
  for (const task of Object.keys(taskResults)) {
    taskResults[task] = {};
  }
}

function setAnalyseAllProgress(percent, text) {
  const wrap = $("#analyseAllProgressWrap");
  const bar = $("#analyseAllProgressBar");
  const label = $("#analyseAllProgressText");

  if (wrap) wrap.hidden = false;
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (label) label.textContent = text || "";
}

function clearAnalysisOutput() {
  const selectors = [
    "#linkResults",
    "#intentResults",
    "#issues",
    "#domDiffResults",
    "#urlConsistencyResults",
    "#analyseAllResults"
  ];

  selectors.forEach(selector => {
    const el = $(selector);
    if (el) el.innerHTML = "";
  });

  const linkProgress = $("#linkProgress");
  if (linkProgress) linkProgress.textContent = "";

  const auditSummary = $("#auditSummary");
  if (auditSummary) auditSummary.textContent = "Analyse all is running…";

  const domSummary = $("#domDiffSummary");
  if (domSummary) domSummary.textContent = "Analyse all is running…";

  const urlSummary = $("#urlSignalSummary");
  if (urlSummary) urlSummary.innerHTML = '<div class="card"><span class="muted">Analyse all is running…</span></div>';
}

async function runTaskSilent(task, provider, payload, mode = null) {
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
      ensureModeStore(task, mode);
      taskResults[task][mode][provider] = result;
    } else {
      taskResults[task] ||= {};
      taskResults[task][provider] = result;
    }

    return {ok: true, result};
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e)
    };
  }
}

function withoutMeta(result) {
  if (!result || typeof result !== "object") return result;
  const clean = {...result};
  delete clean._meta;
  return clean;
}

function analyseResultDetails(title, value, open = false) {
  const details = document.createElement("details");
  details.className = "card analyse-result-group";
  details.open = open;
  details.innerHTML =
    `<summary>${escapeHtml(title)}</summary>` +
    `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  return details;
}

function renderAnalyseAllResults(report) {
  const target = $("#analyseAllResults");
  if (!target) return;

  target.innerHTML = "";

  const summary = document.createElement("div");
  summary.className = "card analyse-results-summary";
  summary.innerHTML = `
    <h3>Complete analysis</h3>
    <div class="small"><strong>URL:</strong> ${escapeHtml(report.url || "")}</div>
    <div class="small"><strong>Providers:</strong> ${escapeHtml(report.providers.join(", "))}</div>
    <div class="small"><strong>Input modes:</strong> ${escapeHtml(report.modes.join(", "))}</div>
    <div class="small"><strong>Model calls:</strong> ${report.completedCalls}/${report.totalCalls}</div>
    <div class="small"><strong>Errors:</strong> ${report.errors.length}</div>
  `;
  target.appendChild(summary);

  target.appendChild(
    analyseResultDetails(
      "Deterministic checks",
      report.deterministic,
      true
    )
  );

  target.appendChild(
    analyseResultDetails(
      "Page type",
      report.pageType
    )
  );

  target.appendChild(
    analyseResultDetails(
      "Intent",
      report.intent
    )
  );

  target.appendChild(
    analyseResultDetails(
      "Page type ↔ intent alignment",
      report.alignment
    )
  );

  target.appendChild(
    analyseResultDetails(
      "Link context",
      report.links
    )
  );

  const fp = analyseResultDetails(
    "False-positive triage",
    report.falsePositives,
    report.falsePositives.length > 0
  );
  target.appendChild(fp);

  // Jira buttons for deterministic findings in the consolidated output.
  if (report.falsePositives.length) {
    const jiraBox = document.createElement("div");
    jiraBox.className = "card";
    jiraBox.innerHTML = "<h3>Finding actions</h3>";

    const findings = snapshot?.auditChecks?.filter(x => x.status === "finding") || [];
    findings.forEach((issue, index) => {
      const row = document.createElement("div");
      row.className = "issue";
      row.innerHTML = `
        <div class="issue-head">
          <div>
            <strong>${escapeHtml(issue.code)}</strong>
            <div class="muted small">${escapeHtml(issue.message)}</div>
          </div>
          <button class="secondary" data-all-jira>Create Jira ticket</button>
        </div>
        <div data-all-jira-result></div>
      `;

      const btn = row.querySelector("[data-all-jira]");
      const jiraTarget = row.querySelector("[data-all-jira-result]");
      btn.onclick = async () => {
        jiraTarget.innerHTML = "";
        try {
          await createJiraTicket({
            issue,
            context: pageContextForIssue(issue),
            target: jiraTarget,
            button: btn
          });
        } catch (e) {
          setStatus(e?.message || String(e), true);
        }
      };

      jiraBox.appendChild(row);
    });

    target.appendChild(jiraBox);
  }

  target.appendChild(
    analyseResultDetails(
      "Server HTML ↔ rendered DOM",
      report.domDiff,
      (report.domDiff?.assessments?.length || 0) > 0
    )
  );

  const domJudgements = new Map();
  for (const assessment of report.domDiff?.assessments || []) {
    for (const result of assessment.result?.results || []) {
      if (!domJudgements.has(result.id)) domJudgements.set(result.id, []);
      domJudgements.get(result.id).push({provider: assessment.provider, ...result});
    }
  }

  const domIssues = (report.domDiff?.items || []).filter(item => {
    const judgements = domJudgements.get(item.id) || [];
    return judgements.some(j => j.judgement !== "probably_harmless");
  });

  if (domIssues.length) {
    const box = document.createElement("div");
    box.className = "card";
    box.innerHTML = "<h3>DOM-diff issue actions</h3>";

    domIssues.forEach(item => {
      const row = domDiffItemCard(item);
      const judgements = domJudgements.get(item.id) || [];
      const assessment = document.createElement("pre");
      assessment.textContent = JSON.stringify(judgements, null, 2);
      row.appendChild(assessment);
      box.appendChild(row);
    });

    target.appendChild(box);
  }

  target.appendChild(
    analyseResultDetails(
      "URL identity & locale consistency",
      report.urlConsistency,
      true
    )
  );

  const urlIssueRows = [];
  for (const providerResult of report.urlConsistency || []) {
    for (const finding of providerResult.result?.findings || []) {
      if (finding.judgement === "likely_correct") continue;
      urlIssueRows.push({provider: providerResult.provider, finding, review: providerResult.result});
    }
  }

  if (urlIssueRows.length) {
    const box = document.createElement("div");
    box.className = "card";
    box.innerHTML = "<h3>URL / locale issue actions</h3>";

    urlIssueRows.forEach(({provider, finding, review}) => {
      const row = document.createElement("div");
      row.className = "issue";
      row.innerHTML = `
        <div class="issue-head">
          <div>
            <strong>${escapeHtml(finding.source)} · ${escapeHtml(provider)}</strong>
            <div class="muted small">${escapeHtml(finding.rationale || "")}</div>
          </div>
          <button class="secondary" data-all-url-jira>Create Jira ticket</button>
        </div>
        <div data-all-url-jira-result></div>
      `;

      const btn = row.querySelector("[data-all-url-jira]");
      const jiraTarget = row.querySelector("[data-all-url-jira-result]");
      btn.onclick = async () => {
        jiraTarget.innerHTML = "";
        try {
          await createJiraTicket({
            issue: finding,
            context: {
              url: snapshot?.url || "",
              urlSignals: effectiveUrlSignals(),
              reviewSummary: review.summary,
              overall: review.overall
            },
            target: jiraTarget,
            button: btn
          });
        } catch (e) {
          setStatus(e?.message || String(e), true);
        }
      };

      box.appendChild(row);
    });

    target.appendChild(box);
  }

  if (report.errors.length) {
    const errors = analyseResultDetails(
      "Errors / incomplete steps",
      report.errors,
      true
    );
    errors.classList.add("analyse-result-error");
    target.appendChild(errors);
  }
}

async function analyseAll() {
  if (analyseAllRunning) return;

  const providers = enabledProviders();
  if (!providers.length) {
    setStatus("Select at least one provider.", true);
    return;
  }

  analyseAllRunning = true;
  const button = $("#analyseAllBtn");
  if (button) button.disabled = true;

  clearAnalysisOutput();
  setStatus("");
  setAnalyseAllProgress(2, "Capturing page and starting a new analysis run…");

  try {
    const ctx = await sw({type: "CAPTURE"});
    snapshot = ctx.snapshot;
    analysisRun = ctx.analysisRun;
    linkCursor = 0;
    domDiffCursor = 0;
    domDiff = null;
    resetTaskResultState();
    updatePageMeta();

    setAnalyseAllProgress(6, "Building deterministic server/rendered DOM diff…");
    let domDiffError = null;

    try {
      domDiff = await sw({type: "BUILD_DOM_DIFF"});
      snapshot.domDiff = domDiff;
    } catch (e) {
      domDiffError = e?.message || String(e);
      domDiff = null;
    }

    const modes = modesToRun();
    const findings = (snapshot.auditChecks || []).filter(x => x.status === "finding");
    const linkPool = (snapshot.links || []).slice(0, settings.limits.maxLinksForClassification);
    const linkBatchSize = Math.max(1, settings.limits.linkBatchSize || 8);
    const linkBatches = [];
    for (let i = 0; i < linkPool.length; i += linkBatchSize) {
      linkBatches.push(linkPool.slice(i, i + linkBatchSize));
    }

    const diffItems = domDiff?.items || [];
    const diffBatchSize = Math.max(1, settings.limits.domDiffBatchSize || 6);
    const diffBatches = [];
    for (let i = 0; i < diffItems.length; i += diffBatchSize) {
      diffBatches.push(diffItems.slice(i, i + diffBatchSize));
    }

    const perProviderCalls =
      linkBatches.length +
      (modes.length * 3) +
      findings.length +
      diffBatches.length +
      1;

    const totalCalls = Math.max(1, providers.length * perProviderCalls);
    let completedCalls = 0;

    const report = {
      url: snapshot.url,
      providers: [...providers],
      modes: [...modes],
      totalCalls,
      completedCalls: 0,
      deterministic: {
        checks: snapshot.auditChecks || [],
        findings,
        urlSignals: effectiveUrlSignals()
      },
      links: [],
      pageType: [],
      intent: [],
      alignment: [],
      falsePositives: [],
      domDiff: {
        summary: domDiff?.summary || null,
        caveat: domDiff?.caveat || null,
        items: diffItems,
        assessments: []
      },
      urlConsistency: [],
      errors: []
    };

    if (domDiffError) {
      report.errors.push({stage: "build_dom_diff", error: domDiffError});
    }

    const bump = label => {
      completedCalls += 1;
      report.completedCalls = completedCalls;
      const percent = 8 + ((completedCalls / totalCalls) * 90);
      setAnalyseAllProgress(percent, `${label} · ${completedCalls}/${totalCalls} model calls`);
    };

    // 1. Link context, all configured batches.
    for (let batchIndex = 0; batchIndex < linkBatches.length; batchIndex += 1) {
      const batch = linkBatches[batchIndex].map(l => ({
        id: l.id,
        href: l.href,
        internal: l.internal,
        anchor: l.anchor,
        rel: l.rel,
        zone: l.zone,
        context: l.context
      }));

      for (const provider of providers) {
        const call = await runTaskSilent("link_group", provider, {links: batch});
        report.links.push({
          batch: batchIndex + 1,
          provider,
          inputCount: batch.length,
          result: call.ok ? withoutMeta(call.result) : null,
          error: call.ok ? null : call.error
        });
        if (!call.ok) report.errors.push({stage: "link_group", batch: batchIndex + 1, provider, error: call.error});
        bump(`Links · batch ${batchIndex + 1}/${linkBatches.length} · ${provider}`);
      }
    }

    // 2. Page type and intent for every selected representation.
    for (const mode of modes) {
      for (const provider of providers) {
        const call = await runTaskSilent("page_type", provider, {snapshot}, mode);
        report.pageType.push({mode, provider, result: call.ok ? withoutMeta(call.result) : null, error: call.ok ? null : call.error});
        if (!call.ok) report.errors.push({stage: "page_type", mode, provider, error: call.error});
        bump(`Page type · ${mode} · ${provider}`);
      }
    }

    for (const mode of modes) {
      for (const provider of providers) {
        const call = await runTaskSilent("intent", provider, {snapshot}, mode);
        report.intent.push({mode, provider, result: call.ok ? withoutMeta(call.result) : null, error: call.ok ? null : call.error});
        if (!call.ok) report.errors.push({stage: "intent", mode, provider, error: call.error});
        bump(`Intent · ${mode} · ${provider}`);
      }
    }

    for (const mode of modes) {
      for (const provider of providers) {
        const pageTypeResult = taskResults.page_type?.[mode]?.[provider];
        const intentResult = taskResults.intent?.[mode]?.[provider];

        if (!pageTypeResult || !intentResult) {
          const error = "Page type and/or intent result unavailable for alignment.";
          report.alignment.push({mode, provider, result: null, error});
          report.errors.push({stage: "alignment", mode, provider, error});
          bump(`Alignment · ${mode} · ${provider}`);
          continue;
        }

        const call = await runTaskSilent(
          "alignment",
          provider,
          {snapshot, pageTypeResult, intentResult},
          mode
        );
        report.alignment.push({mode, provider, result: call.ok ? withoutMeta(call.result) : null, error: call.ok ? null : call.error});
        if (!call.ok) report.errors.push({stage: "alignment", mode, provider, error: call.error});
        bump(`Alignment · ${mode} · ${provider}`);
      }
    }

    // 3. Triage every deterministic finding.
    for (const issue of findings) {
      for (const provider of providers) {
        const call = await runTaskSilent(
          "false_positive",
          provider,
          {issue, context: pageContextForIssue(issue)}
        );
        report.falsePositives.push({
          issue: {code: issue.code, message: issue.message},
          provider,
          result: call.ok ? withoutMeta(call.result) : null,
          error: call.ok ? null : call.error
        });
        if (!call.ok) report.errors.push({stage: "false_positive", issue: issue.code, provider, error: call.error});
        bump(`Finding · ${issue.code} · ${provider}`);
      }
    }

    // 4. Assess every retained DOM-diff batch.
    for (let batchIndex = 0; batchIndex < diffBatches.length; batchIndex += 1) {
      const batch = diffBatches[batchIndex];
      for (const provider of providers) {
        const call = await runTaskSilent("dom_diff_triage", provider, {items: batch});
        report.domDiff.assessments.push({
          batch: batchIndex + 1,
          provider,
          itemIds: batch.map(x => x.id),
          result: call.ok ? withoutMeta(call.result) : null,
          error: call.ok ? null : call.error
        });
        if (!call.ok) report.errors.push({stage: "dom_diff_triage", batch: batchIndex + 1, provider, error: call.error});
        bump(`DOM diff · batch ${batchIndex + 1}/${diffBatches.length} · ${provider}`);
      }
    }

    // 5. URL / locale / identity consistency.
    const urlSignals = effectiveUrlSignals();
    for (const provider of providers) {
      const call = await runTaskSilent("url_consistency", provider, {urlSignals});
      report.urlConsistency.push({
        provider,
        result: call.ok ? withoutMeta(call.result) : null,
        error: call.ok ? null : call.error
      });
      if (!call.ok) report.errors.push({stage: "url_consistency", provider, error: call.error});
      bump(`URL & locale consistency · ${provider}`);
    }

    // Only reveal/refresh the normal sections once the full run is complete.
    renderIssues();
    renderDomDiffSummary();
    renderUrlSignals();
    renderAnalyseAllResults(report);

    setAnalyseAllProgress(100, `Complete · ${completedCalls}/${totalCalls} model calls · ${report.errors.length} error(s)`);
    setStatus("");
  } catch (e) {
    setAnalyseAllProgress(100, `Stopped: ${e?.message || String(e)}`);
    setStatus(e?.message || String(e), true);
  } finally {
    analyseAllRunning = false;
    if (button) button.disabled = false;
  }
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
  renderUrlSignals();
}

$("#analyseAllBtn").onclick = async () => {
  await analyseAll();
};

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
    renderUrlSignals();

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

    batch.forEach(
      item =>
        target.appendChild(
          domDiffItemCard(item)
        )
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


$("#reviewUrlSignalsBtn").onclick =
  async () => {
    if (!snapshot) {
      return setStatus(
        "Capture a page first.",
        true
      );
    }

    const urlSignals =
      effectiveUrlSignals();

    if (!urlSignals) {
      return setStatus(
        "Capture a page first.",
        true
      );
    }

    const target =
      $("#urlConsistencyResults");

    target.innerHTML = "";

    try {
      const providers =
        enabledProviders();

      if (!providers.length) {
        throw new Error(
          "Select at least one provider."
        );
      }

      for (const provider of providers) {
        setStatus(
          `Running url_consistency · ${provider}…`
        );

        const result =
          await sw({
            type: "RUN_TASK",
            task: "url_consistency",
            provider,
            analysisRunId:
              analysisRun.id,
            payload: {
              urlSignals
            },
            useCache:
              $("#useCache").checked
          });

        taskResults.url_consistency[
          provider
        ] = result;

        const card =
          providerCard(
            provider,
            result
          );

        const findings =
          result.findings || [];

        findings.forEach(
          (finding, index) => {
            if (
              finding.judgement ===
              "likely_correct"
            ) {
              return;
            }

            const holder =
              document.createElement(
                "div"
              );

            holder.className =
              "issue";

            holder.innerHTML = `
              <div class="issue-head">
                <div>
                  <strong>${escapeHtml(finding.source)}</strong>
                  <div class="muted small">${escapeHtml(finding.rationale || "")}</div>
                </div>
                <button class="secondary" data-url-jira>Create Jira ticket</button>
              </div>
              <div data-url-jira-result></div>
            `;

            const btn =
              holder.querySelector(
                "[data-url-jira]"
              );

            const jiraTarget =
              holder.querySelector(
                "[data-url-jira-result]"
              );

            btn.onclick =
              async () => {
                jiraTarget.innerHTML = "";

                try {
                  await createJiraTicket({
                    issue:
                      finding,
                    context: {
                      url:
                        snapshot.url,
                      urlSignals,
                      reviewSummary:
                        result.summary,
                      overall:
                        result.overall
                    },
                    target:
                      jiraTarget,
                    button:
                      btn
                  });
                } catch (e) {
                  setStatus(
                    e?.message || String(e),
                    true
                  );
                }
              };

            card.appendChild(
              holder
            );
          }
        );

        target.appendChild(
          card
        );
      }

      setStatus("");
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
