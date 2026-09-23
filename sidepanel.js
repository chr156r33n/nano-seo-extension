
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
let lastAnalyseAllReport = null;

const $ = s => document.querySelector(s);

function setStatus(t, error = false) {
  const el = $("#status");
  el.style.display = t ? "block" : "none";
  el.textContent = t || "";
  el.classList.toggle("error", Boolean(error));
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
    ? (
        snapshot.url
          ? `${snapshot.title || "(untitled)"} · ${snapshot.url}`
          : "Previous page read available."
      )
    : "No page read yet.";

  $("#runMeta").textContent = analysisRun
    ? `run ${analysisRun.id.slice(0, 8)} · started ${new Date(analysisRun.startedAt).toLocaleString()}`
    : "";
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


function humanLabel(value) {
  return String(value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function toneForValue(value) {
  const v = String(value ?? "").toLowerCase();
  if (["strong","likely_consistent","likely_correct","likely_false_positive","pass","probably_harmless"].includes(v)) return "good";
  if (["weak","likely_incorrect","likely_valid","finding","likely_important","error"].includes(v)) return "bad";
  if (["partial","mostly_consistent","needs_review","context_dependent","manual_review","mixed","unclear"].includes(v)) return "warn";
  return "neutral";
}

function badgeHtml(value, tone = null) {
  if (value === undefined || value === null || value === "") return "";
  const resolvedTone = tone || toneForValue(value);
  return `<span class="result-badge ${resolvedTone}">${escapeHtml(humanLabel(value))}</span>`;
}

function confidenceHtml(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return `<span class="confidence">${Math.round(value * 100)}% confidence</span>`;
}

function chipsHtml(values = []) {
  const items = (values || []).filter(Boolean);
  if (!items.length) return '<span class="muted small">None</span>';
  return `<div class="chip-row">${items.map(value => `<span class="mini-chip">${escapeHtml(humanLabel(value))}</span>`).join("")}</div>`;
}

function evidenceHtml(items = [], title = "Evidence") {
  const values = (items || []).filter(Boolean);
  if (!values.length) return "";
  return `<div class="result-subsection"><div class="result-label">${escapeHtml(title)}</div><ul class="evidence-list">${values.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
}

function rawJsonDetails(value) {
  return `<details class="raw-json"><summary>Raw JSON</summary><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></details>`;
}

function metricHtml(label, value) {
  return `<div class="metric"><span class="metric-value">${escapeHtml(value ?? 0)}</span><span class="metric-label">${escapeHtml(label)}</span></div>`;
}

function genericResultHtml(result) {
  if (!result || typeof result !== "object") return `<div class="result-copy">${escapeHtml(result ?? "")}</div>`;
  if (Array.isArray(result)) {
    return `<div class="result-list">${result.map(item => `<div class="result-row static">${genericResultHtml(item)}</div>`).join("") || '<div class="muted">No results.</div>'}</div>`;
  }
  const rows = Object.entries(result).filter(([key]) => key !== "_meta").map(([key, value]) => {
    let rendered = "";
    if (Array.isArray(value)) rendered = value.length ? chipsHtml(value.map(item => typeof item === "string" ? item : JSON.stringify(item))) : '<span class="muted">None</span>';
    else if (value && typeof value === "object") rendered = `<code>${escapeHtml(JSON.stringify(value))}</code>`;
    else rendered = escapeHtml(value ?? "");
    return `<div class="result-kv-row"><div class="result-label">${escapeHtml(humanLabel(key))}</div><div>${rendered}</div></div>`;
  }).join("");
  return `<div class="result-kv">${rows || '<div class="muted">No result fields.</div>'}</div>`;
}

function taskResultHtml(task, result) {
  const r = withoutMeta(result) || {};
  if (task === "page_type") return `<div class="result-primary">${badgeHtml(r.page_type, "info")}${confidenceHtml(r.confidence)}</div>${evidenceHtml(r.evidence)}`;
  if (task === "intent") return `<div class="result-primary">${badgeHtml(r.primary_intent, "info")}${r.split_intent ? badgeHtml("split intent", "warn") : ""}${confidenceHtml(r.confidence)}</div><div class="result-grid two"><div><div class="result-label">Supporting intent</div>${chipsHtml(r.supporting_intents)}</div><div><div class="result-label">Independent secondary intent</div>${chipsHtml(r.secondary_intents)}</div></div>${evidenceHtml(r.evidence)}`;
  if (task === "alignment") return `<div class="result-primary">${badgeHtml(r.alignment)}${r.split_intent ? badgeHtml("split intent", "warn") : ""}${confidenceHtml(r.confidence)}</div>${r.mismatch_reason ? `<div class="result-subsection"><div class="result-label">Mismatch reason</div><div class="result-copy">${escapeHtml(r.mismatch_reason)}</div></div>` : ""}${evidenceHtml(r.notes, "Notes")}`;
  if (task === "false_positive") return `<div class="result-primary">${badgeHtml(r.judgement)}${confidenceHtml(r.confidence)}</div>${r.rationale ? `<div class="result-copy">${escapeHtml(r.rationale)}</div>` : ""}${evidenceHtml(r.evidence_used, "Evidence reviewed")}${(r.item_assessments || []).length ? `<div class="result-subsection"><div class="result-label">Affected items</div><div class="result-list">${r.item_assessments.map(item => `<div class="result-row static"><div class="result-row-head"><code>${escapeHtml(item.item || "")}</code>${badgeHtml(item.judgement)}</div><div class="result-copy">${escapeHtml(item.rationale || "")}</div></div>`).join("")}</div></div>` : ""}${evidenceHtml(r.useful_context, "Useful context")}`;
  if (task === "link_group") {
    const rows = r.results || []; const counts = {};
    for (const row of rows) counts[row.category] = (counts[row.category] || 0) + 1;
    return `<div class="result-subsection"><div class="result-label">Categories in this batch</div><div class="chip-row">${Object.entries(counts).map(([category,count]) => `<span class="mini-chip">${escapeHtml(humanLabel(category))} <strong>${count}</strong></span>`).join("") || '<span class="muted small">No links returned.</span>'}</div></div><div class="result-list">${rows.map(row => `<details class="result-row"><summary><span>#${escapeHtml(row.id)}</span>${badgeHtml(row.category,"neutral")}${confidenceHtml(row.confidence)}</summary><div class="result-copy">${escapeHtml(row.rationale || "")}</div></details>`).join("")}</div>`;
  }
  if (task === "dom_diff_triage") {
    const rows = r.results || [];
    return `<div class="result-list">${rows.map(row => `<div class="result-row static"><div class="result-row-head"><strong>#${escapeHtml(row.id)}</strong>${badgeHtml(row.judgement)}${badgeHtml(row.impact,"neutral")}${confidenceHtml(row.confidence)}</div><div class="result-copy">${escapeHtml(row.rationale || "")}</div></div>`).join("") || '<div class="muted small">No DOM differences returned.</div>'}</div>`;
  }
  if (task === "url_consistency") {
    const findings = r.findings || [];
    return `<div class="result-primary">${badgeHtml(r.overall)}${confidenceHtml(r.confidence)}</div>${r.summary ? `<div class="result-copy">${escapeHtml(r.summary)}</div>` : ""}<div class="result-list">${findings.map(finding => `<div class="result-row static"><div class="result-row-head">${badgeHtml(finding.source,"neutral")}${badgeHtml(finding.judgement)}</div>${finding.value ? `<div class="result-kv-row compact"><div class="result-label">Value</div><code>${escapeHtml(finding.value)}</code></div>` : ""}${finding.suggested_value ? `<div class="result-kv-row compact"><div class="result-label">Suggested</div><code>${escapeHtml(finding.suggested_value)}</code></div>` : ""}<div class="result-copy">${escapeHtml(finding.rationale || "")}</div></div>`).join("") || '<div class="muted small">No individual findings.</div>'}</div>`;
  }
  return genericResultHtml(r);
}

function providerCard(task, provider, result, mode = null) {
  const d = document.createElement("div");
  d.className = "card result-card";

  const meta =
    result?._meta || {};

  const clean =
    withoutMeta(
      result
    ) || {};

  const context =
    mode
      ? `<span class="mini-chip">${escapeHtml(humanLabel(mode))}</span>`
      : "";

  const nanoMeta =
    provider === "nano"
      ? meta.providerMeta || {}
      : {};

  const timing =
    nanoMeta.timing || {};

  const session =
    nanoMeta.session || {};

  const contextMeta =
    nanoMeta.context || {};

  const timingChips =
    provider === "nano" &&
    !meta.cacheHit
      ? [
          Number.isFinite(
            timing.baseSessionCreateMs
          )
            ? `<span class="mini-chip">create ${escapeHtml(timing.baseSessionCreateMs)} ms</span>`
            : "",
          Number.isFinite(
            timing.cloneMs
          )
            ? `<span class="mini-chip">clone ${escapeHtml(timing.cloneMs)} ms</span>`
            : "",
          Number.isFinite(
            timing.measureContextMs
          )
            ? `<span class="mini-chip">measure ${escapeHtml(timing.measureContextMs)} ms</span>`
            : "",
          Number.isFinite(
            timing.promptMs
          )
            ? `<span class="mini-chip">prompt ${escapeHtml(timing.promptMs)} ms</span>`
            : "",
          Number.isFinite(
            contextMeta.measuredUtilisation
          )
            ? `<span class="mini-chip">context ${escapeHtml(Math.round(contextMeta.measuredUtilisation * 100))}%</span>`
            : "",
          session.baseSessionReused
            ? '<span class="mini-chip enabled">base reused</span>'
            : '<span class="mini-chip">base created</span>'
        ]
          .filter(Boolean)
          .join("")
      : "";

  d.innerHTML =
    `<div class="result-card-head"><div><div class="result-provider">${escapeHtml(provider)}</div><div class="result-meta">${context}${meta.cacheHit ? '<span class="mini-chip">Cache</span>' : ""}${meta.durationMs ? `<span>${escapeHtml(meta.durationMs)} ms total</span>` : ""}${timingChips}</div></div></div><div class="result-body">${taskResultHtml(task, clean)}</div>${rawJsonDetails(clean)}`;

  return d;
}

function analyseTaskDetails(title, entries, task, open = false) {
  const details = document.createElement("details"); details.className = "card analyse-result-group"; details.open = open;
  const rows = entries || [];
  details.innerHTML = `<summary><span>${escapeHtml(title)}</span><span class="summary-count">${rows.length}</span></summary><div class="analyse-group-body"></div>`;
  const body = details.querySelector(".analyse-group-body");
  if (!rows.length) { body.innerHTML = '<div class="empty-state">No results for this stage.</div>'; return details; }
  for (const entry of rows) {
    const context = entry.mode || (entry.batch ? `batch ${entry.batch}` : "") || entry.issue?.code || null;
    if (entry.error) {
      const errorCard = document.createElement("div"); errorCard.className = "card result-card error-card";
      errorCard.innerHTML = `<div class="result-card-head"><div class="result-provider">${escapeHtml(entry.provider || "Unknown provider")}</div>${badgeHtml("error","bad")}</div><div class="result-copy">${escapeHtml(entry.error)}</div>`;
      body.appendChild(errorCard); continue;
    }
    body.appendChild(providerCard(task, entry.provider || "result", entry.result || {}, context));
  }
  return details;
}

function renderPassedChecks() {
  const target =
    $("#passedChecks");

  if (!target) return;

  const passes =
    (
      snapshot?.auditChecks ||
      []
    )
      .filter(
        check =>
          check.status ===
          "pass"
      );

  if (!snapshot) {
    target.innerHTML =
      '<div class="empty-state">Read the page to see passed checks.</div>';
    return;
  }

  target.innerHTML =
    passes.length
      ? `
        <details class="card analyse-result-group">
          <summary>
            <span>${passes.length} checks passed</span>
            ${badgeHtml("pass", "good")}
          </summary>
          <div class="analyse-group-body">
            <div class="finding-list">
              ${passes
                .map(
                  check =>
                    `<div class="finding-row compact">
                      <div>
                        <div class="finding-title">${escapeHtml(humanLabel(check.code))}</div>
                        <div class="muted small">${escapeHtml(check.message || "")}</div>
                      </div>
                      ${badgeHtml("pass", "good")}
                    </div>`
                )
                .join("")}
            </div>
          </div>
        </details>
      `
      : '<div class="empty-state">No deterministic checks are currently recorded as passed.</div>';
}

const DETERMINISTIC_PRIORITY = {
  robots_conflict: "high",
  robots_noindex: "high",
  canonical_protocol_downgrade: "high",
  multiple_canonical: "high",
  canonical_fragment: "high",
  canonical_presence: "medium",
  canonical_cross_origin: "medium",
  jsonld_parse_error: "medium",
  hreflang_duplicate_value: "medium",
  hreflang_unapproved_value: "medium",
  hreflang_invalid_format: "medium",
  hreflang_empty_href: "medium",
  internal_http_links: "medium",
  h1_presence: "medium",
  multiple_h1: "low",
  heading_hierarchy: "low",
  title_presence: "medium",
  title_length: "low",
  meta_description_presence: "low",
  meta_description_length: "low",
  html_lang_presence: "low",
  html_lang_format: "low",
  images_missing_alt: "medium",
  images_empty_alt: "low",
  images_missing_dimensions: "low",
  links_empty_anchor: "medium",
  viewport_presence: "medium",
  open_graph_incomplete: "low",
  og_url_mismatch: "low",
  twitter_card_incomplete: "low",
  favicon_presence: "low"
};

function priorityRank(value) {
  return {
    high: 0,
    medium: 1,
    review: 2,
    low: 3
  }[
    value
  ] ?? 4;
}

function priorityBadgeHtml(value) {
  const tone =
    value === "high"
      ? "bad"
      : value === "medium" ||
        value === "review"
        ? "warn"
        : "neutral";

  return badgeHtml(
    value,
    tone
  );
}

function buildActionRows(report) {
  const actions = [];

  const triageByCode =
    new Map();

  for (
    const entry
    of report.falsePositives ||
    []
  ) {
    const code =
      entry.issue?.code;

    if (!code) continue;

    if (
      !triageByCode.has(
        code
      )
    ) {
      triageByCode.set(
        code,
        []
      );
    }

    if (entry.result) {
      triageByCode
        .get(
          code
        )
        .push({
          provider:
            entry.provider,
          ...entry.result
        });
    }
  }

  for (
    const finding
    of report.deterministic
      ?.findings ||
    []
  ) {
    const reviews =
      triageByCode.get(
        finding.code
      ) ||
      [];

    const judgements =
      reviews.map(
        review =>
          review.judgement
      );

    if (
      judgements.length &&
      judgements.every(
        judgement =>
          judgement ===
          "likely_false_positive"
      )
    ) {
      continue;
    }

    let priority =
      DETERMINISTIC_PRIORITY[
        finding.code
      ] ||
      "medium";

    if (
      judgements.includes(
        "manual_review"
      ) ||
      judgements.includes(
        "context_dependent"
      )
    ) {
      priority =
        "review";
    }

    const confirmed =
      judgements.includes(
        "likely_valid"
      );

    actions.push({
      priority,
      area:
        "Deterministic",
      test:
        humanLabel(
          finding.code
        ),
      action:
        finding.message ||
        humanLabel(
          finding.code
        ),
      basis:
        reviews.length
          ? reviews
              .map(
                review =>
                  `${review.provider}: ${humanLabel(review.judgement)}${Number.isFinite(review.confidence) ? ` (${Math.round(review.confidence * 100)}%)` : ""}`
              )
              .join(" · ")
          : "Automated finding; not model-reviewed",
      state:
        confirmed
          ? "Model-supported"
          : reviews.length
            ? "Needs review"
            : "Unreviewed"
    });
  }

  const alignmentGroups =
    new Map();

  for (
    const entry
    of report.alignment ||
    []
  ) {
    if (
      entry.error ||
      !entry.result
    ) {
      continue;
    }

    const value =
      entry.result
        .alignment;

    if (
      value ===
      "strong"
    ) {
      continue;
    }

    const key =
      entry.mode ||
      "default";

    if (
      !alignmentGroups.has(
        key
      )
    ) {
      alignmentGroups.set(
        key,
        []
      );
    }

    alignmentGroups
      .get(key)
      .push(entry);
  }

  for (
    const [mode, entries]
    of alignmentGroups
  ) {
    const values =
      entries.map(
        entry =>
          entry.result
            .alignment
      );

    const priority =
      values.includes("weak")
        ? "high"
        : values.includes("partial")
          ? "medium"
          : "review";

    actions.push({
      priority,
      area:
        "Page purpose",
      test:
        `Page type ↔ intent · ${humanLabel(mode)}`,
      action:
        "Review whether the page structure supports the user intent identified by the models.",
      basis:
        entries
          .map(
            entry =>
              `${entry.provider}: ${humanLabel(entry.result.alignment)}${entry.result.mismatch_reason ? ` · ${entry.result.mismatch_reason}` : ""}`
          )
          .join(" | "),
      state:
        "Model review"
    });
  }

  const domById =
    new Map();

  for (
    const assessment
    of report.domDiff
      ?.assessments ||
    []
  ) {
    for (
      const result
      of assessment.result
        ?.results ||
      []
    ) {
      if (
        result.judgement ===
        "probably_harmless"
      ) {
        continue;
      }

      if (
        !domById.has(
          result.id
        )
      ) {
        domById.set(
          result.id,
          []
        );
      }

      domById
        .get(
          result.id
        )
        .push({
          provider:
            assessment.provider,
          ...result
        });
    }
  }

  for (
    const [id, results]
    of domById
  ) {
    const impacts =
      results.map(
        result =>
          result.impact
      );

    const important =
      results.some(
        result =>
          result.judgement ===
          "likely_important"
      );

    const highImpact =
      impacts.some(
        impact =>
          [
            "indexing_control",
            "link_discovery",
            "structured_data",
            "content_retrieval"
          ].includes(
            impact
          )
      );

    actions.push({
      priority:
        important &&
        highImpact
          ? "high"
          : important
            ? "medium"
            : "review",
      area:
        "Rendering",
      test:
        `DOM difference #${id}`,
      action:
        results[0]
          ?.rationale ||
        "Review the server/rendered difference.",
      basis:
        results
          .map(
            result =>
              `${result.provider}: ${humanLabel(result.judgement)} · ${humanLabel(result.impact)}`
          )
          .join(" · "),
      state:
        "Model review"
    });
  }

  const seenUrlActions =
    new Set();

  for (
    const entry
    of report.urlConsistency ||
    []
  ) {
    for (
      const finding
      of entry.result
        ?.findings ||
      []
    ) {
      if (
        finding.judgement ===
        "likely_correct"
      ) {
        continue;
      }

      const key =
        [
          finding.source,
          finding.value,
          finding.suggested_value
        ].join("|");

      if (
        seenUrlActions.has(
          key
        )
      ) {
        continue;
      }

      seenUrlActions.add(
        key
      );

      actions.push({
        priority:
          finding.judgement ===
          "likely_incorrect"
            ? (
                [
                  "canonical",
                  "cross_signal"
                ].includes(
                  finding.source
                )
                  ? "high"
                  : "medium"
              )
            : "review",
        area:
          "URL / locale",
        test:
          humanLabel(
            finding.source
          ),
        action:
          finding.rationale ||
          "Review this URL or locale declaration.",
        basis:
          finding.suggested_value
            ? `Current: ${finding.value || "(empty)"} · Suggested: ${finding.suggested_value}`
            : finding.value ||
              entry.result
                ?.summary ||
              "",
        state:
          "Model review"
      });
    }
  }

  for (
    const result
    of report.linkResponses
      ?.results ||
    []
  ) {
    if (
      result.error
    ) {
      actions.push({
        priority:
          "review",
        area:
          "Link response",
        test:
          "Request failed",
        action:
          result.requestedUrl,
        basis:
          result.error,
        state:
          "Manual check"
      });

      continue;
    }

    if (
      Number(result.status) >=
      500 ||
      [404, 410].includes(
        Number(result.status)
      )
    ) {
      actions.push({
        priority:
          "high",
        area:
          "Link response",
        test:
          `HTTP ${result.status}`,
        action:
          result.requestedUrl,
        basis:
          result.finalUrl &&
          result.finalUrl !==
            result.requestedUrl
            ? `Resolved to ${result.finalUrl}`
            : "Final response is not successful.",
        state:
          "Manual check"
      });

      continue;
    }

    if (
      Number(result.status) >=
      400
    ) {
      actions.push({
        priority:
          "medium",
        area:
          "Link response",
        test:
          `HTTP ${result.status}`,
        action:
          result.requestedUrl,
        basis:
          "Final response is a client error.",
        state:
          "Manual check"
      });

      continue;
    }

    if (
      result.redirected
    ) {
      actions.push({
        priority:
          "low",
        area:
          "Link response",
        test:
          "Redirect",
        action:
          result.requestedUrl,
        basis:
          `Final URL: ${result.finalUrl}`,
        state:
          "Manual check"
      });
    }
  }

  return actions.sort(
    (a, b) =>
      priorityRank(
        a.priority
      ) -
        priorityRank(
          b.priority
        ) ||
      a.area.localeCompare(
        b.area
      )
  );
}

function actionSummaryDetails(report) {
  const actions =
    buildActionRows(
      report
    );

  const details =
    document.createElement(
      "details"
    );

  details.className =
    "card analyse-result-group action-summary";

  details.open =
    true;

  const modelOutputs =
    [
      ...(report.pageType || []),
      ...(report.intent || []),
      ...(report.alignment || []),
      ...(report.links || []),
      ...(report.falsePositives || []),
      ...(report.domDiff?.assessments || []),
      ...(report.urlConsistency || [])
    ];

  const testsRun =
    (
      report.deterministic
        ?.checks
        ?.length ||
      0
    ) +
    modelOutputs.length +
    (
      report.linkResponses
        ?.results
        ?.length ||
      0
    );

  details.innerHTML = `
    <summary>
      <span>Prioritised actions</span>
      <span class="summary-count">${actions.length}</span>
    </summary>
    <div class="analyse-group-body">
      <div class="metric-row">
        ${metricHtml("Tests/results", testsRun)}
        ${metricHtml("Actions", actions.length)}
        ${metricHtml("High", actions.filter(action => action.priority === "high").length)}
        ${metricHtml("Review", actions.filter(action => action.priority === "review").length)}
      </div>
      ${actions.length
        ? `
          <div class="action-table-wrap">
            <table class="action-table">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Area / test</th>
                  <th>Action</th>
                  <th>Basis</th>
                </tr>
              </thead>
              <tbody>
                ${actions
                  .map(
                    action =>
                      `<tr>
                        <td>${priorityBadgeHtml(action.priority)}</td>
                        <td><strong>${escapeHtml(action.area)}</strong><div class="muted small">${escapeHtml(action.test)}</div></td>
                        <td>${escapeHtml(action.action)}</td>
                        <td><div class="small">${escapeHtml(action.basis || action.state || "")}</div></td>
                      </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `
        : '<div class="empty-state good-state">No actions were generated from the checks and model reviews in this run.</div>'}
      <div class="muted small" style="margin-top:8px">
        Priority is calculated from the technical check/impact and model judgement where available. Descriptive model outputs do not create actions by themselves.
      </div>
    </div>
  `;

  return details;
}

function linkResponseResultsHtml(data) {
  if (
    !data?.results?.length
  ) {
    return '<div class="empty-state">No link response checks have been run.</div>';
  }

  const summary =
    data.summary ||
    {};

  return `
    <div class="card">
      <div class="metric-row">
        ${metricHtml("Checked", summary.checked || 0)}
        ${metricHtml("OK", summary.ok || 0)}
        ${metricHtml("Redirected", summary.redirected || 0)}
        ${metricHtml("4xx", summary.clientErrors || 0)}
        ${metricHtml("5xx", summary.serverErrors || 0)}
        ${metricHtml("Errors", summary.requestErrors || 0)}
      </div>
      <details class="subdetails">
        <summary>Show checked URLs</summary>
        <div class="action-table-wrap" style="margin-top:8px">
          <table class="action-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Requested URL</th>
                <th>Final URL</th>
              </tr>
            </thead>
            <tbody>
              ${data.results
                .map(
                  result =>
                    `<tr>
                      <td>${result.error ? badgeHtml("error", "bad") : badgeHtml(result.status, result.ok ? "good" : "bad")}</td>
                      <td><code>${escapeHtml(result.requestedUrl || "")}</code></td>
                      <td>
                        <code>${escapeHtml(result.finalUrl || result.error || "")}</code>
                        ${result.redirected ? '<div class="muted small">Redirected</div>' : ""}
                      </td>
                    </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  `;
}


function deterministicResultDetails(data, open = true) {
  const details = document.createElement("details"); details.className = "card analyse-result-group"; details.open = open;
  const checks = data?.checks || []; const findings = checks.filter(x => x.status === "finding"); const passes = checks.filter(x => x.status === "pass"); const linkStats = data?.linkStats || {}; const imageStats = data?.imageStats || {};
  details.innerHTML = `<summary><span>Deterministic checks</span><span class="summary-count">${checks.length}</span></summary><div class="analyse-group-body"><div class="metric-row">${metricHtml("Checks",checks.length)}${metricHtml("Passed",passes.length)}${metricHtml("Findings",findings.length)}${metricHtml("Links",linkStats.totalAnchors ?? 0)}${metricHtml("Images",imageStats.total ?? data?.imageCount ?? 0)}</div><div class="result-subsection"><div class="result-label">Findings</div><div class="finding-list">${findings.map(issue => `<div class="finding-row"><div><div class="finding-title">${escapeHtml(humanLabel(issue.code))}</div><div class="muted small">${escapeHtml(issue.message || "")}</div></div>${badgeHtml("finding","bad")}</div>`).join("") || '<div class="empty-state good-state">No deterministic findings.</div>'}</div></div><details class="subdetails"><summary>Passed checks (${passes.length})</summary><div class="finding-list">${passes.map(check => `<div class="finding-row compact"><div><div class="finding-title">${escapeHtml(humanLabel(check.code))}</div><div class="muted small">${escapeHtml(check.message || "")}</div></div>${badgeHtml("pass","good")}</div>`).join("")}</div></details>${rawJsonDetails(data)}</div>`;
  return details;
}

function analyseConfigDetails(config = {}, skipped = []) {
  const details = document.createElement("details"); details.className = "card analyse-result-group";
  details.innerHTML = `<summary>Analyse all configuration</summary><div class="analyse-group-body"><div class="chip-row">${Object.entries(config).map(([key,enabled]) => `<span class="mini-chip ${enabled ? "enabled" : "disabled"}">${escapeHtml(humanLabel(key))}: ${enabled ? "on" : "off"}</span>`).join("")}</div>${skipped.length ? `<div class="result-subsection"><div class="result-label">Skipped</div><ul class="evidence-list">${skipped.map(item => `<li><strong>${escapeHtml(humanLabel(item.stage))}:</strong> ${escapeHtml(item.reason)}</li>`).join("")}</ul></div>` : ""}</div>`;
  return details;
}

function domDiffResultDetails(data) {
  const details = document.createElement("details"); details.className = "card analyse-result-group"; details.open = (data?.assessments?.length || 0) > 0;
  const summary = data?.summary || {};
  details.innerHTML = `<summary><span>Server HTML ↔ rendered DOM</span>${data?.enabled ? badgeHtml("enabled","neutral") : badgeHtml("off","neutral")}</summary><div class="analyse-group-body">${!data?.enabled ? '<div class="empty-state">Skipped for this Analyse all run. Enable it in Config when you specifically want a rendering comparison.</div>' : `<div class="metric-row">${metricHtml("Differences",summary.totalDiffItems ?? 0)}${metricHtml("Retained",summary.returnedDiffItems ?? 0)}${metricHtml("Dropped",summary.droppedByCap ?? 0)}</div>`}<div data-dom-assessments></div>${rawJsonDetails(data)}</div>`;
  const target = details.querySelector("[data-dom-assessments]");
  for (const assessment of data?.assessments || []) {
    if (assessment.error) { const error = document.createElement("div"); error.className = "card result-card error-card"; error.innerHTML = `<div class="result-copy">${escapeHtml(assessment.error)}</div>`; target.appendChild(error); }
    else target.appendChild(providerCard("dom_diff_triage", assessment.provider, assessment.result || {}, assessment.batch ? `batch ${assessment.batch}` : null));
  }
  return details;
}

async function runAcross(task, payload, target, mode = null) {
  const providers = enabledProviders();

  if (!providers.length) {
    throw new Error("Choose at least one model.");
  }

  if (!analysisRun?.id) {
    throw new Error("Read this page to start a new analysis run.");
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
        providerCard(task, provider, result, mode)
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

async function ensureFullSnapshot() {
  if (
    snapshot &&
    !snapshot._summaryOnly
  ) {
    return snapshot;
  }

  const fullSnapshot =
    await sw({
      type:
        "GET_CURRENT_SNAPSHOT"
    });

  if (!fullSnapshot) {
    throw new Error(
      "No page snapshot is available. Read this page first."
    );
  }

  snapshot =
    fullSnapshot;

  domDiff =
    snapshot.domDiff ||
    domDiff ||
    null;

  return snapshot;
}

async function runModeTask(task) {
  if (!snapshot) {
    return setStatus("Read the page first.", true);
  }

  await ensureFullSnapshot();

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
  const code =
    issue?.code || "";

  const base = {
    url:
      snapshot.url,
    pathname:
      (() => {
        try {
          return new URL(
            snapshot.url
          ).pathname;
        } catch {
          return "";
        }
      })(),
    title:
      snapshot.title,
    metaDescription:
      snapshot.metaDescription,
    canonical:
      snapshot.canonical,
    robots:
      snapshot.robots,
    h1s:
      snapshot.h1s || [],
    schemaTypes:
      snapshot.schemaTypes || [],
    deterministicEvidence:
      issue?.deterministicValue ?? null
  };

  const pagePurpose = {
    title:
      snapshot.title,
    metaDescription:
      snapshot.metaDescription,
    h1s:
      snapshot.h1s || [],
    h2s:
      (snapshot.h2s || []).slice(0, 8),
    schemaTypes:
      snapshot.schemaTypes || [],
    buttons:
      (snapshot.buttons || []).slice(0, 15),
    structuralSignals:
      snapshot.structuredDigest
        ?.structuralSignals || {},
    mainTextExcerpt:
      (
        snapshot.structuredDigest
          ?.mainTextExcerpt ||
        snapshot.bodyText ||
        ""
      ).slice(0, 3000)
  };

  const urlIdentity = {
    currentUrl:
      snapshot.url,
    canonicals:
      snapshot.canonicals || [],
    urlSignals:
      effectiveUrlSignals(),
    socialMeta:
      snapshot.socialMeta || {}
  };

  const contexts = {
    h1_presence: {
      ...base,
      pagePurpose,
      headings:
        (snapshot.headingDetails || [])
          .slice(0, 30)
    },

    multiple_h1: {
      ...base,
      pagePurpose,
      headings:
        (snapshot.headingDetails || [])
          .filter(
            h =>
              h.tag === "h1"
          )
          .slice(0, 20)
    },

    title_presence: {
      ...base,
      pagePurpose,
      indexabilitySignals: {
        robots:
          snapshot.robots,
        canonicals:
          snapshot.canonicals || []
      }
    },

    title_length: {
      ...base,
      pagePurpose
    },

    meta_description_presence: {
      ...base,
      pagePurpose,
      indexabilitySignals: {
        robots:
          snapshot.robots,
        canonicals:
          snapshot.canonicals || []
      }
    },

    meta_description_length: {
      ...base,
      pagePurpose
    },

    canonical_presence: {
      ...base,
      pagePurpose,
      urlIdentity,
      queryString:
        (() => {
          try {
            return new URL(
              snapshot.url
            ).search;
          } catch {
            return "";
          }
        })()
    },

    multiple_canonical: {
      ...base,
      urlIdentity
    },

    canonical_cross_origin: {
      ...base,
      urlIdentity
    },

    canonical_fragment: {
      ...base,
      urlIdentity
    },

    canonical_protocol_downgrade: {
      ...base,
      urlIdentity
    },

    robots_noindex: {
      ...base,
      pagePurpose,
      robotsMetaValues:
        snapshot.robotsMetaValues || [],
      urlIdentity
    },

    robots_conflict: {
      ...base,
      robotsMetaValues:
        snapshot.robotsMetaValues || [],
      pagePurpose
    },

    images_missing_alt: {
      ...base,
      imageEvidence: {
        total:
          snapshot.imageStats?.total || 0,
        affected:
          snapshot.imageStats?.missingAlt || 0,
        examples:
          snapshot.imageStats
            ?.missingAltExamples || []
      }
    },

    images_empty_alt: {
      ...base,
      imageEvidence: {
        total:
          snapshot.imageStats?.total || 0,
        affected:
          snapshot.imageStats?.emptyAlt || 0,
        examples:
          snapshot.imageStats
            ?.emptyAltExamples || []
      }
    },

    images_missing_dimensions: {
      ...base,
      imageEvidence: {
        total:
          snapshot.imageStats?.total || 0,
        affected:
          snapshot.imageStats
            ?.missingDimensions || 0,
        examples:
          snapshot.imageStats
            ?.missingDimensionExamples || []
      }
    },

    heading_hierarchy: {
      ...base,
      pagePurpose,
      headings:
        (snapshot.headingDetails || [])
          .slice(0, 40)
    },

    html_lang_presence: {
      ...base,
      htmlLang:
        snapshot.htmlLang || "",
      urlIdentity
    },

    html_lang_format: {
      ...base,
      htmlLang:
        snapshot.htmlLang || "",
      urlIdentity
    },

    jsonld_parse_error: {
      ...base,
      schemaTypes:
        snapshot.schemaTypes || [],
      schemaParseErrors:
        snapshot.schemaParseErrors || []
    },

    hreflang_duplicate_value: {
      ...base,
      urlIdentity
    },

    hreflang_unapproved_value: {
      ...base,
      urlIdentity
    },

    hreflang_invalid_format: {
      ...base,
      urlIdentity
    },

    hreflang_empty_href: {
      ...base,
      urlIdentity
    },

    open_graph_incomplete: {
      ...base,
      urlIdentity
    },

    og_url_mismatch: {
      ...base,
      urlIdentity
    },

    twitter_card_incomplete: {
      ...base,
      socialMeta:
        snapshot.socialMeta || {}
    },

    favicon_presence: {
      ...base,
      socialMeta:
        snapshot.socialMeta || {}
    },

    links_empty_anchor: {
      ...base,
      linkEvidence: {
        stats: {
          totalAnchors:
            snapshot.linkStats
              ?.totalAnchors || 0,
          internal:
            snapshot.linkStats
              ?.internal || 0,
          external:
            snapshot.linkStats
              ?.external || 0,
          emptyAnchor:
            snapshot.linkStats
              ?.emptyAnchor || 0
        }
      }
    },

    internal_http_links: {
      ...base,
      linkEvidence: {
        stats:
          snapshot.linkStats || {},
        examples:
          Array.isArray(
            issue?.deterministicValue
          )
            ? issue.deterministicValue
            : []
      }
    },

    viewport_presence: {
      ...base,
      viewport:
        snapshot.viewport || "",
      pagePurpose
    }
  };

  return (
    contexts[code] || {
      ...base,
      pagePurpose,
      urlIdentity,
      linkStats:
        snapshot.linkStats || {},
      imageStats:
        snapshot.imageStats || {}
    }
  );
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
    `${checks.length} automated checks run · ` +
    `${passes.length} passed · ` +
    `${findings.length} finding(s) need context review`;

  if (!findings.length) {
    box.innerHTML =
      '<div class="card"><strong>No findings to triage on this page.</strong>' +
      '<div class="muted small">The automated checks did not flag anything that needs review. ' +
      'Passed checks are still recorded in this run.</div></div>';
    return;
  }

  findings.forEach((issue, i) => {
    const d = document.createElement("div");
    d.className = "issue";

    d.innerHTML =
      `<div class="issue-head">` +
        `<div>` +
          `<strong>${escapeHtml(humanLabel(issue.code))}</strong>` +
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
        await ensureFullSnapshot();

        const fullIssue =
          (snapshot.auditChecks || [])
            .find(
              x =>
                x.code ===
                issue.code &&
                x.status ===
                "finding"
            ) ||
          issue;

        await runAcross(
          "false_positive",
          {
            issue:
              fullIssue,
            context:
              pageContextForIssue(
                fullIssue
              )
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
        await ensureFullSnapshot();

        const fullIssue =
          (snapshot.auditChecks || [])
            .find(
              x =>
                x.code ===
                issue.code &&
                x.status ===
                "finding"
            ) ||
          issue;

        await createJiraTicket({
          issue:
            fullIssue,
          context:
            pageContextForIssue(
              fullIssue
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
      "No server/rendered comparison has been run yet.";
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
    `${summary.totalDiffItems ?? 0} net semantic difference(s)` +
    `${summary.nanoReviewItems != null ? ` · ${summary.nanoReviewItems} Nano-review exception(s)` : ""}` +
    `${summary.deterministicLowImpactItems != null ? ` · ${summary.deterministicLowImpactItems} deterministic low-impact` : ""}` +
    `${summary.sourceDiffItems != null ? ` · ${summary.sourceDiffItems} source-level add/remove item(s)` : ""}` +
    `${summary.reconciledPairs ? ` · ${summary.reconciledPairs} pair(s) reconciled` : ""}` +
    ` · ${summary.returnedDiffItems ?? 0} retained` +
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
      '<div class="card"><span class="muted">Read the page to review URL and locale signals.</span></div>';
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
          ? '<div class="muted small">Using URL/canonical data from an earlier page read. Read the page again to refresh hreflang, schema URL references and mobile annotations.</div>'
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

  const rawPacked =
    item.raw &&
    typeof item.raw === "object"
      ? item.raw
      : {text: item.raw || ""};

  const renderedPacked =
    item.rendered &&
    typeof item.rendered === "object"
      ? item.rendered
      : {text: item.rendered || ""};

  const rawText =
    rawPacked.text ||
    rawPacked.href ||
    String(item.raw || "");

  const renderedText =
    renderedPacked.text ||
    renderedPacked.href ||
    String(item.rendered || "");

  const valueHtml =
    item.change_type === "changed_in_rendered"
      ? (
          `<div class="small"><strong>Server:</strong></div>` +
          `<pre>${escapeHtml(rawText)}</pre>` +
          `<div class="small"><strong>Rendered:</strong></div>` +
          `<pre>${escapeHtml(renderedText)}</pre>` +
          (
            item.reconciliation
              ? `<div class="muted small">Reconciled pair · ${escapeHtml(item.reconciliation.reason || "matched")} · score ${escapeHtml(item.reconciliation.score ?? "")}</div>`
              : ""
          )
        )
      : `<pre>${escapeHtml(text)}</pre>`;

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
    ${item.net_effect ? `<div class="small"><strong>Deterministic net effect:</strong> ${escapeHtml(item.net_effect.significance || "unknown")} · ${escapeHtml(item.net_effect.reason || "")}</div>` : ""}
    ${item.nano_review === false ? '<div class="muted small">Resolved deterministically · Nano review skipped</div>' : ""}
    ${valueHtml}
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


function domJudgementSummaryHtml(judgements = []) {
  if (!judgements.length) {
    return '<span class="muted small">Not reviewed by a model</span>';
  }

  const primary =
    judgements[0];

  return [
    badgeHtml(
      primary.judgement
    ),
    badgeHtml(
      primary.impact,
      "neutral"
    ),
    confidenceHtml(
      primary.confidence
    ),
    judgements.length > 1
      ? `<span class="muted small">+${judgements.length - 1} more model result${judgements.length === 2 ? "" : "s"}</span>`
      : ""
  ].join("");
}

function domDiffJoinedAccordion(
  item,
  judgements = []
) {
  const details =
    document.createElement(
      "details"
    );

  details.className =
    "card dom-diff-joined";

  const headlineText =
    item.rendered?.text ||
    item.rendered?.href ||
    item.raw?.text ||
    item.raw?.href ||
    "";

  const summary =
    document.createElement(
      "summary"
    );

  summary.className =
    "dom-diff-joined-summary";

  summary.innerHTML = `
    <div class="dom-diff-summary-main">
      <div class="finding-title">
        <span class="muted">#${escapeHtml(item.id)}</span>
        · ${escapeHtml(humanLabel(item.kind))}
        · ${escapeHtml(humanLabel(item.change_type))}
      </div>
      ${headlineText
        ? `<div class="muted small dom-diff-preview">${escapeHtml(String(headlineText).slice(0, 180))}</div>`
        : ""}
    </div>
    <div class="dom-diff-summary-verdict">
      ${domJudgementSummaryHtml(judgements)}
    </div>
  `;

  details.appendChild(
    summary
  );

  const body =
    document.createElement(
      "div"
    );

  body.className =
    "dom-diff-joined-body";

  const evidence =
    domDiffItemCard(
      item
    );

  evidence.classList.add(
    "dom-diff-evidence-card"
  );

  body.appendChild(
    evidence
  );

  const modelSection =
    document.createElement(
      "div"
    );

  modelSection.className =
    "dom-diff-model-results";

  modelSection.innerHTML =
    '<div class="result-label">Model review</div>';

  if (!judgements.length) {
    modelSection.insertAdjacentHTML(
      "beforeend",
      '<div class="empty-state">This difference has not been reviewed by a model yet.</div>'
    );
  } else {
    for (
      const judgement
      of judgements
    ) {
      const row =
        document.createElement(
          "div"
        );

      row.className =
        "result-row static dom-diff-model-result";

      row.innerHTML = `
        <div class="result-row-head">
          <strong>${escapeHtml(humanLabel(judgement.provider || "model"))}</strong>
          <div class="result-primary">
            ${badgeHtml(judgement.judgement)}
            ${badgeHtml(judgement.impact, "neutral")}
            ${confidenceHtml(judgement.confidence)}
          </div>
        </div>
        <div class="result-copy">${escapeHtml(judgement.rationale || "")}</div>
      `;

      modelSection.appendChild(
        row
      );
    }
  }

  body.appendChild(
    modelSection
  );

  details.appendChild(
    body
  );

  return details;
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
      "Read the page first."
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
  details.innerHTML = `<summary>${escapeHtml(title)}</summary><div class="analyse-group-body">${genericResultHtml(value)}${rawJsonDetails(value)}</div>`;
  return details;
}

function renderAnalyseAllResults(report) {
  const target = $("#analyseAllResults");
  if (!target) return;

  target.innerHTML = "";

  const summary = document.createElement("div");
  summary.className = "card analyse-results-summary";
  summary.innerHTML = `
    <div class="result-card-head">
      <div>
        <h3>Complete analysis</h3>
        <div class="muted small">${escapeHtml(report.url || "")}</div>
      </div>
      ${report.errors.length ? badgeHtml(`${report.errors.length} error${report.errors.length === 1 ? "" : "s"}`, "bad") : badgeHtml("complete", "good")}
    </div>
    <div class="metric-row" style="margin-top:10px">
      ${metricHtml("Model calls", `${report.completedCalls}/${report.totalCalls}`)}
      ${metricHtml("Findings", report.deterministic?.findings?.length || 0)}
      ${metricHtml("Providers", report.providers.length)}
      ${metricHtml("Modes", report.modes.length)}
    </div>
    <div class="result-label">Providers</div>
    ${chipsHtml(report.providers)}
    <div class="result-label" style="margin-top:8px">Input modes</div>
    ${chipsHtml(report.modes)}
  `;
  target.appendChild(summary);

  target.appendChild(
    actionSummaryDetails(
      report
    )
  );

  target.appendChild(
    analyseConfigDetails(
      report.analyseAllConfig,
      report.skipped || []
    )
  );

  target.appendChild(
    deterministicResultDetails(
      report.deterministic,
      true
    )
  );

  target.appendChild(
    analyseTaskDetails(
      "Page type",
      report.pageType,
      "page_type"
    )
  );

  target.appendChild(
    analyseTaskDetails(
      "Intent",
      report.intent,
      "intent"
    )
  );

  target.appendChild(
    analyseTaskDetails(
      "Page type ↔ intent alignment",
      report.alignment,
      "alignment"
    )
  );

  target.appendChild(
    analyseTaskDetails(
      "Link context",
      report.links,
      "link_group"
    )
  );

  const fp = analyseTaskDetails(
    "False-positive triage",
    report.falsePositives,
    "false_positive",
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
    domDiffResultDetails(
      report.domDiff
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
    const box =
      document.createElement(
        "div"
      );

    box.className =
      "card";

    box.innerHTML =
      "<h3>DOM differences needing attention</h3>" +
      '<div class="muted small">Open a difference to review the evidence and model judgement together.</div>';

    domIssues.forEach(
      item => {
        const judgements =
          domJudgements.get(
            item.id
          ) || [];

        box.appendChild(
          domDiffJoinedAccordion(
            item,
            judgements
          )
        );
      }
    );

    target.appendChild(
      box
    );
  }

  target.appendChild(
    analyseTaskDetails(
      "URL identity & locale consistency",
      report.urlConsistency,
      "url_consistency",
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
    setStatus("Choose at least one model.", true);
    return;
  }

  const cfg = {
    linkContext:
      settings.analyseAll?.linkContext !== false,
    pageType:
      settings.analyseAll?.pageType !== false,
    intent:
      settings.analyseAll?.intent !== false,
    alignment:
      settings.analyseAll?.alignment !== false,
    triageFindings:
      settings.analyseAll?.triageFindings !== false,
    domDiff:
      settings.analyseAll?.domDiff === true,
    urlConsistency:
      settings.analyseAll?.urlConsistency !== false
  };

  const runAlignment =
    cfg.alignment &&
    cfg.pageType &&
    cfg.intent;

  analyseAllRunning = true;

  const button =
    $("#analyseAllBtn");

  if (button) {
    button.disabled = true;
  }

  clearAnalysisOutput();
  setStatus("");
  setAnalyseAllProgress(
    2,
    "Reading the page and starting a new analysis…"
  );

  try {
    const ctx =
      await sw({
        type:
          "CAPTURE"
      });

    snapshot =
      ctx.snapshot;

    analysisRun =
      ctx.analysisRun;

    linkCursor = 0;
    domDiffCursor = 0;
    domDiff = null;

    resetTaskResultState();
    updatePageMeta();
    renderPassedChecks();

    let domDiffError = null;

    if (cfg.domDiff) {
      setAnalyseAllProgress(
        5,
        "Comparing server HTML with the rendered page…"
      );

      try {
        domDiff =
          await sw({
            type:
              "BUILD_DOM_DIFF"
          });

        snapshot.domDiff =
          domDiff;
      } catch (e) {
        domDiffError =
          e?.message ||
          String(e);

        domDiff = null;
      }
    }

    const modes =
      modesToRun();

    const findings =
      (snapshot.auditChecks || [])
        .filter(
          x =>
            x.status ===
            "finding"
        );

    const linkPool =
      cfg.linkContext
        ? (snapshot.links || [])
            .slice(
              0,
              settings
                .limits
                .maxLinksForClassification
            )
        : [];

    const linkBatchSize =
      Math.max(
        1,
        settings
          .limits
          .linkBatchSize ||
          8
      );

    const linkBatches = [];

    for (
      let i = 0;
      i < linkPool.length;
      i += linkBatchSize
    ) {
      linkBatches.push(
        linkPool.slice(
          i,
          i + linkBatchSize
        )
      );
    }

    const diffItems =
      cfg.domDiff
        ? (
            domDiff?.items ||
            []
          )
        : [];

    const diffReviewItems =
      diffItems.filter(
        item =>
          item.nano_review !==
          false
      );

    const diffBatchSize =
      Math.max(
        1,
        settings
          .limits
          .domDiffBatchSize ||
          6
      );

    const diffBatches = [];

    for (
      let i = 0;
      i < diffReviewItems.length;
      i += diffBatchSize
    ) {
      diffBatches.push(
        diffReviewItems.slice(
          i,
          i + diffBatchSize
        )
      );
    }

    const callsPerProvider =
      (
        cfg.linkContext
          ? linkBatches.length
          : 0
      ) +
      (
        cfg.pageType
          ? modes.length
          : 0
      ) +
      (
        cfg.intent
          ? modes.length
          : 0
      ) +
      (
        runAlignment
          ? modes.length
          : 0
      ) +
      (
        cfg.triageFindings
          ? findings.length
          : 0
      ) +
      (
        cfg.domDiff
          ? diffBatches.length
          : 0
      ) +
      (
        cfg.urlConsistency
          ? 1
          : 0
      );

    const totalCalls =
      Math.max(
        1,
        providers.length *
          callsPerProvider
      );

    let completedCalls = 0;

    const report = {
      url:
        snapshot.url,

      providers:
        [...providers],

      modes:
        [...modes],

      analyseAllConfig:
        {
          ...cfg,
          alignment:
            runAlignment
        },

      totalCalls,
      completedCalls: 0,

      deterministic: {
        checks:
          snapshot.auditChecks ||
          [],
        findings,
        urlSignals:
          effectiveUrlSignals(),
        headingDetails:
          snapshot.headingDetails ||
          [],
        linkStats:
          snapshot.linkStats ||
          {},
        imageStats:
          snapshot.imageStats ||
          {},
        socialMeta:
          snapshot.socialMeta ||
          {},
        schemaParseErrors:
          snapshot.schemaParseErrors ||
          []
      },

      links: [],
      pageType: [],
      intent: [],
      alignment: [],
      falsePositives: [],

      domDiff: {
        enabled:
          cfg.domDiff,
        summary:
          domDiff?.summary ||
          null,
        caveat:
          domDiff?.caveat ||
          null,
        items:
          diffItems,
        assessments: []
      },

      urlConsistency: [],
      linkResponses:
        snapshot.linkResponseChecks ||
        null,
      errors: [],
      skipped: []
    };

    if (
      cfg.alignment &&
      !runAlignment
    ) {
      report.skipped.push({
        stage:
          "alignment",
        reason:
          "Alignment requires both Page type and Intent to be enabled."
      });
    }

    if (!cfg.linkContext) {
      report.skipped.push({
        stage:
          "link_context",
        reason:
          "Disabled in Analyse all config."
      });
    }

    if (!cfg.pageType) {
      report.skipped.push({
        stage:
          "page_type",
        reason:
          "Disabled in Analyse all config."
      });
    }

    if (!cfg.intent) {
      report.skipped.push({
        stage:
          "intent",
        reason:
          "Disabled in Analyse all config."
      });
    }

    if (!cfg.triageFindings) {
      report.skipped.push({
        stage:
          "false_positive",
        reason:
          "Disabled in Analyse all config."
      });
    }

    if (!cfg.domDiff) {
      report.skipped.push({
        stage:
          "dom_diff",
        reason:
          "Disabled in Analyse all config."
      });
    }

    if (!cfg.urlConsistency) {
      report.skipped.push({
        stage:
          "url_consistency",
        reason:
          "Disabled in Analyse all config."
      });
    }

    if (domDiffError) {
      report.errors.push({
        stage:
          "build_dom_diff",
        error:
          domDiffError
      });
    }

    const bump = label => {
      completedCalls += 1;
      report.completedCalls =
        completedCalls;

      const percent =
        callsPerProvider
          ? 8 +
            (
              (
                completedCalls /
                totalCalls
              ) *
              90
            )
          : 98;

      setAnalyseAllProgress(
        percent,
        `${label} · ${completedCalls}/${totalCalls} model calls`
      );
    };

    if (cfg.linkContext) {
      for (
        let batchIndex = 0;
        batchIndex <
          linkBatches.length;
        batchIndex += 1
      ) {
        const batch =
          linkBatches[
            batchIndex
          ].map(
            l => ({
              id:
                l.id,
              href:
                l.href,
              internal:
                l.internal,
              anchor:
                l.anchor,
              rel:
                l.rel,
              zone:
                l.zone,
              context:
                l.context
            })
          );

        for (
          const provider
          of providers
        ) {
          const call =
            await runTaskSilent(
              "link_group",
              provider,
              {
                links:
                  batch
              }
            );

          report.links.push({
            batch:
              batchIndex + 1,
            provider,
            inputCount:
              batch.length,
            result:
              call.ok
                ? withoutMeta(
                    call.result
                  )
                : null,
            error:
              call.ok
                ? null
                : call.error
          });

          if (!call.ok) {
            report.errors.push({
              stage:
                "link_group",
              batch:
                batchIndex + 1,
              provider,
              error:
                call.error
            });
          }

          bump(
            `Links · batch ${batchIndex + 1}/${linkBatches.length} · ${provider}`
          );
        }
      }
    }

    if (cfg.pageType) {
      for (
        const mode
        of modes
      ) {
        for (
          const provider
          of providers
        ) {
          const call =
            await runTaskSilent(
              "page_type",
              provider,
              {
                snapshot
              },
              mode
            );

          report.pageType.push({
            mode,
            provider,
            result:
              call.ok
                ? withoutMeta(
                    call.result
                  )
                : null,
            error:
              call.ok
                ? null
                : call.error
          });

          if (!call.ok) {
            report.errors.push({
              stage:
                "page_type",
              mode,
              provider,
              error:
                call.error
            });
          }

          bump(
            `Page type · ${mode} · ${provider}`
          );
        }
      }
    }

    if (cfg.intent) {
      for (
        const mode
        of modes
      ) {
        for (
          const provider
          of providers
        ) {
          const call =
            await runTaskSilent(
              "intent",
              provider,
              {
                snapshot
              },
              mode
            );

          report.intent.push({
            mode,
            provider,
            result:
              call.ok
                ? withoutMeta(
                    call.result
                  )
                : null,
            error:
              call.ok
                ? null
                : call.error
          });

          if (!call.ok) {
            report.errors.push({
              stage:
                "intent",
              mode,
              provider,
              error:
                call.error
            });
          }

          bump(
            `Intent · ${mode} · ${provider}`
          );
        }
      }
    }

    if (runAlignment) {
      for (
        const mode
        of modes
      ) {
        for (
          const provider
          of providers
        ) {
          const pageTypeResult =
            taskResults
              .page_type
              ?.[mode]
              ?.[provider];

          const intentResult =
            taskResults
              .intent
              ?.[mode]
              ?.[provider];

          if (
            !pageTypeResult ||
            !intentResult
          ) {
            const error =
              "Page type and/or intent result unavailable for alignment.";

            report.alignment.push({
              mode,
              provider,
              result:
                null,
              error
            });

            report.errors.push({
              stage:
                "alignment",
              mode,
              provider,
              error
            });

            bump(
              `Alignment · ${mode} · ${provider}`
            );

            continue;
          }

          const call =
            await runTaskSilent(
              "alignment",
              provider,
              {
                snapshot,
                pageTypeResult,
                intentResult
              },
              mode
            );

          report.alignment.push({
            mode,
            provider,
            result:
              call.ok
                ? withoutMeta(
                    call.result
                  )
                : null,
            error:
              call.ok
                ? null
                : call.error
          });

          if (!call.ok) {
            report.errors.push({
              stage:
                "alignment",
              mode,
              provider,
              error:
                call.error
            });
          }

          bump(
            `Alignment · ${mode} · ${provider}`
          );
        }
      }
    }

    if (cfg.triageFindings) {
      for (
        const issue
        of findings
      ) {
        for (
          const provider
          of providers
        ) {
          const call =
            await runTaskSilent(
              "false_positive",
              provider,
              {
                issue,
                context:
                  pageContextForIssue(
                    issue
                  )
              }
            );

          report.falsePositives.push({
            issue: {
              code:
                issue.code,
              message:
                issue.message
            },
            provider,
            result:
              call.ok
                ? withoutMeta(
                    call.result
                  )
                : null,
            error:
              call.ok
                ? null
                : call.error
          });

          if (!call.ok) {
            report.errors.push({
              stage:
                "false_positive",
              issue:
                issue.code,
              provider,
              error:
                call.error
            });
          }

          bump(
            `Finding · ${issue.code} · ${provider}`
          );
        }
      }
    }

    if (cfg.domDiff) {
      for (
        let batchIndex = 0;
        batchIndex <
          diffBatches.length;
        batchIndex += 1
      ) {
        const batch =
          diffBatches[
            batchIndex
          ];

        for (
          const provider
          of providers
        ) {
          const call =
            await runTaskSilent(
              "dom_diff_triage",
              provider,
              {
                items:
                  batch
              }
            );

          report
            .domDiff
            .assessments
            .push({
              batch:
                batchIndex + 1,
              provider,
              itemIds:
                batch.map(
                  x => x.id
                ),
              result:
                call.ok
                  ? withoutMeta(
                      call.result
                    )
                  : null,
              error:
                call.ok
                  ? null
                  : call.error
            });

          if (!call.ok) {
            report.errors.push({
              stage:
                "dom_diff_triage",
              batch:
                batchIndex + 1,
              provider,
              error:
                call.error
            });
          }

          bump(
            `DOM diff · batch ${batchIndex + 1}/${diffBatches.length} · ${provider}`
          );
        }
      }
    }

    if (cfg.urlConsistency) {
      const urlSignals =
        effectiveUrlSignals();

      for (
        const provider
        of providers
      ) {
        const call =
          await runTaskSilent(
            "url_consistency",
            provider,
            {
              urlSignals
            }
          );

        report
          .urlConsistency
          .push({
            provider,
            result:
              call.ok
                ? withoutMeta(
                    call.result
                  )
                : null,
            error:
              call.ok
                ? null
                : call.error
          });

        if (!call.ok) {
          report.errors.push({
            stage:
              "url_consistency",
            provider,
            error:
              call.error
          });
        }

        bump(
          `URL & locale consistency · ${provider}`
        );
      }
    }

    renderIssues();
    renderDomDiffSummary();
    renderUrlSignals();
    renderPassedChecks();

    lastAnalyseAllReport =
      report;

    renderAnalyseAllResults(
      report
    );

    setAnalyseAllProgress(
      100,
      `Complete · ${completedCalls}/${totalCalls} model calls · ${report.errors.length} error(s)`
    );

    setStatus("");
  } catch (e) {
    setAnalyseAllProgress(
      100,
      `Stopped: ${e?.message || String(e)}`
    );

    setStatus(
      e?.message ||
      String(e),
      true
    );
  } finally {
    analyseAllRunning =
      false;

    if (button) {
      button.disabled =
        false;
    }
  }
}

async function load() {
  settings = await sw({type: "GET_SETTINGS"});
  renderProviders();

  const ctx = await sw({type: "GET_LAST_CONTEXT"});

  snapshot = ctx?.snapshot || null;
  analysisRun = ctx?.analysisRun || null;
  domDiff =
    snapshot?.domDiff ||
    null;
  domDiffCursor = 0;

  updatePageMeta();
  renderIssues();
  renderDomDiffSummary();
  renderUrlSignals();
  renderPassedChecks();

  if (
    snapshot?.linkResponseSummary
  ) {
    try {
      await ensureFullSnapshot();

      if (
        snapshot?.linkResponseChecks
      ) {
        $("#linkResponseResults")
          .innerHTML =
            linkResponseResultsHtml(
              snapshot.linkResponseChecks
            );
      }
    } catch {}
  }
}

$("#analyseAllBtn").onclick = async () => {
  await analyseAll();
};

$("#captureBtn").onclick = async () => {
  setStatus("Reading this page and starting a new run…");

  try {
    const ctx = await sw({type: "CAPTURE"});

    snapshot = ctx.snapshot;
    analysisRun = ctx.analysisRun;
    linkCursor = 0;
    domDiffCursor = 0;
    domDiff = null;
    lastAnalyseAllReport =
      null;

    for (const task of Object.keys(taskResults)) {
      taskResults[task] = {};
    }

    updatePageMeta();
    renderIssues();
    renderDomDiffSummary();
    renderUrlSignals();
    renderPassedChecks();

    const linkResponseResult =
      $("#linkResponseResults");

    if (linkResponseResult) {
      linkResponseResult.innerHTML =
        "";
    }

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
    return setStatus("Read the page first.", true);
  }

  try {
    await ensureFullSnapshot();
  } catch (e) {
    return setStatus(
      e?.message || String(e),
      true
    );
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
          `<pre>Run page type and intent for this model first, then check alignment.</pre>`;

        target.appendChild(d);
        continue;
      }

      setStatus(
        `Checking page type ↔ intent alignment · ${mode} · ${provider}…`
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
          providerCard("alignment", provider, result, mode)
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
    return setStatus("Read the page first.", true);
  }

  try {
    await ensureFullSnapshot();
  } catch (e) {
    return setStatus(
      e?.message || String(e),
      true
    );
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
    `Reviewing links ${Math.max(1, linkCursor - batch.length + 1)}` +
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


$("#checkLinkResponsesBtn").onclick =
  async () => {
    if (!snapshot) {
      return setStatus(
        "Read the page first.",
        true
      );
    }

    try {
      await ensureFullSnapshot();

      const urls =
        [
          ...new Set(
            (
              snapshot.links ||
              []
            )
              .map(
                link =>
                  link.href
              )
              .filter(
                href =>
                  /^https?:\/\//i.test(
                    href || ""
                  )
              )
          )
        ]
          .slice(
            0,
            settings.limits
              .maxLinkResponseChecks ||
              100
          );

      if (!urls.length) {
        return setStatus(
          "No HTTP(S) links were found to check.",
          true
        );
      }

      const origins =
        [
          ...new Set(
            urls.map(
              href => {
                try {
                  return `${new URL(href).origin}/*`;
                } catch {
                  return null;
                }
              }
            )
              .filter(Boolean)
          )
        ];

      const granted =
        await chrome.permissions
          .request({
            origins
          });

      if (!granted) {
        return setStatus(
          "Link response checking needs temporary access to the link origins on this page.",
          true
        );
      }

      const button =
        $("#checkLinkResponsesBtn");

      button.disabled =
        true;

      setStatus(
        `Checking ${urls.length} unique link destination${urls.length === 1 ? "" : "s"}…`
      );

      const result =
        await sw({
          type:
            "CHECK_LINK_RESPONSES",
          urls
        });

      snapshot.linkResponseChecks =
        result;

      $("#linkResponseResults")
        .innerHTML =
          linkResponseResultsHtml(
            result
          );

      if (
        lastAnalyseAllReport
      ) {
        lastAnalyseAllReport
          .linkResponses =
            result;

        renderAnalyseAllResults(
          lastAnalyseAllReport
        );
      }

      setStatus("");
    } catch (e) {
      setStatus(
        e?.message ||
        String(e),
        true
      );
    } finally {
      const button =
        $("#checkLinkResponsesBtn");

      if (button) {
        button.disabled =
          false;
      }
    }
  };


$("#buildDomDiffBtn").onclick =
  async () => {
    if (!snapshot) {
      return setStatus(
        "Read the page first.",
        true
      );
    }

    setStatus(
      "Comparing server HTML with the rendered page…"
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
        "Read the page first.",
        true
      );
    }

    try {
      await ensureFullSnapshot();
    } catch (e) {
      return setStatus(
        e?.message || String(e),
        true
      );
    }

    domDiff =
      snapshot.domDiff ||
      domDiff;

    if (!domDiff?.items?.length) {
      return setStatus(
        "Run the server/rendered comparison first.",
        true
      );
    }

    const reviewItems =
      domDiff.items.filter(
        item =>
          item.nano_review !==
          false
      );

    if (!reviewItems.length) {
      return setStatus(
        "All heading and link changes were resolved by the automated checks. There is nothing left for Nano to review.",
        false
      );
    }

    const batchSize =
      settings
        .limits
        .domDiffBatchSize ||
      6;

    if (
      domDiffCursor >=
      reviewItems.length
    ) {
      domDiffCursor = 0;
    }

    const batch =
      reviewItems.slice(
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
      `Reviewing exceptions ${Math.max(1, domDiffCursor - batch.length + 1)}–${domDiffCursor} of ${reviewItems.length} (${domDiff.items.length} total changes found).`;

    target.appendChild(
      batchLabel
    );

    try {
      const providers =
        enabledProviders();

      if (!providers.length) {
        throw new Error(
          "Choose at least one model."
        );
      }

      const judgementMap =
        new Map(
          batch.map(
            item => [
              item.id,
              []
            ]
          )
        );

      for (
        const provider
        of providers
      ) {
        setStatus(
          `Reviewing DOM differences · ${provider}…`
        );

        const result =
          await sw({
            type:
              "RUN_TASK",
            task:
              "dom_diff_triage",
            provider,
            analysisRunId:
              analysisRun.id,
            payload: {
              items:
                batch
            },
            useCache:
              $("#useCache")
                .checked
          });

        taskResults
          .dom_diff_triage[
            provider
          ] = result;

        for (
          const judgement
          of result.results || []
        ) {
          if (
            !judgementMap.has(
              judgement.id
            )
          ) {
            judgementMap.set(
              judgement.id,
              []
            );
          }

          judgementMap
            .get(
              judgement.id
            )
            .push({
              provider,
              ...judgement
            });
        }
      }

      for (
        const item
        of batch
      ) {
        target.appendChild(
          domDiffJoinedAccordion(
            item,
            judgementMap.get(
              item.id
            ) || []
          )
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


$("#reviewUrlSignalsBtn").onclick =
  async () => {
    if (!snapshot) {
      return setStatus(
        "Read the page first.",
        true
      );
    }

    const urlSignals =
      effectiveUrlSignals();

    if (!urlSignals) {
      return setStatus(
        "Read the page first.",
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
          "Choose at least one model."
        );
      }

      for (const provider of providers) {
        setStatus(
          `Reviewing URL and locale signals · ${provider}…`
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
            "url_consistency",
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
