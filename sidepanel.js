
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
  dom_diff_summary: {},
  url_consistency: {},
  jira_ticket: {}
};

let linkCursor = 0;
let domDiff = null;
const domDiffBatchReviews =
  new Map();
let analyseAllRunning = false;
let linkClassificationRunning = false;
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


function setMainTab(
  tabId
) {
  document
    .querySelectorAll(
      "[data-main-tab]"
    )
    .forEach(
      button => {
        const active =
          button.dataset
            .mainTab ===
          tabId;

        button.classList
          .toggle(
            "active",
            active
          );

        button.setAttribute(
          "aria-selected",
          active
            ? "true"
            : "false"
        );

        button.tabIndex =
          active
            ? 0
            : -1;
      }
    );

  document
    .querySelectorAll(
      "[data-main-panel]"
    )
    .forEach(
      panel => {
        const active =
          panel.dataset
            .mainPanel ===
          tabId;

        panel.classList
          .toggle(
            "active",
            active
          );

        panel.hidden =
          !active;
      }
    );

  try {
    sessionStorage.setItem(
      "nanoSeoMainTab",
      tabId
    );
  } catch {}
}

function bindMainTabs() {
  document
    .querySelectorAll(
      "[data-main-tab]"
    )
    .forEach(
      button => {
        button.onclick =
          () =>
            setMainTab(
              button.dataset
                .mainTab
            );

        button.onkeydown =
          event => {
            if (
              ![
                "ArrowLeft",
                "ArrowRight",
                "Home",
                "End"
              ].includes(
                event.key
              )
            ) {
              return;
            }

            event.preventDefault();

            const tabs =
              [
                ...document.querySelectorAll(
                  "[data-main-tab]"
                )
              ];

            const currentIndex =
              tabs.indexOf(
                button
              );

            let nextIndex =
              currentIndex;

            if (
              event.key ===
              "ArrowRight"
            ) {
              nextIndex =
                (
                  currentIndex +
                  1
                ) %
                tabs.length;
            } else if (
              event.key ===
              "ArrowLeft"
            ) {
              nextIndex =
                (
                  currentIndex -
                  1 +
                  tabs.length
                ) %
                tabs.length;
            } else if (
              event.key ===
              "Home"
            ) {
              nextIndex = 0;
            } else if (
              event.key ===
              "End"
            ) {
              nextIndex =
                tabs.length -
                1;
            }

            const next =
              tabs[
                nextIndex
              ];

            setMainTab(
              next.dataset
                .mainTab
            );

            next.focus();
          };
      }
    );

  let initial =
    "overview";

  try {
    const saved =
      sessionStorage.getItem(
        "nanoSeoMainTab"
      );

    if (
      saved &&
      document.querySelector(
        `[data-main-panel="${saved}"]`
      )
    ) {
      initial =
        saved;
    }
  } catch {}

  setMainTab(
    initial
  );
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
  const pageMeta =
    $("#pageMeta");

  if (!snapshot) {
    pageMeta.textContent =
      "No page read yet.";
  } else if (
    !snapshot.url
  ) {
    pageMeta.textContent =
      "Previous page read available.";
  } else {
    pageMeta.innerHTML =
      `<span class="page-meta-title">${escapeHtml(snapshot.title || "(untitled)")}</span><span class="page-meta-separator">·</span><span class="page-meta-url" title="${escapeHtml(snapshot.url)}">${escapeHtml(snapshot.url)}</span>`;
  }

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

function copyIconHtml(label = "Copy result") {
  return `<button class="copy-icon" type="button" data-copy-result title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">⧉</button>`;
}

function resultCopyText(
  value,
  depth = 0
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "";
  }

  if (
    typeof value ===
    "string"
  ) {
    return value;
  }

  if (
    typeof value ===
      "number" ||
    typeof value ===
      "boolean"
  ) {
    return String(
      value
    );
  }

  if (
    Array.isArray(
      value
    )
  ) {
    if (
      !value.length
    ) {
      return "None";
    }

    const primitiveOnly =
      value.every(
        item =>
          item === null ||
          [
            "string",
            "number",
            "boolean"
          ].includes(
            typeof item
          )
      );

    if (
      primitiveOnly
    ) {
      return value
        .map(
          item =>
            `- ${resultCopyText(item, depth + 1)}`
        )
        .join("\n");
    }

    return value
      .map(
        (item, index) => {
          const rendered =
            resultCopyText(
              item,
              depth + 1
            );

          return `${index + 1}. ${rendered.replace(/\n/g, "\n   ")}`;
        }
      )
      .join("\n\n");
  }

  if (
    typeof value ===
    "object"
  ) {
    return Object.entries(
      value
    )
      .filter(
        ([key, item]) =>
          !key.startsWith(
            "_"
          ) &&
          item !== null &&
          item !== undefined &&
          item !== "" &&
          !(
            Array.isArray(
              item
            ) &&
            item.length ===
              0
          )
      )
      .map(
        ([key, item]) => {
          const label =
            humanLabel(
              key
            );

          const rendered =
            resultCopyText(
              item,
              depth + 1
            );

          if (
            typeof item ===
              "object" &&
            item !== null
          ) {
            return `${label}:\n${rendered.split("\n").map(line => `  ${line}`).join("\n")}`;
          }

          return `${label}: ${rendered}`;
        }
      )
      .join("\n");
  }

  return String(
    value
  );
}

function bindCopyButton(
  root,
  value,
  message = "Copied."
) {
  const button =
    root?.querySelector(
      "[data-copy-result]"
    );

  if (!button) return;

  button.onclick =
    async event => {
      event.preventDefault();
      event.stopPropagation();

      await navigator.clipboard
        .writeText(
          resultCopyText(
            value
          )
        );

      const original =
        button.textContent;

      button.textContent =
        "✓";

      setTimeout(
        () => {
          button.textContent =
            original;
        },
        900
      );

      setStatus(
        message
      );

      setTimeout(
        () =>
          setStatus(""),
        1200
      );
    };
}

function cleanClipboardCell(
  value
) {
  return String(
    value ||
    ""
  )
    .replace(
      /\s*\n\s*/g,
      " "
    )
    .replace(
      /\t/g,
      " "
    )
    .replace(
      /\s{2,}/g,
      " "
    )
    .trim();
}

function tableToTsv(
  table
) {
  if (!table) {
    return "";
  }

  const rows =
    [
      ...table.querySelectorAll(
        "tr"
      )
    ];

  return rows
    .map(
      row =>
        [
          ...row.querySelectorAll(
            ":scope > th, :scope > td"
          )
        ]
          .map(
            cell =>
              cleanClipboardCell(
                cell.innerText ||
                cell.textContent ||
                ""
              )
          )
          .join(
            "\t"
          )
    )
    .filter(Boolean)
    .join(
      "\n"
    );
}

function copyableTextFromElement(
  element
) {
  const tables =
    [
      ...element.querySelectorAll(
        "table"
      )
    ];

  if (
    tables.length
  ) {
    return tables
      .map(
        table =>
          tableToTsv(
            table
          )
      )
      .filter(Boolean)
      .join(
        "\n\n"
      );
  }

  const clone =
    element.cloneNode(
      true
    );

  clone
    .querySelectorAll(
      "button,summary"
    )
    .forEach(
      node =>
        node.remove()
    );

  return (
    clone.innerText ||
    clone.textContent ||
    ""
  )
    .replace(
      /\n{3,}/g,
      "\n\n"
    )
    .trim();
}

function decorateCopyableOutputs(
  root = document
) {
  const selectors = [
    ".result-card",
    ".issue",
    "#linkResponseResults > .card",
    "#indexabilityResults > .card",
    "#urlSignalSummary > .card",
    ".provider-ticket > .card",
    ".action-summary"
  ];

  root
    .querySelectorAll(
      selectors.join(",")
    )
    .forEach(
      element => {
        const isFindingFollowup =
          element.classList.contains(
            "finding-followup-row"
          );

        if (
          element
            .querySelector(
              isFindingFollowup
                ? ".finding-followup-copy > .finding-followup-copy-icon"
                : ":scope > .copy-icon-float"
            )
        ) {
          return;
        }

        const button =
          document
            .createElement(
              "button"
            );

        button.type =
          "button";

        button.className =
          isFindingFollowup
            ? "copy-icon finding-followup-copy-icon"
            : "copy-icon copy-icon-float";

        button.title =
          "Copy output";

        button.setAttribute(
          "aria-label",
          "Copy output"
        );

        button.textContent =
          "⧉";

        button.onclick =
          async event => {
            event.preventDefault();
            event.stopPropagation();

            await navigator.clipboard
              .writeText(
                copyableTextFromElement(
                  element
                )
              );

            button.textContent =
              "✓";

            setTimeout(
              () =>
                button.textContent =
                  "⧉",
              900
            );
          };

        const copyTarget =
          isFindingFollowup
            ? element.querySelector(
                ".finding-followup-copy"
              ) || element
            : element;

        copyTarget.appendChild(
          button
        );
      }
    );
}

const copyOutputObserver =
  new MutationObserver(
    mutations => {
      for (
        const mutation
        of mutations
      ) {
        for (
          const node
          of mutation.addedNodes
        ) {
          if (
            node.nodeType ===
            Node.ELEMENT_NODE
          ) {
            decorateCopyableOutputs(
              node.matches?.(
                ".result-card,.issue,.card,.action-summary"
              )
                ? node.parentElement ||
                  node
                : node
            );
          }
        }
      }
    }
  );

copyOutputObserver.observe(
  document.documentElement,
  {
    childList:
      true,
    subtree:
      true
  }
);


function humanLabel(value) {
  const displayLabels = {
    likely_false_positive:
      "Likely detector error",
    no_material_impact:
      "Real condition · no material impact",
    low_impact:
      "Real condition · low impact",
    context_dependent:
      "Context dependent",
    meaningful_issue:
      "Meaningful issue",
    manual_review:
      "Manual review"
  };

  const key =
    String(value ?? "")
      .toLowerCase();

  if (displayLabels[key]) {
    return displayLabels[key];
  }

  return String(value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}


function truncateLabel(value, max = 48) {
  const text =
    String(
      value ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();

  if (
    text.length <= max
  ) {
    return text;
  }

  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function linkInputMap(
  links = []
) {
  return new Map(
    (
      links ||
      []
    ).map(
      link => [
        String(link.id),
        link
      ]
    )
  );
}

function linkResultName(
  result,
  links = []
) {
  const input =
    linkInputMap(
      links
    ).get(
      String(
        result?.id
      )
    ) ||
    {};

  const anchor =
    truncateLabel(
      input.anchor ||
      input.text ||
      input.href ||
      "(empty anchor)"
    );

  const location =
    humanLabel(
      input.zone ||
      "unknown location"
    );

  const category =
    humanLabel(
      result?.category ||
      "uncategorised"
    );

  return {
    anchor,
    location,
    category,
    href:
      input.href ||
      "",
    id:
      result?.id
  };
}

function clampBatchSize(
  value,
  fallback
) {
  const parsed =
    Number.parseInt(
      value,
      10
    );

  if (
    !Number.isFinite(parsed)
  ) {
    return fallback;
  }

  return Math.max(
    1,
    Math.min(
      100,
      parsed
    )
  );
}

function setBatchInputs(
  ids,
  value
) {
  for (
    const id
    of ids
  ) {
    const input =
      document.querySelector(
        id
      );

    if (input) {
      input.value =
        String(value);
    }
  }
}

function runtimeLinkBatchSize() {
  const input =
    $("#analyseLinkBatchSize") ||
    $("#linkBatchSize");

  return clampBatchSize(
    input?.value,
    settings?.limits
      ?.linkBatchSize ||
      8
  );
}

function runtimeDomBatchSize() {
  const input =
    $("#analyseDomBatchSize") ||
    $("#domDiffBatchSize");

  return clampBatchSize(
    input?.value,
    settings?.limits
      ?.domDiffBatchSize ||
      6
  );
}


function runtimeFindingBatchSize() {
  const input =
    $("#analyseFindingBatchSize") ||
    $("#findingBatchSize");

  return clampBatchSize(
    input?.value,
    settings?.limits
      ?.findingBatchSize ||
      5
  );
}

function findingEvidenceItems(issue) {
  const value =
    issue?.deterministicValue;

  if (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(value) &&
    Array.isArray(
      value.examples
    )
  ) {
    return {
      kind:
        "examples_object",
      items:
        value.examples
    };
  }

  if (
    Array.isArray(value)
  ) {
    return {
      kind:
        "array",
      items:
        value
    };
  }

  return {
    kind:
      "single",
    items:
      []
  };
}

function findingReviewBatches(
  issue,
  batchSize =
    runtimeFindingBatchSize()
) {
  const source =
    findingEvidenceItems(
      issue
    );

  if (
    source.kind ===
      "single" ||
    !source.items.length
  ) {
    return [
      {
        issue,
        batch:
          1,
        batchCount:
          1,
        itemStart:
          null,
        itemEnd:
          null,
        itemCount:
          0,
        totalItems:
          0
      }
    ];
  }

  const batches = [];

  for (
    let start = 0;
    start <
      source.items.length;
    start +=
      batchSize
  ) {
    const items =
      source.items.slice(
        start,
        start +
          batchSize
      );

    const deterministicValue =
      source.kind ===
        "examples_object"
        ? {
            ...issue
              .deterministicValue,
            examples:
              items,
            examples_sent:
              items.length,
            examples_total:
              issue
                .deterministicValue
                ?.count ??
              source.items.length
          }
        : items;

    batches.push({
      issue: {
        ...issue,
        deterministicValue
      },
      batch:
        batches.length +
        1,
      batchCount:
        Math.ceil(
          source.items.length /
          batchSize
        ),
      itemStart:
        start + 1,
      itemEnd:
        start +
        items.length,
      itemCount:
        items.length,
      totalItems:
        source.items.length
    });
  }

  return batches;
}

function initialiseBatchControls() {
  const linkDefault =
    clampBatchSize(
      settings?.limits
        ?.linkBatchSize,
      8
    );

  const domDefault =
    clampBatchSize(
      settings?.limits
        ?.domDiffBatchSize,
      6
    );

  const findingDefault =
    clampBatchSize(
      settings?.limits
        ?.findingBatchSize,
      5
    );

  setBatchInputs(
    [
      "#analyseLinkBatchSize",
      "#linkBatchSize"
    ],
    linkDefault
  );

  setBatchInputs(
    [
      "#analyseDomBatchSize",
      "#domDiffBatchSize"
    ],
    domDefault
  );

  setBatchInputs(
    [
      "#analyseFindingBatchSize",
      "#findingBatchSize"
    ],
    findingDefault
  );

  const bindGroup =
    (
      ids,
      fallback
    ) => {
      for (
        const id
        of ids
      ) {
        const input =
          document.querySelector(
            id
          );

        if (!input) {
          continue;
        }

        input.addEventListener(
          "input",
          () => {
            const value =
              clampBatchSize(
                input.value,
                fallback
              );

            setBatchInputs(
              ids,
              value
            );
          }
        );
      }
    };

  bindGroup(
    [
      "#analyseLinkBatchSize",
      "#linkBatchSize"
    ],
    linkDefault
  );

  bindGroup(
    [
      "#analyseDomBatchSize",
      "#domDiffBatchSize"
    ],
    domDefault
  );

  for (
    const id
    of [
      "#analyseDomBatchSize",
      "#domDiffBatchSize"
    ]
  ) {
    document
      .querySelector(id)
      ?.addEventListener(
        "input",
        () => {
          if (domDiff) {
            renderDomDiffBatches();
          }
        }
      );
  }

  bindGroup(
    [
      "#analyseFindingBatchSize",
      "#findingBatchSize"
    ],
    findingDefault
  );
}

function toneForValue(value) {
  const v = String(value ?? "").toLowerCase();
  if (["strong","likely_consistent","likely_correct","likely_false_positive","no_material_impact","pass","probably_harmless"].includes(v)) return "good";
  if (["weak","likely_incorrect","meaningful_issue","finding","likely_important","error"].includes(v)) return "bad";
  if (["partial","mostly_consistent","needs_review","context_dependent","manual_review","mixed","unclear"].includes(v)) return "warn";
  if (["low_impact"].includes(v)) return "neutral";
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

function securityForResult(
  result
) {
  return result?._meta
    ?.security ||
    result?._security ||
    null;
}

function securityWarningHtml(
  security
) {
  const scan =
    security?.injectionScan;

  if (
    !scan?.detected
  ) {
    return "";
  }

  const matches =
    scan.matches ||
    [];

  return `
    <details class="security-warning">
      <summary>
        Potential prompt injection · ${escapeHtml(scan.count)} signal${scan.count === 1 ? "" : "s"}
      </summary>
      <div class="security-warning-body">
        <div class="small">
          Instruction-like text was present in untrusted evidence sent to this model. The evidence was not removed or changed.
        </div>
        ${matches.length
          ? `<div class="security-match-list">${matches
              .map(
                match =>
                  `<div class="security-match">
                    <div class="muted small">${escapeHtml(humanLabel(match.rule))} · ${escapeHtml(match.path)}</div>
                    <div class="small">${escapeHtml(match.excerpt || "")}</div>
                  </div>`
              )
              .join("")}</div>`
          : ""}
      </div>
    </details>
  `;
}
function rawJsonDetails(value) {
  return `<details class="raw-json"><summary>Raw JSON</summary><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></details>`;
}

function metricHtml(
  label,
  value,
  help = ""
) {
  const helpHtml =
    help
      ? `<details class="metric-help">
          <summary aria-label="${escapeHtml(`About ${label}`)}">?</summary>
          <div class="metric-tooltip">${escapeHtml(help)}</div>
        </details>`
      : "";

  return `<div class="metric"><span class="metric-value">${escapeHtml(value ?? 0)}</span><span class="metric-label">${escapeHtml(label)}${helpHtml}</span></div>`;
}

function genericResultHtml(result) {
  if (!result || typeof result !== "object") return `<div class="result-copy">${escapeHtml(result ?? "")}</div>`;
  if (Array.isArray(result)) {
    return `<div class="result-list">${result.map(item => `<div class="result-row static">${genericResultHtml(item)}</div>`).join("") || '<div class="muted">No results.</div>'}</div>`;
  }
  const rows = Object.entries(result).filter(([key]) => !key.startsWith("_")).map(([key, value]) => {
    let rendered = "";
    if (Array.isArray(value)) rendered = value.length ? chipsHtml(value.map(item => typeof item === "string" ? item : JSON.stringify(item))) : '<span class="muted">None</span>';
    else if (value && typeof value === "object") rendered = `<code>${escapeHtml(JSON.stringify(value))}</code>`;
    else rendered = escapeHtml(value ?? "");
    return `<div class="result-kv-row"><div class="result-label">${escapeHtml(humanLabel(key))}</div><div>${rendered}</div></div>`;
  }).join("");
  return `<div class="result-kv">${rows || '<div class="muted">No result fields.</div>'}</div>`;
}

function falsePositiveBatchContextHtml(
  context
) {
  const issueCode =
    context?.issueCode ||
    "";

  const examples =
    Array.isArray(
      context?.examples
    )
      ? context.examples
      : [];

  if (
    ![
      "images_missing_alt",
      "images_empty_alt",
      "images_missing_dimensions"
    ].includes(
      issueCode
    ) ||
    !examples.length
  ) {
    return "";
  }

  const rows =
    examples
      .map(
        (item, index) => {
          const src =
            item?.src ||
            "";

          if (!src) {
            return "";
          }

          const linked =
            item?.link_href ||
            "";

          return `
            <div class="result-row static">
              <div class="result-row-head">
                <span class="mini-chip">Image ${index + 1}</span>
                ${item?.visible_on_page === false ? '<span class="mini-chip">not visible</span>' : ""}
              </div>
              <div class="result-kv-row compact">
                <div class="result-label">Image</div>
                <a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">
                  <code>${escapeHtml(src)}</code>
                </a>
              </div>
              ${linked
                ? `<div class="result-kv-row compact">
                    <div class="result-label">Linked to</div>
                    <a href="${escapeHtml(linked)}" target="_blank" rel="noopener noreferrer">
                      <code>${escapeHtml(linked)}</code>
                    </a>
                  </div>`
                : ""}
              ${item?.selector
                ? `<div class="result-kv-row compact">
                    <div class="result-label">Selector</div>
                    <code>${escapeHtml(item.selector)}</code>
                  </div>`
                : ""}
            </div>
          `;
        }
      )
      .filter(Boolean)
      .join("");

  return rows
    ? `<div class="result-subsection">
        <div class="result-label">Images in this batch</div>
        <div class="result-list">${rows}</div>
      </div>`
    : "";
}

function taskResultHtml(task, result, displayContext = null) {
  const r = withoutMeta(result) || {};
  if (task === "page_type") return `<div class="result-primary">${badgeHtml(r.page_type, "info")}${confidenceHtml(r.confidence)}</div>${evidenceHtml(r.evidence)}`;
  if (task === "intent") return `<div class="result-primary">${badgeHtml(r.primary_intent, "info")}${r.split_intent ? badgeHtml("split intent", "warn") : ""}${confidenceHtml(r.confidence)}</div><div class="result-grid two"><div><div class="result-label">Supporting intent</div>${chipsHtml(r.supporting_intents)}</div><div><div class="result-label">Independent secondary intent</div>${chipsHtml(r.secondary_intents)}</div></div>${evidenceHtml(r.evidence)}`;
  if (task === "alignment") return `<div class="result-primary">${badgeHtml(r.alignment)}${r.split_intent ? badgeHtml("split intent", "warn") : ""}${confidenceHtml(r.confidence)}</div>${r.mismatch_reason ? `<div class="result-subsection"><div class="result-label">Alignment rationale</div><div class="result-copy">${escapeHtml(r.mismatch_reason)}</div></div>` : ""}${evidenceHtml(r.notes, "Notes")}`;
  if (task === "false_positive") return `<div class="result-primary">${badgeHtml(r.judgement)}${confidenceHtml(r.confidence)}</div>${r.rationale ? `<div class="result-copy">${escapeHtml(r.rationale)}</div>` : ""}${falsePositiveBatchContextHtml(displayContext)}${evidenceHtml(r.evidence_used, "Evidence reviewed")}${(r.item_assessments || []).length ? `<div class="result-subsection"><div class="result-label">Affected items</div><div class="result-list">${r.item_assessments.map(item => `<div class="result-row static"><div class="result-row-head"><code>${escapeHtml(item.item || "")}</code>${badgeHtml(item.judgement)}</div><div class="result-copy">${escapeHtml(item.rationale || "")}</div></div>`).join("")}</div></div>` : ""}${evidenceHtml(r.useful_context, "Useful context")}`;
  if (task === "link_group") {
    const rows =
      r.results ||
      [];

    const counts = {};

    for (
      const row
      of rows
    ) {
      counts[row.category] =
        (
          counts[
            row.category
          ] ||
          0
        ) + 1;
    }

    const inputLinks =
      Array.isArray(
        displayContext
      )
        ? displayContext
        : displayContext?.links ||
          [];

    const responseMap =
      new Map(
        (
          displayContext
            ?.linkResponses ||
          []
        ).map(
          item => [
            String(
              item.requestedUrl ||
              ""
            ),
            item
          ]
        )
      );

    return `
      <div class="result-subsection">
        <div class="result-label">Categories in this batch</div>
        <div class="chip-row">
          ${Object.entries(counts)
            .map(
              ([category, count]) =>
                `<span class="mini-chip">${escapeHtml(humanLabel(category))} <strong>${count}</strong></span>`
            )
            .join("") ||
            '<span class="muted small">No links returned.</span>'}
        </div>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Anchor</th>
              <th>Destination</th>
              <th>Response</th>
              <th>Location</th>
              <th>Category</th>
              <th>Confidence</th>
              <th>Rationale</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                row => {
                  const label =
                    linkResultName(
                      row,
                      inputLinks
                    );

                  const response =
                    responseMap.get(
                      String(
                        label.href ||
                        ""
                      )
                    );

                  const responseHtml =
                    response
                      ? response.error
                        ? `${badgeHtml("error", "bad")}<div class="muted small">${escapeHtml(response.error)}</div>`
                        : `${badgeHtml(response.status, response.ok ? "good" : "bad")}${response.redirected ? `<div class="muted small">→ ${escapeHtml(response.finalUrl || "")}</div>` : ""}`
                      : '<span class="muted">Not checked</span>';

                  return `
                    <tr>
                      <td><code>#${escapeHtml(label.id)}</code></td>
                      <td>${escapeHtml(label.anchor || "(empty)")}</td>
                      <td class="table-url"><code title="${escapeHtml(label.href || "")}">${escapeHtml(label.href || "(none)")}</code></td>
                      <td>${responseHtml}</td>
                      <td>${escapeHtml(label.location || "")}</td>
                      <td>${badgeHtml(label.category || row.category, "neutral")}</td>
                      <td>${row.confidence != null ? escapeHtml(Math.round(Number(row.confidence) * 100) + "%") : "—"}</td>
                      <td>${escapeHtml(row.rationale || "")}</td>
                    </tr>
                  `;
                }
              )
              .join("") ||
              '<tr><td colspan="8" class="muted">No links returned.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }
  if (task === "dom_diff_triage") {
    const rows =
      r.results ||
      [];

    return `
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Judgement</th>
              <th>Impact</th>
              <th>Confidence</th>
              <th>Rationale</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                row =>
                  `<tr>
                    <td><code>#${escapeHtml(row.id)}</code></td>
                    <td>${badgeHtml(row.judgement)}</td>
                    <td>${badgeHtml(row.impact, "neutral")}</td>
                    <td>${row.confidence != null ? escapeHtml(Math.round(Number(row.confidence) * 100) + "%") : "—"}</td>
                    <td>${escapeHtml(row.rationale || "")}</td>
                  </tr>`
              )
              .join("") ||
              '<tr><td colspan="5" class="muted">No DOM differences returned.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }
  if (task === "url_consistency") {
    const findings = r.findings || [];
    return `<div class="result-primary">${badgeHtml(r.overall)}${confidenceHtml(r.confidence)}</div>${r.summary ? `<div class="result-copy">${escapeHtml(r.summary)}</div>` : ""}<div class="result-list">${findings.map(finding => `<div class="result-row static"><div class="result-row-head">${badgeHtml(finding.source,"neutral")}${badgeHtml(finding.judgement)}</div>${finding.value ? `<div class="result-kv-row compact"><div class="result-label">Value</div><code>${escapeHtml(finding.value)}</code></div>` : ""}${finding.suggested_value ? `<div class="result-kv-row compact"><div class="result-label">Suggested</div><code>${escapeHtml(finding.suggested_value)}</code></div>` : ""}<div class="result-copy">${escapeHtml(finding.rationale || "")}</div></div>`).join("") || '<div class="muted small">No individual findings.</div>'}</div>`;
  }
  return genericResultHtml(r);
}

function providerReviewLabel(
  provider,
  task
) {
  if (
    provider === "nano" &&
    task === "dom_diff_summary"
  ) {
    return "Nano summary";
  }

  return `${humanLabel(provider)} review`;
}

function providerCard(task, provider, result, mode = null, displayContext = null) {
  const d = document.createElement("div");
  d.className = "card result-card";

  const meta =
    result?._meta || {};

  const security =
    securityForResult(
      result
    );

  const clean =
    withoutMeta(
      result
    ) || {};

  delete clean._security;

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
    `<div class="result-card-head"><div><div class="result-provider">${escapeHtml(providerReviewLabel(provider, task))}</div><div class="result-meta">${context}${meta.cacheHit ? '<span class="mini-chip">Cache</span>' : ""}${meta.durationMs ? `<span>${escapeHtml(meta.durationMs)} ms total</span>` : ""}${timingChips}</div></div>${copyIconHtml("Copy this result")}</div>${securityWarningHtml(security)}<div class="result-body">${taskResultHtml(task, clean, displayContext)}</div>${rawJsonDetails(clean)}`;

  const table =
    d.querySelector(
      "table"
    );

  bindCopyButton(
    d,
    table
      ? tableToTsv(
          table
        )
      : {
          provider:
            humanLabel(
              provider
            ),
          task:
            humanLabel(
              task
            ),
          ...(mode
            ? {
                context:
                  humanLabel(
                    mode
                  )
              }
            : {}),
          result:
            clean
        },
    table
      ? "Table copied."
      : "Result copied."
  );

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
    body.appendChild(
      providerCard(
        task,
        entry.provider || "result",
        entry.result || {},
        context,
        task === "link_group"
          ? {
              links:
                entry.inputLinks ||
                [],
              linkResponses:
                entry.linkResponses ||
                []
            }
          : task ===
              "false_positive"
            ? {
                issueCode:
                  entry.issue
                    ?.code ||
                  "",
                examples:
                  entry.inputExamples ||
                  []
              }
            : null
      )
    );
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
  robots_googlebot_conflict: "high",
  rendered_head_invalid_element: "high",
  robots_noindex: "high",
  canonical_protocol_downgrade: "high",
  multiple_canonical: "high",
  canonical_fragment: "high",
  canonical_presence: "medium",
  canonical_cross_origin: "medium",
  canonical_relative_href: "medium",
  pagination_page1_parameter: "low",
  duplicate_title_element: "low",
  duplicate_meta_description: "low",
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

function deterministicTriageByCode(report) {
  const byCode =
    new Map();

  for (
    const entry
    of report.falsePositives ||
    []
  ) {
    const code =
      entry.issue?.code;

    if (
      !code ||
      !entry.result
    ) {
      continue;
    }

    if (
      !byCode.has(
        code
      )
    ) {
      byCode.set(
        code,
        []
      );
    }

    byCode
      .get(
        code
      )
      .push({
        provider:
          entry.provider,
        ...entry.result
      });
  }

  return byCode;
}

function deterministicImpactProfile(
  code
) {
  return (
    settings
      ?.deterministicImpactProfiles
      ?.[code] ||
    {
      impacts: [],
      baselinePriority:
        DETERMINISTIC_PRIORITY[
          code
        ] ||
        "medium",
      consequence: ""
    }
  );
}

function deterministicFindingDisposition(
  finding,
  report,
  triageMap =
    deterministicTriageByCode(
      report
    )
) {
  const reviews =
    triageMap.get(
      finding.code
    ) ||
    [];

  const judgements =
    reviews
      .map(
        review =>
          review.judgement
      )
      .filter(Boolean);

  const profile =
    deterministicImpactProfile(
      finding.code
    );

  const baseline =
    profile
      .baselinePriority ||
    DETERMINISTIC_PRIORITY[
      finding.code
    ] ||
    "medium";

  const unanimous =
    value =>
      judgements.length > 0 &&
      judgements.every(
        judgement =>
          judgement ===
          value
      );

  const mixed =
    judgements.length > 1 &&
    new Set(
      judgements
    ).size > 1;

  if (
    unanimous(
      "likely_false_positive"
    )
  ) {
    return {
      key:
        "likely_false_positive",
      label:
        "Likely detector error",
      tone:
        "good",
      actionRequired:
        false,
      priority:
        null,
      note:
        "Model review suggests the detector does not describe a real condition for the supplied evidence.",
      profile,
      reviews
    };
  }

  if (
    unanimous(
      "no_material_impact"
    )
  ) {
    return {
      key:
        "no_material_impact",
      label:
        "Real condition · no material impact",
      tone:
        "good",
      actionRequired:
        false,
      priority:
        null,
      note:
        "The condition appears real, but the model found no meaningful consequence on this page.",
      profile,
      reviews
    };
  }

  if (
    unanimous(
      "low_impact"
    )
  ) {
    return {
      key:
        "low_impact",
      label:
        "Real condition · low impact",
      tone:
        "neutral",
      actionRequired:
        true,
      priority:
        "low",
      note:
        "The condition appears real, but its practical consequence is limited.",
      profile,
      reviews
    };
  }

  if (
    unanimous(
      "meaningful_issue"
    )
  ) {
    return {
      key:
        "meaningful_issue",
      label:
        "Meaningful issue",
      tone:
        "bad",
      actionRequired:
        true,
      priority:
        baseline ===
          "context-dependent"
          ? "review"
          : baseline,
      note:
        "Model review supports the deterministic finding within its configured consequence profile.",
      profile,
      reviews
    };
  }

  if (
    unanimous(
      "context_dependent"
    ) ||
    unanimous(
      "manual_review"
    ) ||
    mixed ||
    reviews.length
  ) {
    return {
      key:
        "needs_review",
      label:
        "Manual review",
      tone:
        "warn",
      actionRequired:
        null,
      priority:
        "review",
      note:
        "Impact is context-dependent, evidence is insufficient, or selected providers do not fully agree.",
      profile,
      reviews
    };
  }

  return {
    key:
      "unreviewed",
    label:
      "Unreviewed",
    tone:
      "neutral",
    actionRequired:
      null,
    priority:
      baseline ===
        "context-dependent"
        ? "review"
        : baseline,
    note:
      "This deterministic finding has not been reviewed by a model.",
    profile,
    reviews
  };
}

function triageReviewSummary(
  reviews = []
) {
  if (
    !reviews.length
  ) {
    return "";
  }

  return reviews
    .map(
      review =>
        `${review.provider}: ${humanLabel(review.judgement)}${Number.isFinite(review.confidence) ? ` (${Math.round(review.confidence * 100)}%)` : ""}`
    )
    .join(" · ");
}

function buildActionRows(report) {
  const actions = [];

  const triageByCode =
    deterministicTriageByCode(
      report
    );

  for (
    const finding
    of report.deterministic
      ?.findings ||
    []
  ) {
    const disposition =
      deterministicFindingDisposition(
        finding,
        report,
        triageByCode
      );

    if (
      [
        "likely_false_positive",
        "no_material_impact"
      ].includes(
        disposition.key
      )
    ) {
      continue;
    }

    actions.push({
      priority:
        disposition.priority ||
        "review",
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
        triageReviewSummary(
          disposition.reviews
        ) ||
        "Automated finding; not model-reviewed",
      state:
        disposition.label
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
        !result.judgement ||
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
    const changeAreas =
      results.map(
        result =>
          result.change_area
      );

    const important =
      results.some(
        result =>
          result.judgement ===
          "likely_important"
      );

    const highImpact =
      changeAreas.some(
        area =>
          [
            "indexing_control",
            "structured_data",
            "content_retrieval"
          ].includes(
            area
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
              `${result.provider}: ${humanLabel(result.judgement)} · ${humanLabel(result.change_area)}`
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
    const finding
    of report.indexabilitySignals
      ?.findings ||
    []
  ) {
    if (
      finding.excludedBy
    ) {
      continue;
    }

    actions.push({
      priority:
        finding.severity === "review"
          ? "review"
          : finding.severity ||
            "medium",
      area:
        "Indexability signals",
      test:
        humanLabel(
          finding.code
        ),
      action:
        finding.message ||
        "Review the conflicting indexability signal.",
      basis:
        finding.evidence
          ? JSON.stringify(
              finding.evidence
            )
          : "Manual network check",
      state:
        "Manual network check"
    });
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
    ) +
    (
      report.indexabilitySignals
        ?.findings
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

function indexabilityResultsHtml(data) {
  if (!data) {
    return '<div class="empty-state">No HTTP / robots signal check has been run.</div>';
  }

  const current =
    data.current ||
    {};

  const robotsTxt =
    data.robotsTxt ||
    {};

  const headIntegrity =
    data.headIntegrity ||
    {};

  const canonicalTarget =
    data.canonicalTarget;

  const findings =
    data.findings ||
    [];

  const crawlerRows =
    robotsTxt.crawlers ||
    [];

  const affectedHead =
    headIntegrity.lost ||
    [];

  return `
    <div class="card">
      <div class="metric-row">
        ${metricHtml("Findings", findings.filter(item => !item.excludedBy).length)}
        ${metricHtml("Excluded", findings.filter(item => !!item.excludedBy).length)}
        ${metricHtml("High", findings.filter(item => !item.excludedBy && item.severity === "high").length)}
        ${metricHtml("HTTP", current.status ?? "—")}
        ${metricHtml("Robots", robotsTxt.allowed === null ? "unknown" : robotsTxt.allowed ? "allowed" : "blocked")}
      </div>

      <div class="result-kv">
        <div class="result-kv-row">
          <div class="result-label">Final page URL</div>
          <code>${escapeHtml(current.finalUrl || current.requestedUrl || "")}</code>
        </div>
        <div class="result-kv-row">
          <div class="result-label">X-Robots-Tag</div>
          <div>${escapeHtml(current.xRobotsTag || "(none)")}</div>
        </div>
        <div class="result-kv-row">
          <div class="result-label">HTTP canonical</div>
          <code>${escapeHtml((current.headerCanonicals || []).join(" | ") || "(none)")}</code>
        </div>
        <div class="result-kv-row">
          <div class="result-label">Server HTML canonical</div>
          <code>${escapeHtml((current.html?.canonicals || []).join(" | ") || "(none)")}</code>
        </div>
        <div class="result-kv-row">
          <div class="result-label">Rendered canonical</div>
          <code>${escapeHtml((data.rendered?.canonicals || []).join(" | ") || "(none)")}</code>
        </div>
        <div class="result-kv-row">
          <div class="result-label">robots.txt</div>
          <div>${escapeHtml(robotsTxt.allowed === null ? "Could not determine" : robotsTxt.allowed ? "Allowed for Googlebot" : "Blocked for Googlebot")}${robotsTxt.matchedRule ? ` · ${escapeHtml(robotsTxt.matchedRule.type)}: ${escapeHtml(robotsTxt.matchedRule.pattern)}` : ""}</div>
        </div>
        <div class="result-kv-row">
          <div class="result-label">Canonical target</div>
          <div>${canonicalTarget ? `${escapeHtml(canonicalTarget.status ?? "error")} · <code>${escapeHtml(canonicalTarget.finalUrl || canonicalTarget.requestedUrl || canonicalTarget.error || "")}</code>` : "Not checked"}</div>
        </div>
      </div>

      <div class="result-subsection">
        <div class="result-label">AI / dataset crawler robots access</div>
        ${crawlerRows.length
          ? `
            <div class="action-table-wrap" style="margin-top:6px">
              <table class="action-table crawler-access-table">
                <thead>
                  <tr>
                    <th>Agent / token</th>
                    <th>Purpose</th>
                    <th>Current URL</th>
                    <th>Matched as</th>
                    <th>Matched rule</th>
                  </tr>
                </thead>
                <tbody>
                  ${crawlerRows.map(
                    crawler =>
                      `<tr>
                        <td><strong>${escapeHtml(crawler.userAgent || "")}</strong><div class="muted small">${escapeHtml(crawler.label || "")}</div></td>
                        <td>${escapeHtml(humanLabel(crawler.category || ""))}</td>
                        <td>${badgeHtml(crawler.allowed ? "allowed" : "blocked", crawler.allowed ? "good" : "bad")}</td>
                        <td><code>${escapeHtml(crawler.matchedUserAgentToken || "*")}</code></td>
                        <td><code>${escapeHtml(crawler.matchedRule ? `${crawler.matchedRule.type}: ${crawler.matchedRule.pattern}` : "No matching rule")}</code></td>
                      </tr>`
                  ).join("")}
                </tbody>
              </table>
            </div>
            <div class="muted small" style="margin-top:6px">Google-Extended and Applebot-Extended are control tokens rather than standalone page-fetching crawlers. User-triggered agents are shown as a robots.txt rule evaluation, not a guarantee of runtime fetch behaviour.</div>
          `
          : '<div class="empty-state">Crawler-specific access could not be evaluated from robots.txt.</div>'}
      </div>

      <div class="result-subsection">
        <div class="result-label">Source &lt;head&gt; integrity</div>
        <div class="small">${escapeHtml(headIntegrity.message || "Not checked")}</div>
        ${headIntegrity.likelyBreak
          ? `<div class="finding-row compact" style="margin-top:6px">
              <div>
                <div class="finding-title">Likely parser break: &lt;${escapeHtml(headIntegrity.likelyBreak.tag || "")}&gt;</div>
                <code>${escapeHtml(headIntegrity.likelyBreak.excerpt || "")}</code>
              </div>
              ${badgeHtml(affectedHead.length ? "metadata at risk" : "review", affectedHead.length ? "bad" : "warn")}
            </div>`
          : ""}
        ${affectedHead.length
          ? `
            <div class="small" style="margin-top:8px"><strong>Metadata after the likely break (${affectedHead.length})</strong></div>
            <div class="finding-list">
              ${affectedHead.map(
                item =>
                  `<div class="finding-row compact">
                    <div>
                      <div class="finding-title">${escapeHtml(humanLabel(item.kind || item.tag || "metadata"))}</div>
                      <div class="muted small">${escapeHtml(item.value || item.excerpt || "")}</div>
                    </div>
                    ${badgeHtml("may be displaced", "bad")}
                  </div>`
              ).join("")}
            </div>
          `
          : headIntegrity.likelyBreak
            ? '<div class="muted small" style="margin-top:6px">No SEO-critical declarations were detected after the likely break point.</div>'
            : ""}
      </div>

      <div class="result-subsection">
        <div class="result-label">Conflicts / findings</div>
        <div class="finding-list">
          ${findings.length
            ? findings.map(
                finding =>
                  `<div class="finding-row compact">
                    <div>
                      <div class="finding-title">${escapeHtml(humanLabel(finding.code))}</div>
                      <div class="muted small">${escapeHtml(finding.message || "")}${finding.excludedBy?.note ? ` · ${escapeHtml(finding.excludedBy.note)}` : ""}</div>
                    </div>
                    ${finding.excludedBy
                      ? badgeHtml("excluded", "neutral")
                      : priorityBadgeHtml(finding.severity === "review" ? "review" : finding.severity || "medium")}
                  </div>`
              ).join("")
            : '<div class="empty-state good-state">No conflicts detected across the checked signals.</div>'}
        </div>
      </div>
    </div>
  `;
}


function deterministicResultDetails(data, open = true) {
  const details =
    document.createElement(
      "details"
    );

  details.className =
    "card analyse-result-group";

  details.open =
    open;

  const checks =
    data?.checks ||
    [];

  const findings =
    checks.filter(
      x =>
        x.status ===
        "finding"
    );

  const passes =
    checks.filter(
      x =>
        x.status ===
        "pass"
    );

  const excluded =
    checks.filter(
      x =>
        x.status ===
        "excluded"
    );

  const linkStats =
    data?.linkStats ||
    {};

  const imageStats =
    data?.imageStats ||
    {};

  details.innerHTML = `
    <summary>
      <span>Deterministic checks</span>
      <span class="summary-count">${checks.length}</span>
    </summary>
    <div class="analyse-group-body">
      <div class="metric-row">
        ${metricHtml("Checks", checks.length)}
        ${metricHtml("Passed", passes.length)}
        ${metricHtml("Findings", findings.length)}
        ${metricHtml("Excluded", excluded.length)}
        ${metricHtml("Links", linkStats.totalAnchors ?? 0)}
        ${metricHtml("Images", imageStats.total ?? data?.imageCount ?? 0)}
      </div>
      <div class="result-subsection">
        <div class="result-label">Findings</div>
        <div class="finding-list">
          ${findings.map(
            (issue, index) =>
              `<div class="finding-row">
                <div>
                  <div class="finding-title">${escapeHtml(humanLabel(issue.code))}</div>
                  <div class="muted small">${escapeHtml(issue.message || "")}</div>
                </div>
                <div class="row">
                  <button class="copy-icon" type="button" data-copy-finding="${index}" title="Copy finding" aria-label="Copy finding">⧉</button>
                  ${badgeHtml("finding","bad")}
                </div>
              </div>`
          ).join("") || '<div class="empty-state good-state">No deterministic findings.</div>'}
        </div>
      </div>
      ${excluded.length
        ? `<details class="subdetails">
            <summary>Excluded by site profile (${excluded.length})</summary>
            <div class="finding-list">
              ${excluded.map(
                check =>
                  `<div class="finding-row compact">
                    <div>
                      <div class="finding-title">${escapeHtml(humanLabel(check.code))}</div>
                      <div class="muted small">${escapeHtml(check.message || "")}${check.excludedBy?.note ? ` · ${escapeHtml(check.excludedBy.note)}` : ""}</div>
                    </div>
                    ${badgeHtml("excluded","neutral")}
                  </div>`
              ).join("")}
            </div>
          </details>`
        : ""}
      <details class="subdetails">
        <summary>Passed checks (${passes.length})</summary>
        <div class="finding-list">
          ${passes.map(
            check =>
              `<div class="finding-row compact">
                <div>
                  <div class="finding-title">${escapeHtml(humanLabel(check.code))}</div>
                  <div class="muted small">${escapeHtml(check.message || "")}</div>
                </div>
                ${badgeHtml("pass","good")}
              </div>`
          ).join("")}
        </div>
      </details>
      ${rawJsonDetails(data)}
    </div>
  `;

  details
    .querySelectorAll(
      "[data-copy-finding]"
    )
    .forEach(
      button => {
        const finding =
          findings[
            Number(
              button.dataset
                .copyFinding
            )
          ];

        button.onclick =
          async event => {
            event.preventDefault();
            event.stopPropagation();

            await navigator.clipboard
              .writeText(
                resultCopyText(
                  finding
                )
              );

            button.textContent =
              "✓";

            setTimeout(
              () =>
                button.textContent =
                  "⧉",
              900
            );
          };
      }
    );

  return details;
}

function analyseConfigDetails(config = {}, skipped = []) {
  const details = document.createElement("details"); details.className = "card analyse-result-group";
  details.innerHTML = `<summary>Run configuration</summary><div class="analyse-group-body"><div class="chip-row">${Object.entries(config).map(([key,enabled]) => `<span class="mini-chip ${enabled ? "enabled" : "disabled"}">${escapeHtml(humanLabel(key))}: ${enabled ? "on" : "off"}</span>`).join("")}</div>${skipped.length ? `<div class="result-subsection"><div class="result-label">Skipped</div><ul class="evidence-list">${skipped.map(item => `<li><strong>${escapeHtml(humanLabel(item.stage))}:</strong> ${escapeHtml(item.reason)}</li>`).join("")}</ul></div>` : ""}</div>`;
  return details;
}

function domDiffResultDetails(data) {
  const details = document.createElement("details"); details.className = "card analyse-result-group"; details.open = (data?.assessments?.length || 0) > 0;
  const summary = data?.summary || {};
  const aggregate = summary.aggregateImpact || null;
  const impactSummary = aggregate
    ? `<div class="dom-impact-inline">
        <strong>${escapeHtml(humanLabel(aggregate.divergence || "small"))} render change</strong>
        · ${escapeHtml(humanLabel(aggregate.significance || "low"))} significance
        · approx. ${escapeHtml(aggregate.estimated_inventory_change_percent ?? 0)}% of weighted comparable inventory
        ${aggregate.reasons?.length ? `<div class="muted small">${aggregate.reasons.map(reason => escapeHtml(reason)).join(" · ")}</div>` : ""}
      </div>`
    : "";

  details.innerHTML = `<summary><span>Server HTML ↔ rendered DOM</span>${data?.enabled ? badgeHtml("enabled","neutral") : badgeHtml("off","neutral")}</summary><div class="analyse-group-body">${!data?.enabled ? '<div class="empty-state">Skipped for this Analyse all run. Enable it in Config when you specifically want a rendering comparison.</div>' : `${impactSummary}<div class="metric-row">${metricHtml("Differences",summary.totalDiffItems ?? 0,"Semantic changes retained after reconciliation and deterministic noise filtering. These are not capped by count.")}${metricHtml("For model review",summary.returnedNanoReviewItems ?? 0,"Retained differences where contextual model judgement may still be useful.")}${metricHtml("Noise removed",summary.noiseRemovedItems ?? 0,"Only obvious implementation-only churn is removed: reconciled items where the semantic value is unchanged but a selector/ID changed with volatile hydration, cache, state, session, nonce, UUID or generated-token patterns. Semantic heading, link and content changes are retained.")}</div>`}<div data-dom-assessments></div>${rawJsonDetails(data)}</div>`;
  const target = details.querySelector("[data-dom-assessments]");
  for (const assessment of data?.assessments || []) {
    if (assessment.error) { const error = document.createElement("div"); error.className = "card result-card error-card"; error.innerHTML = `<div class="result-copy">${escapeHtml(assessment.error)}</div>`; target.appendChild(error); }
    else target.appendChild(providerCard("dom_diff_triage", assessment.provider, assessment.result || {}, assessment.batch ? `batch ${assessment.batch}` : null));
  }
  return details;
}

async function runAcross(
  task,
  payload,
  target,
  mode = null,
  displayContextOverride = null
) {
  const providers = enabledProviders();
  let successCount = 0;
  let errorCount = 0;

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
    const taskLabels = {
      page_type: "Identifying page type",
      intent: "Identifying intent",
      alignment: "Reviewing page and intent alignment",
      link_group: "Reviewing links",
      false_positive: "Reviewing findings",
      dom_diff_triage: "Reviewing DOM differences",
      dom_diff_summary: "Summarising DOM differences",
      url_consistency: "Reviewing URL and locale signals",
      jira_ticket: "Drafting Jira ticket"
    };

    setStatus(
      `${taskLabels[task] || "Running model review"} · ${providerReviewLabel(provider, task)}…`
    );

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
        providerCard(
          task,
          provider,
          result,
          mode,
          task === "link_group"
            ? (
                displayContextOverride ||
                {
                  links:
                    payload.links ||
                    []
                }
              )
            : task ===
                "false_positive"
              ? {
                  issueCode:
                    payload.issue
                      ?.code ||
                    "",
                  examples:
                    Array.isArray(
                      payload.issue
                        ?.deterministicValue
                        ?.examples
                    )
                      ? payload.issue
                          .deterministicValue
                          .examples
                      : Array.isArray(
                          payload.issue
                            ?.deterministicValue
                        )
                        ? payload.issue
                            .deterministicValue
                        : []
                }
              : null
        )
      );

      successCount += 1;
    } catch (e) {
      errorCount += 1;
      const card = document.createElement("div");
      card.className = "card";

      card.innerHTML =
        `<h3>${mode ? `${mode} · ` : ""}${provider} · error</h3>` +
        `<pre>${escapeHtml(e?.message || String(e))}</pre>`;

      target.appendChild(card);
    }
  }

  setStatus("");

  return {
    successCount,
    errorCount
  };
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

async function checkLinkResponsesForUrls(
  urls = [],
  {
    reset = false,
    updateSummary = true
  } = {}
) {
  const uniqueUrls =
    [
      ...new Set(
        urls.filter(
          href =>
            /^https?:\/\//i.test(
              href ||
              ""
            )
        )
      )
    ];

  if (!uniqueUrls.length) {
    return null;
  }

  const origins =
    [
      ...new Set(
        uniqueUrls
          .map(
            url => {
              try {
                return `${new URL(url).origin}/*`;
              } catch {
                return null;
              }
            }
          )
          .filter(Boolean)
      )
    ];

  if (!origins.length) {
    return null;
  }

  const granted =
    await chrome.permissions
      .request({
        origins
      });

  if (!granted) {
    return null;
  }

  const result =
    await sw({
      type:
        "CHECK_LINK_RESPONSES",
      urls:
        uniqueUrls,
      reset
    });

  snapshot.linkResponseChecks =
    result;

  if (updateSummary) {
    const target =
      $("#linkResponseResults");

    if (target) {
      target.innerHTML =
        linkResponseResultsHtml(
          result
        );
    }
  }

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

  return result;
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

    canonical_relationship: {
      ...base,
      pagePurpose,
      urlIdentity,
      canonicalRelationship:
        issue?.deterministicValue ||
        null
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
          []
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
          []
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
          []
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


function deterministicFindingEvidenceHtml(issue) {
  const value =
    issue?.deterministicValue;

  const code =
    issue?.code ||
    "";

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  const codeLine =
    (label, text) =>
      text
        ? `<div class="small"><strong>${escapeHtml(label)}:</strong> <code>${escapeHtml(String(text))}</code></div>`
        : "";

  const textLine =
    (label, text) =>
      text
        ? `<div class="small"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(String(text))}</div>`
        : "";

  const examples =
    Array.isArray(
      value?.examples
    )
      ? value.examples
      : Array.isArray(value)
        ? value
        : [];

  if (
    [
      "images_missing_alt",
      "images_empty_alt",
      "images_missing_dimensions"
    ].includes(
      code
    )
  ) {
    const rows =
      examples
        .slice(0, 5)
        .map(
          item =>
            `<div class="result-row static">` +
            codeLine(
              "Image",
              item.src
            ) +
            (
              item.link_href
                ? codeLine(
                    "Linked to",
                    item.link_href
                  )
                : ""
            ) +
            (
              item.html
                ? codeLine(
                    "Element",
                    item.html
                  )
                : ""
            ) +
            (
              item.selector
                ? codeLine(
                    "Selector",
                    item.selector
                  )
                : ""
            ) +
            (
              item.nearby_text
                ? textLine(
                    "Nearby",
                    item.nearby_text
                  )
                : ""
            ) +
            `</div>`
        )
        .join("");

    return rows
      ? `<details class="subdetails finding-evidence"><summary>Affected image${examples.length === 1 ? "" : "s"}</summary><div class="result-list">${rows}</div></details>`
      : "";
  }

  if (
    code ===
    "links_empty_anchor"
  ) {
    const anchorExamples =
      Array.isArray(
        value?.examples
      )
        ? value.examples
        : [];

    const rows =
      anchorExamples
        .slice(0, 5)
        .map(
          item =>
            `<div class="result-row static">` +
            codeLine(
              "Href",
              item.href ||
              item.rawHref
            ) +
            (
              item.html
                ? codeLine(
                    "Element",
                    item.html
                  )
                : ""
            ) +
            (
              item.selector
                ? codeLine(
                    "Selector",
                    item.selector
                  )
                : ""
            ) +
            textLine(
              "Visible",
              item.visible_on_page ===
                true
                ? "yes"
                : item.visible_on_page ===
                    false
                  ? "no"
                  : ""
            ) +
            (
              item.child_tags
                ?.length
                ? textLine(
                    "Children",
                    item.child_tags.join(
                      ", "
                    )
                  )
                : ""
            ) +
            (
              item.nearby_text
                ? textLine(
                    "Nearby",
                    item.nearby_text
                  )
                : ""
            ) +
            `</div>`
        )
        .join("");

    return rows
      ? `<details class="subdetails finding-evidence"><summary>Affected link${anchorExamples.length === 1 ? "" : "s"}</summary><div class="result-list">${rows}</div></details>`
      : "";
  }

  if (
    [
      "internal_http_links",
      "pagination_page1_parameter"
    ].includes(
      code
    )
  ) {
    const rows =
      examples
        .slice(0, 8)
        .map(
          item =>
            `<div class="result-row static">` +
            codeLine(
              "Href",
              item.href ||
              item.rawHref
            ) +
            (
              item.anchor
                ? textLine(
                    "Anchor",
                    item.anchor
                  )
                : ""
            ) +
            (
              item.selector
                ? codeLine(
                    "Selector",
                    item.selector
                  )
                : ""
            ) +
            `</div>`
        )
        .join("");

    return rows
      ? `<details class="subdetails finding-evidence"><summary>Affected link${examples.length === 1 ? "" : "s"}</summary><div class="result-list">${rows}</div></details>`
      : "";
  }

  if (
    code ===
    "heading_hierarchy" &&
    Array.isArray(value)
  ) {
    const rows =
      value
        .slice(0, 8)
        .map(
          item =>
            `<div class="result-row static">` +
            textLine(
              "From",
              item.from
            ) +
            (
              item.fromSelector
                ? codeLine(
                    "From selector",
                    item.fromSelector
                  )
                : ""
            ) +
            textLine(
              "To",
              item.to
            ) +
            (
              item.toSelector
                ? codeLine(
                    "To selector",
                    item.toSelector
                  )
                : ""
            ) +
            `</div>`
        )
        .join("");

    return rows
      ? `<details class="subdetails finding-evidence"><summary>Affected heading transition${value.length === 1 ? "" : "s"}</summary><div class="result-list">${rows}</div></details>`
      : "";
  }

  if (
    code ===
    "jsonld_parse_error" &&
    Array.isArray(value)
  ) {
    const rows =
      value
        .slice(0, 5)
        .map(
          item =>
            `<div class="result-row static">` +
            textLine(
              "Block",
              Number.isFinite(
                Number(
                  item.index
                )
              )
                ? `#${Number(item.index) + 1}`
                : ""
            ) +
            textLine(
              "Error",
              item.error
            ) +
            (
              item.excerpt
                ? codeLine(
                    "Excerpt",
                    item.excerpt
                  )
                : ""
            ) +
            `</div>`
        )
        .join("");

    return rows
      ? `<details class="subdetails finding-evidence"><summary>JSON-LD parse evidence</summary><div class="result-list">${rows}</div></details>`
      : "";
  }

  if (
    [
      "hreflang_duplicate_value",
      "hreflang_unapproved_value",
      "hreflang_invalid_format",
      "hreflang_empty_href"
    ].includes(
      code
    )
  ) {
    const rows =
      examples
        .slice(0, 8)
        .map(
          item =>
            `<div class="result-row static">` +
            textLine(
              "Hreflang",
              item.value
            ) +
            codeLine(
              "Href",
              item.href
            ) +
            (
              item.format_looks_valid !==
                undefined
                ? textLine(
                    "Syntax",
                    item.format_looks_valid
                      ? "valid"
                      : "invalid"
                  )
                : ""
            ) +
            (
              item.agreed_match
                ? textLine(
                    "Project policy",
                    humanLabel(
                      item.agreed_match
                    )
                  )
                : ""
            ) +
            (
              item.agreed_basis
                ? textLine(
                    "Allowed by",
                    item.agreed_basis
                  )
                : ""
            ) +
            (
              item.agreed_related_values
                ?.length
                ? textLine(
                    "Related configured values",
                    item.agreed_related_values.join(
                      ", "
                    )
                  )
                : ""
            ) +
            `</div>`
        )
        .join("");

    return rows
      ? `<details class="subdetails finding-evidence"><summary>Hreflang evidence</summary><div class="result-list">${rows}</div></details>`
      : "";
  }

  if (
    [
      "multiple_canonical",
      "canonical_cross_origin",
      "canonical_relationship",
      "canonical_relative_href",
      "canonical_fragment",
      "canonical_protocol_downgrade",
      "robots_noindex",
      "robots_conflict",
      "robots_googlebot_conflict",
      "rendered_head_invalid_element",
      "open_graph_incomplete",
      "og_url_mismatch",
      "twitter_card_incomplete",
      "favicon_presence"
    ].includes(
      code
    )
  ) {
    return `<details class="subdetails finding-evidence"><summary>Finding evidence</summary><pre>${escapeHtml(JSON.stringify(value, null, 2).slice(0, 4000))}</pre></details>`;
  }

  return "";
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
  const excluded = checks.filter(x => x.status === "excluded");

  summary.innerHTML = `
    <div class="audit-summary-cards">
      <div class="audit-summary-card">
        <span class="audit-summary-value">${checks.length}</span>
        <span class="audit-summary-label">Checks run</span>
      </div>
      <div class="audit-summary-card good">
        <span class="audit-summary-value">${passes.length}</span>
        <span class="audit-summary-label">Passed</span>
      </div>
      <div class="audit-summary-card ${findings.length ? "warn" : "good"}">
        <span class="audit-summary-value">${findings.length}</span>
        <span class="audit-summary-label">Findings to review</span>
      </div>
      ${excluded.length
        ? `<div class="audit-summary-card">
            <span class="audit-summary-value">${excluded.length}</span>
            <span class="audit-summary-label">Excluded</span>
          </div>`
        : ""}
    </div>
  `;

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
          deterministicFindingEvidenceHtml(
            issue
          ) +
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

        const batches =
          findingReviewBatches(
            fullIssue
          );

        for (
          const batch
          of batches
        ) {
          if (
            batches.length > 1
          ) {
            const label =
              document.createElement(
                "div"
              );

            label.className =
              "muted small";

            label.textContent =
              `Batch ${batch.batch}/${batch.batchCount} · affected items ${batch.itemStart}-${batch.itemEnd} of ${batch.totalItems}`;

            target.appendChild(
              label
            );
          }

          await runAcross(
            "false_positive",
            {
              issue:
                batch.issue,
              context:
                pageContextForIssue(
                  fullIssue
                )
            },
            target
          );
        }
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

function domDiffReviewItems() {
  return (
    domDiff?.items ||
    []
  ).filter(
    item =>
      item.nano_review !==
      false
  );
}

function domDiffReviewBatches() {
  const items =
    domDiffReviewItems();

  const size =
    runtimeDomBatchSize();

  const batches = [];

  for (
    let i = 0;
    i < items.length;
    i += size
  ) {
    const batchItems =
      items.slice(
        i,
        i + size
      );

    batches.push({
      number:
        batches.length + 1,
      start:
        i + 1,
      end:
        i +
        batchItems.length,
      items:
        batchItems,
      itemIds:
        batchItems.map(
          item => item.id
        )
    });
  }

  return batches;
}

function domDiffBatchKey(
  itemIds = []
) {
  return itemIds
    .map(String)
    .join(",");
}

function fullAnalysisDomAssessments(
  batch
) {
  const expected =
    new Set(
      batch.itemIds.map(
        String
      )
    );

  return (
    lastAnalyseAllReport
      ?.domDiff
      ?.assessments ||
    []
  ).filter(
    assessment => {
      const ids =
        (
          assessment.itemIds ||
          []
        ).map(String);

      return (
        ids.length ===
          expected.size &&
        ids.every(
          id =>
            expected.has(id)
        )
      );
    }
  );
}

function domDiffBatchAssessments(
  batch
) {
  const key =
    domDiffBatchKey(
      batch.itemIds
    );

  const local =
    domDiffBatchReviews
      .get(key)
      ?.assessments ||
    [];

  if (local.length) {
    return local;
  }

  return fullAnalysisDomAssessments(
    batch
  );
}

function domDiffBatchSummary(
  batch
) {
  const counts = {};

  for (
    const item
    of batch.items
  ) {
    const label =
      humanLabel(
        item.kind ||
        "other"
      );

    counts[label] =
      (
        counts[label] ||
        0
      ) + 1;
  }

  return Object.entries(
    counts
  )
    .map(
      ([label, count]) =>
        `${label}: ${count}`
    )
    .join(" · ");
}

function renderDomDiffSummary() {
  const el =
    $("#domDiffSummary");

  if (!el) return;

  if (!domDiff) {
    el.innerHTML =
      '<div class="card dom-comparison-summary-card"><strong>No comparison run yet.</strong><div class="muted small">Run comparison to compare server HTML with the rendered page.</div></div>';

    renderDomDiffBatches();

    return;
  }

  const summary =
    domDiff.summary || {};

  const aggregate =
    summary.aggregateImpact ||
    null;

  const reviewCount =
    domDiffReviewItems()
      .length;

  const significanceTone =
    aggregate?.significance ===
      "meaningful"
      ? "bad"
      : aggregate?.significance ===
          "review"
        ? "warn"
        : "good";

  el.innerHTML = `
    <div class="card dom-comparison-summary-card">
      <div class="result-card-head">
        <div>
          <h3>Comparison summary</h3>
          <div class="muted small">
            Deterministic comparison of server HTML and the rendered DOM.
          </div>
        </div>
        ${
          aggregate
            ? badgeHtml(
                aggregate.significance ||
                  "low",
                significanceTone
              )
            : ""
        }
      </div>

      <div class="metric-row" style="margin-top:8px">
        ${metricHtml(
          "Differences",
          summary.totalDiffItems ?? 0,
          "Semantic heading, link, content, metadata and related changes retained after reconciliation and deterministic noise filtering. These are not capped by count."
        )}
        ${metricHtml(
          "For model review",
          reviewCount,
          "Retained differences where contextual judgement may still be useful. Model batch size changes how these are grouped, not which differences are kept."
        )}
        ${metricHtml(
          "Noise removed",
          summary.noiseRemovedItems ?? 0,
          "Implementation-only differences removed deterministically, such as volatile hydration/state/cache identifiers where the semantic value itself did not change."
        )}
        ${
          aggregate
            ? metricHtml(
                "Est. inventory changed",
                `${aggregate.estimated_inventory_change_percent ?? 0}%`,
                "Approximate proportion of the weighted comparable page inventory affected by rendering changes."
              )
            : ""
        }
      </div>

      ${
        aggregate
          ? `
            <div class="dom-impact-inline">
              <strong>${escapeHtml(humanLabel(aggregate.divergence || "small"))} render change</strong>
              · ${escapeHtml(humanLabel(aggregate.significance || "low"))} significance
              ${
                aggregate.reasons?.length
                  ? `<div class="muted small" style="margin-top:4px">${aggregate.reasons.map(reason => escapeHtml(reason)).join(" · ")}</div>`
                  : ""
              }
            </div>
          `
          : ""
      }
    </div>
  `;

  renderDomDiffBatches();
}

function renderDomDiffBatchResults() {
  const target =
    $("#domDiffResults");

  if (!target) return;

  target.innerHTML = "";

  if (!domDiff) {
    return;
  }

  const reviewed =
    domDiffReviewBatches()
      .filter(
        batch =>
          domDiffBatchAssessments(
            batch
          ).length
      );

  if (!reviewed.length) {
    target.innerHTML =
      '<div class="empty-state">Reviewed batch details will appear here.</div>';

    return;
  }

  for (
    const batch
    of reviewed
  ) {
    const assessments =
      domDiffBatchAssessments(
        batch
      );

    const judgementMap =
      new Map(
        batch.items.map(
          item => [
            item.id,
            []
          ]
        )
      );

    for (
      const assessment
      of assessments
    ) {
      if (
        assessment.error ||
        !assessment.result
      ) {
        continue;
      }

      for (
        const result
        of assessment.result
          ?.results ||
        []
      ) {
        if (
          !judgementMap.has(
            result.id
          )
        ) {
          judgementMap.set(
            result.id,
            []
          );
        }

        judgementMap
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

    const details =
      document.createElement(
        "details"
      );

    details.className =
      "card analyse-result-group dom-batch-result";

    details.innerHTML = `
      <summary>
        <span>Batch ${batch.number} · differences ${batch.start}–${batch.end}</span>
        <span class="summary-count">${batch.items.length}</span>
      </summary>
      <div class="analyse-group-body">
        <div class="muted small">
          ${escapeHtml(domDiffBatchSummary(batch))}
        </div>
        <div data-dom-batch-table></div>
      </div>
    `;

    details
      .querySelector(
        "[data-dom-batch-table]"
      )
      .appendChild(
        domDiffTable(
          batch.items,
          judgementMap
        )
      );

    target.appendChild(
      details
    );
  }
}

async function reviewDomDiffBatch(
  batch,
  button
) {
  if (!snapshot) {
    return setStatus(
      "Read the page first.",
      true
    );
  }

  const providers =
    enabledProviders();

  if (!providers.length) {
    return setStatus(
      "Choose at least one model before reviewing this batch.",
      true
    );
  }

  try {
    await ensureFullSnapshot();
  } catch (e) {
    return setStatus(
      e?.message ||
      String(e),
      true
    );
  }

  domDiff =
    snapshot.domDiff ||
    domDiff;

  const key =
    domDiffBatchKey(
      batch.itemIds
    );

  const assessments = [];

  if (button) {
    button.disabled =
      true;
    button.textContent =
      "Reviewing…";
  }

  try {
    for (
      const provider
      of providers
    ) {
      const domTask =
        provider ===
          "nano"
          ? "dom_diff_summary"
          : "dom_diff_triage";

      setStatus(
        `Reviewing DOM batch ${batch.number} · ${providerReviewLabel(provider, domTask)}…`
      );

      try {
        const result =
          await sw({
            type:
              "RUN_TASK",
            task:
              domTask,
            provider,
            analysisRunId:
              analysisRun.id,
            payload: {
              items:
                batch.items,
              cmsContext:
                domDiff?.cmsContext ||
                null
            },
            useCache:
              $("#useCache")
                .checked
          });

        taskResults[
          domTask
        ][
          provider
        ] = result;

        assessments.push({
          batch:
            batch.number,
          provider,
          task:
            domTask,
          itemIds:
            [...batch.itemIds],
          result,
          error:
            null
        });
      } catch (e) {
        assessments.push({
          batch:
            batch.number,
          provider,
          task:
            domTask,
          itemIds:
            [...batch.itemIds],
          result:
            null,
          error:
            e?.message ||
            String(e)
        });
      }
    }

    domDiffBatchReviews.set(
      key,
      {
        assessments,
        reviewedAt:
          Date.now()
      }
    );

    renderDomDiffBatches();
    renderDomDiffBatchResults();

    setStatus("");
  } finally {
    if (button) {
      button.disabled =
        false;
      button.textContent =
        "Review";
    }
  }
}

function renderDomDiffBatches() {
  const target =
    $("#domDiffBatches");

  if (!target) return;

  target.innerHTML = "";

  if (!domDiff) {
    return;
  }

  const batches =
    domDiffReviewBatches();

  const card =
    document.createElement(
      "div"
    );

  card.className =
    "card dom-batch-card";

  if (!batches.length) {
    card.innerHTML =
      '<h3>Model review batches</h3><div class="empty-state good-state">No differences need model review. The deterministic comparison resolved the retained changes.</div>';

    target.appendChild(
      card
    );

    renderDomDiffBatchResults();

    return;
  }

  const reviewedCount =
    batches.filter(
      batch =>
        domDiffBatchAssessments(
          batch
        ).length
    ).length;

  card.innerHTML = `
    <div class="result-card-head">
      <div>
        <h3>Model review batches</h3>
        <div class="muted small">
          Review any batch in any order. A batch is only marked reviewed after a model call is attempted.
        </div>
      </div>
      ${badgeHtml(
        `${reviewedCount}/${batches.length} reviewed`,
        reviewedCount ===
          batches.length
          ? "good"
          : "neutral"
      )}
    </div>
    <div class="data-table-wrap">
      <table class="data-table dom-batch-table">
        <thead>
          <tr>
            <th>Batch</th>
            <th>Differences</th>
            <th>Contents</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  `;

  const body =
    card.querySelector(
      "tbody"
    );

  for (
    const batch
    of batches
  ) {
    const assessments =
      domDiffBatchAssessments(
        batch
      );

    const errors =
      assessments.filter(
        assessment =>
          assessment.error
      );

    const successful =
      assessments.filter(
        assessment =>
          !assessment.error &&
          assessment.result
      );

    const status =
      assessments.length
        ? errors.length &&
          !successful.length
          ? badgeHtml(
              "error",
              "bad"
            )
          : errors.length
            ? badgeHtml(
                "partial",
                "warn"
              )
            : badgeHtml(
                "reviewed",
                "good"
              )
        : badgeHtml(
            "not reviewed",
            "neutral"
          );

    const row =
      document.createElement(
        "tr"
      );

    row.innerHTML = `
      <td><strong>Batch ${batch.number}</strong></td>
      <td>${batch.start}–${batch.end} <span class="muted">of ${domDiffReviewItems().length}</span></td>
      <td>${escapeHtml(domDiffBatchSummary(batch))}</td>
      <td>${status}</td>
      <td><button class="secondary compact" data-review-dom-batch>${assessments.length ? "Review again" : "Review"}</button></td>
    `;

    row
      .querySelector(
        "[data-review-dom-batch]"
      )
      .onclick =
        event =>
          reviewDomDiffBatch(
            batch,
            event.currentTarget
          );

    body.appendChild(
      row
    );
  }

  target.appendChild(
    card
  );

  renderDomDiffBatchResults();
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
              ? (
                  h.format_looks_valid
                    ? `valid syntax · outside project allow-list${h.agreed_related_values?.length ? ` · related: ${h.agreed_related_values.join(", ")}` : ""}`
                    : "invalid syntax"
                )
              : h.agreed_match ===
                  "language_family"
                ? `allowed by language family → ${h.agreed_basis}`
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

function domDiffValueDetails(item, value, label) {
  const packed =
    value &&
    typeof value ===
      "object"
      ? value
      : {
          text:
            value || ""
        };

  const element =
    packed.element ||
    {};

  const rows = [];

  if (
    item.kind ===
    "link"
  ) {
    rows.push({
      label:
        "Anchor text",
      value:
        packed.text ||
        "(empty)"
    });

    rows.push({
      label:
        "Destination URL",
      value:
        packed.href ||
        "(none)",
      code:
        true
    });
  } else if (
    item.kind ===
    "heading"
  ) {
    rows.push({
      label:
        "Heading level",
      value:
        (
          packed.level ||
          element.tag ||
          "(unknown)"
        ).toUpperCase()
    });

    rows.push({
      label:
        "Heading text",
      value:
        packed.text ||
        "(empty)"
    });
  } else if (
    packed.text
  ) {
    rows.push({
      label:
        "Content",
      value:
        packed.text
    });
  } else {
    rows.push({
      label:
        "Value",
      value:
        typeof value ===
        "object"
          ? JSON.stringify(
              value
            )
          : String(
              value ||
              ""
            )
    });
  }

  return `
    <div class="dom-diff-side">
      <div class="result-label">${escapeHtml(label)}</div>
      ${rows
        .map(
          row =>
            `<div class="result-kv-row compact">
              <div class="result-label">${escapeHtml(row.label)}</div>
              <div>${row.code ? `<code>${escapeHtml(row.value)}</code>` : escapeHtml(row.value)}</div>
            </div>`
        )
        .join("")}
    </div>
  `;
}

function domDiffItemCard(item) {
  const rawPacked =
    item.raw &&
    typeof item.raw ===
      "object"
      ? item.raw
      : {
          text:
            item.raw ||
            ""
        };

  const renderedPacked =
    item.rendered &&
    typeof item.rendered ===
      "object"
      ? item.rendered
      : {
          text:
            item.rendered ||
            ""
        };

  const displayPacked =
    item.rendered &&
    (
      typeof item.rendered !==
        "string" ||
      item.rendered
    )
      ? renderedPacked
      : rawPacked;

  const element =
    displayPacked.element ||
    rawPacked.element ||
    item.element ||
    {};

  const changed =
    [
      "changed_in_rendered",
      "changed",
      "script_count_changed"
    ].includes(
      item.change_type
    );

  const changeLabel =
    item.change_type ===
      "added_in_rendered"
      ? "Added after rendering"
      : item.change_type ===
          "removed_in_rendered"
        ? "Removed after rendering"
        : changed
          ? "Changed after rendering"
          : humanLabel(
              item.change_type
            );

  let evidenceHtml =
    "";

  if (changed) {
    evidenceHtml = `
      <details class="dom-change-comparison" open>
        <summary>Show before / after evidence</summary>
        <div class="dom-change-grid">
          ${domDiffValueDetails(
            item,
            item.raw,
            "From · server HTML"
          )}
          ${domDiffValueDetails(
            item,
            item.rendered,
            "To · rendered DOM"
          )}
        </div>
      </details>
    `;
  } else {
    const label =
      item.change_type ===
        "added_in_rendered"
        ? "Rendered DOM"
        : item.change_type ===
            "removed_in_rendered"
          ? "Server HTML"
          : "Evidence";

    const value =
      item.change_type ===
        "removed_in_rendered"
        ? item.raw
        : item.rendered ||
          item.raw;

    evidenceHtml =
      domDiffValueDetails(
        item,
        value,
        label
      );
  }

  const d =
    document.createElement(
      "div"
    );

  d.className =
    "card";

  d.innerHTML = `
    <div class="result-primary">
      ${badgeHtml(changeLabel, changed ? "warn" : "neutral")}
      ${item.net_effect ? priorityBadgeHtml(item.net_effect.significance || "low") : ""}
    </div>

    <div class="result-grid two dom-context-grid">
      <div>
        <div class="result-label">Zone</div>
        <div>${escapeHtml(element.zone || "unknown")}</div>
      </div>
      <div>
        <div class="result-label">Component</div>
        <div>${escapeHtml(element.component || "unknown")}</div>
      </div>
      <div>
        <div class="result-label">Likely importance</div>
        <div>${escapeHtml(element.semantic_weight ?? "(not scored)")}</div>
      </div>
      <div>
        <div class="result-label">Element</div>
        <div>${escapeHtml(element.tag || "(unknown)")}</div>
      </div>
    </div>

    ${item.net_effect
      ? `
        <div class="result-subsection">
          <div class="result-label">What changed overall</div>
          <div class="result-copy">
            <strong>${escapeHtml(humanLabel(item.net_effect.significance || "unknown"))}</strong>
            · ${escapeHtml(item.net_effect.reason || "")}
          </div>
        </div>
      `
      : ""}

    ${item.nano_review === false
      ? '<div class="empty-state good-state" style="margin-top:8px">Resolved by the automated comparison · model review skipped</div>'
      : ""}

    ${(() => {
      const rawContext =
        item.raw &&
        typeof item.raw === "object"
          ? item.raw.local_context
          : null;

      const renderedContext =
        item.rendered &&
        typeof item.rendered === "object"
          ? item.rendered.local_context
          : null;

      const context =
        renderedContext ||
        rawContext;

      if (!context) {
        return "";
      }

      const identityBits = [
        context.heading
          ? `Heading: ${context.heading}`
          : "",
        context.aria_label
          ? `Label: ${context.aria_label}`
          : "",
        context.image_alt
          ? `Image: ${context.image_alt}`
          : ""
      ].filter(Boolean);

      return `
        <div class="result-subsection">
          <div class="result-label">Local element context</div>
          ${identityBits.length
            ? `<div class="small">${identityBits.map(bit => escapeHtml(bit)).join(" · ")}</div>`
            : ""}
          ${context.text
            ? `<div class="muted small" style="margin-top:4px">${escapeHtml(context.text)}</div>`
            : ""}
          ${context.container_selector
            ? `<div class="muted small" style="margin-top:4px">Container: <code>${escapeHtml(context.container_selector)}</code></div>`
            : ""}
        </div>
      `;
    })()}

    <div class="result-subsection">
      <div class="result-label">Change evidence</div>
      ${evidenceHtml}
    </div>

    ${item.transformation
      ? `
        <div class="result-subsection">
          <div class="result-label">Transformation fingerprint</div>
          <div class="finding-list">
            ${item.kind === "link" && item.transformation.url?.comparable
              ? `<div class="finding-row compact"><div>
                  <div class="finding-title">URL relationship</div>
                  <div class="muted small">
                    Same origin: ${item.transformation.url.same_origin ? "yes" : "no"}
                    · Same host: ${item.transformation.url.same_host ? "yes" : "no"}
                    · Scheme changed: ${item.transformation.url.scheme_changed ? "yes" : "no"}
                    · Path changed: ${item.transformation.url.path_changed ? "yes" : "no"}
                    · Query changed: ${item.transformation.url.query_changed ? "yes" : "no"}
                    · Shared terminal path: ${escapeHtml(item.transformation.url.shared_terminal_path_segments ?? 0)} segment(s)
                    · Retention: ${escapeHtml(Math.round((item.transformation.url.shorter_path_terminal_retention ?? 0) * 100))}%
                    ${item.transformation.url.added_path_prefix?.length ? ` · Added prefix: /${escapeHtml(item.transformation.url.added_path_prefix.join("/"))}/` : ""}
                    ${item.transformation.url.removed_path_prefix?.length ? ` · Removed prefix: /${escapeHtml(item.transformation.url.removed_path_prefix.join("/"))}/` : ""}
                  </div>
                </div></div>`
              : ""}
            ${item.transformation.text?.changed
              ? `<div class="finding-row compact"><div>
                  <div class="finding-title">Text change</div>
                  <div class="muted small">
                    Words: ${escapeHtml(item.transformation.text.before_words ?? 0)} → ${escapeHtml(item.transformation.text.after_words ?? 0)}
                    · Original retained: ${escapeHtml(Math.round((item.transformation.text.original_word_retention ?? 0) * 100))}%
                    · Token overlap: ${escapeHtml(Math.round((item.transformation.text.token_jaccard ?? 0) * 100))}%
                    ${item.transformation.text.added_terms?.length ? ` · Added: ${escapeHtml(item.transformation.text.added_terms.join(", "))}` : ""}
                    ${item.transformation.text.removed_terms?.length ? ` · Removed: ${escapeHtml(item.transformation.text.removed_terms.join(", "))}` : ""}
                  </div>
                </div></div>`
              : ""}
            ${item.kind === "heading" && item.transformation.heading
              ? `<div class="finding-row compact"><div>
                  <div class="finding-title">Heading structure</div>
                  <div class="muted small">
                    ${escapeHtml((item.transformation.heading.before_level || "(unknown)").toUpperCase())}
                    →
                    ${escapeHtml((item.transformation.heading.after_level || "(unknown)").toUpperCase())}
                    · Level changed: ${item.transformation.heading.level_changed ? "yes" : "no"}
                  </div>
                </div></div>`
              : ""}
            ${(() => {
              const facts = item.transformation.text?.factual_tokens || {};
              const changed = Object.entries(facts).filter(([,v]) => (v?.added?.length || v?.removed?.length));
              return changed.length
                ? `<div class="finding-row compact"><div>
                    <div class="finding-title">Factual token changes</div>
                    <div class="muted small">${changed.map(([k,v]) => `${escapeHtml(humanLabel(k))}: ${v.removed?.length ? "removed " + escapeHtml(v.removed.join(", ")) : ""}${v.removed?.length && v.added?.length ? " · " : ""}${v.added?.length ? "added " + escapeHtml(v.added.join(", ")) : ""}`).join(" · ")}</div>
                  </div></div>`
                : "";
            })()}
          </div>
        </div>
      `
      : ""}

    ${item.reconciliation
      ? `
        <div class="muted small" style="margin-top:8px">
          Matched as the same logical element across server/rendered versions
          · ${escapeHtml(item.reconciliation.reason || "matched")}
          ${item.reconciliation.confidence ? ` · pairing confidence ${escapeHtml(humanLabel(item.reconciliation.confidence))}` : ""}
          ${item.reconciliation.score != null ? ` · match score ${escapeHtml(item.reconciliation.score)}` : ""}
          ${item.reconciliation.near_competitors ? ` · ${escapeHtml(item.reconciliation.near_competitors)} near competing match(es)` : ""}
        </div>
      `
      : ""}

    <details class="subdetails" style="margin-top:10px">
      <summary>Technical locator</summary>
      <div class="small" style="margin-top:6px">
        <strong>Selector:</strong>
        <code>${escapeHtml(element.selector || "(not available)")}</code>
      </div>
    </details>

    <div class="row section-actions">
      <button class="secondary" data-dom-jira>Create Jira ticket</button>
    </div>
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
      jiraTarget.innerHTML =
        "";

      try {
        await createJiraTicket({
          issue:
            item,
          context: {
            url:
              snapshot?.url ||
              "",
            domDiffSummary:
              domDiff?.summary ||
              {},
            domDiffCaveat:
              domDiff?.caveat ||
              "",
            element,
            raw:
              item.raw,
            rendered:
              item.rendered,
            netEffect:
              item.net_effect ||
              null
          },
          target:
            jiraTarget,
          button:
            jiraBtn
        });
      } catch (e) {
        setStatus(
          e?.message ||
          String(e),
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

  return judgements
    .map(
      result => {
        if (
          result.summary &&
          !result.judgement
        ) {
          return (
            '<div class="model-dom-summary">' +
            '<div class="result-primary"><span class="badge neutral">Nano summary</span></div>' +
            `<div class="small">${escapeHtml(result.summary)}</div>` +
            '</div>'
          );
        }

        return (
          '<div class="model-dom-judgement">' +
          `<div class="result-primary">${badgeHtml(result.judgement)}${badgeHtml(result.change_area, "neutral")}${confidenceHtml(result.confidence)}</div>` +
          `<div class="small">${escapeHtml(result.rationale || "")}</div>` +
          '</div>'
        );
      }
    )
    .join("");
}

function domDiffJoinedAccordion(
  item,
  judgements = []
) {
  const row =
    document.createElement(
      "tr"
    );

  row.className =
    "dom-diff-table-row";

  const headlineText =
    item.rendered?.text ||
    item.rendered?.href ||
    item.raw?.text ||
    item.raw?.href ||
    "";

  row.innerHTML = `
    <td><code>#${escapeHtml(item.id)}</code></td>
    <td>${escapeHtml(humanLabel(item.kind))}</td>
    <td>${escapeHtml(humanLabel(item.change_type))}</td>
    <td>
      ${headlineText
        ? `<div class="table-preview">${escapeHtml(String(headlineText).slice(0, 180))}</div>`
        : '<span class="muted">—</span>'}
      <details class="table-details">
        <summary>Evidence</summary>
        <div data-dom-evidence></div>
      </details>
    </td>
    <td>
      ${domJudgementSummaryHtml(
        judgements
      )}
    </td>
  `;

  const evidenceTarget =
    row.querySelector(
      "[data-dom-evidence]"
    );

  const evidence =
    domDiffItemCard(
      item
    );

  evidence.classList.add(
    "dom-diff-evidence-card"
  );

  evidenceTarget.appendChild(
    evidence
  );

  return row;
}
function domDiffTable(
  items,
  judgementMap =
    new Map()
) {
  const wrap =
    document.createElement(
      "div"
    );

  wrap.className =
    "data-table-wrap";

  const table =
    document.createElement(
      "table"
    );

  table.className =
    "data-table dom-diff-table";

  table.innerHTML = `
    <thead>
      <tr>
        <th>ID</th>
        <th>Type</th>
        <th>Change</th>
        <th>Evidence</th>
        <th>Model review</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const body =
    table.querySelector(
      "tbody"
    );

  for (
    const item
    of items ||
    []
  ) {
    body.appendChild(
      domDiffJoinedAccordion(
        item,
        judgementMap.get(
          item.id
        ) ||
        []
      )
    );
  }

  wrap.appendChild(
    table
  );

  return wrap;
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

  const providers =
    enabledProviders();

  if (!providers.length) {
    throw new Error(
      "Choose at least one model."
    );
  }

  button.disabled =
    true;

  target.innerHTML =
    "";

  try {
    for (
      const provider
      of providers
    ) {
      setStatus(
        `Drafting Jira ticket · ${provider}…`
      );

      const ticket =
        await sw({
          type:
            "RUN_TASK",
          task:
            "jira_ticket",
          provider,
          analysisRunId:
            analysisRun?.id ||
            null,
          payload: {
            issue,
            context,
            exampleUrl:
              snapshot.url
          },
          useCache:
            $("#useCache")
              .checked
        });

      const wrapper =
        document.createElement(
          "div"
        );

      wrapper.className =
        "provider-ticket";

      wrapper.innerHTML =
        `<div class="result-provider">${escapeHtml(provider)}</div>`;

      renderJiraTicket(
        wrapper,
        ticket
      );

      target.appendChild(
        wrapper
      );
    }

    setStatus("");
  } finally {
    button.disabled =
      false;
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
  if (auditSummary) auditSummary.textContent = "Full-page analysis is running…";

  const domSummary = $("#domDiffSummary");
  if (domSummary) domSummary.textContent = "Full-page analysis is running…";

  const urlSummary = $("#urlSignalSummary");
  if (urlSummary) urlSummary.innerHTML = '<div class="card"><span class="muted">Full-page analysis is running…</span></div>';
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
  if (
    !result ||
    typeof result !== "object"
  ) {
    return result;
  }

  const security =
    securityForResult(
      result
    );

  const clean = {
    ...result
  };

  delete clean._meta;
  delete clean._security;

  if (security) {
    clean._security =
      security;
  }

  return clean;
}

function analyseResultDetails(title, value, open = false) {
  const details = document.createElement("details");
  details.className = "card analyse-result-group";
  details.open = open;
  details.innerHTML = `<summary>${escapeHtml(title)}</summary><div class="analyse-group-body">${genericResultHtml(value)}${rawJsonDetails(value)}</div>`;
  return details;
}

function reportSecurityWarnings(
  report
) {
  const entries = [
    ...(report.pageType || []),
    ...(report.intent || []),
    ...(report.alignment || []),
    ...(report.links || []),
    ...(report.falsePositives || []),
    ...(report.domDiff?.assessments || []),
    ...(report.urlConsistency || [])
  ];

  return entries.filter(
    entry =>
      securityForResult(
        entry.result
      )?.injectionScan
        ?.detected
  ).length;
}

function renderAnalyseAllResults(report) {
  const target = $("#analyseAllResults");
  if (!target) return;

  target.innerHTML = "";

  const securityWarnings =
    reportSecurityWarnings(
      report
    );

  const summary = document.createElement("div");
  summary.className = "card analyse-results-summary";
  summary.innerHTML = `
    <div class="result-card-head">
      <div>
        <h3>Analysis complete</h3>
        <div class="muted small">${escapeHtml(report.url || "")}</div>
      </div>
      ${report.errors.length ? badgeHtml(`${report.errors.length} error${report.errors.length === 1 ? "" : "s"}`, "bad") : badgeHtml("complete", "good")}
    </div>
    <div class="metric-row" style="margin-top:10px">
      ${metricHtml("Findings", report.deterministic?.findings?.length || 0)}
      ${metricHtml("Reviewers", report.providers.length)}
      ${metricHtml("Warnings", securityWarnings)}
    </div>
    <div class="result-label">Reviewed with</div>
    ${chipsHtml(report.providers)}
    <div class="result-label" style="margin-top:8px">Evidence representation</div>
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
      false
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
      "Link review",
      (report.links || []).map(
        entry => ({
          ...entry,
          linkResponses:
            report.linkResponses
              ?.results ||
            []
        })
      ),
      "link_group"
    )
  );

  const fp = analyseTaskDetails(
    "Finding review",
    report.falsePositives,
    "false_positive",
    report.falsePositives.length > 0
  );
  target.appendChild(fp);

  // Keep every deterministic finding visible for traceability, but make the
  // triage disposition explicit so reference-only rows do not look actionable.
  if (
    report.deterministic
      ?.findings
      ?.length
  ) {
    const jiraBox =
      document.createElement(
        "div"
      );

    jiraBox.className =
      "card";

    jiraBox.innerHTML =
      "<h3>Finding details</h3>" +
      '<div class="muted small">The finding is the factual result from the page checks. Model review is shown separately to help judge practical impact.</div>';

    const triageMap =
      deterministicTriageByCode(
        report
      );

    const findings =
      (
        snapshot?.auditChecks ||
        []
      )
        .filter(
          issue =>
            issue.status ===
            "finding"
        )
        .map(
          issue => ({
            issue,
            disposition:
              deterministicFindingDisposition(
                issue,
                report,
                triageMap
              )
          })
        )
        .sort(
          (a, b) => {
            const rank = {
              meaningful_issue: 0,
              low_impact: 1,
              needs_review: 2,
              unreviewed: 3,
              no_material_impact: 4,
              likely_false_positive: 5
            };

            return (
              (
                rank[
                  a.disposition.key
                ] ??
                9
              ) -
              (
                rank[
                  b.disposition.key
                ] ??
                9
              )
            );
          }
        );

    findings.forEach(
      ({
        issue,
        disposition
      }) => {
        const row =
          document.createElement(
            "div"
          );

        row.className =
          `issue finding-followup-row finding-${disposition.key}`;

        const reviewSummary =
          triageReviewSummary(
            disposition.reviews
          );

        const rationale =
          disposition.reviews
            .map(
              review =>
                review.rationale
            )
            .filter(Boolean)
            .join(" · ");

        row.innerHTML = `
          <div class="issue-head">
            <div class="finding-followup-copy">
              <div class="result-primary">
                <strong>${escapeHtml(humanLabel(issue.code))}</strong>
                ${badgeHtml(disposition.label, disposition.tone)}
              </div>
              <div class="small">${escapeHtml(issue.message)}</div>
              ${disposition.profile?.impacts?.length
                ? `<div class="result-primary" style="margin-top:5px">${disposition.profile.impacts.map(impact => badgeHtml(impact, "neutral")).join("")}</div>`
                : ""}
              ${disposition.profile?.consequence
                ? `<div class="muted small" style="margin-top:5px">${escapeHtml(disposition.profile.consequence)}</div>`
                : ""}
              <div class="finding-disposition-note small">
                ${escapeHtml(disposition.note)}
              </div>
              ${reviewSummary
                ? `<div class="muted small finding-review-summary">${escapeHtml(reviewSummary)}</div>`
                : ""}
              ${rationale
                ? `<details class="subdetails"><summary>Model rationale</summary><div class="small" style="margin-top:6px">${escapeHtml(rationale)}</div></details>`
                : ""}
            </div>
            <button class="secondary" data-all-jira>
              ${["likely_false_positive","no_material_impact"].includes(disposition.key) ? "Create ticket anyway" : "Create Jira ticket"}
            </button>
          </div>
          <div data-all-jira-result></div>
        `;

        const btn =
          row.querySelector(
            "[data-all-jira]"
          );

        const jiraTarget =
          row.querySelector(
            "[data-all-jira-result]"
          );

        btn.onclick =
          async () => {
            jiraTarget.innerHTML =
              "";

            try {
              await createJiraTicket({
                issue,
                context: {
                  ...pageContextForIssue(
                    issue
                  ),
                  triageDisposition:
                    disposition.label,
                  triageReviews:
                    disposition.reviews
                },
                target:
                  jiraTarget,
                button:
                  btn
              });
            } catch (e) {
              setStatus(
                e?.message ||
                String(e),
                true
              );
            }
          };

        jiraBox.appendChild(
          row
        );
      }
    );

    target.appendChild(
      jiraBox
    );
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
    return judgements.some(
      j =>
        !!j.judgement &&
        j.judgement !==
          "probably_harmless"
    );
  });

  if (domIssues.length) {
    const box =
      document.createElement(
        "div"
      );

    box.className =
      "card";

    box.innerHTML =
      "<h3>Reviewed DOM differences</h3>" +
      '<div class="muted small">Open a difference to compare the deterministic evidence with the model review.</div>';

    box.appendChild(
      domDiffTable(
        domIssues,
        domJudgements
      )
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
      runtimeLinkBatchSize();

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

    const findingBatches =
      cfg.triageFindings
        ? findings.flatMap(
            issue =>
              findingReviewBatches(
                issue
              )
          )
        : [];

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
      runtimeDomBatchSize();

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
          ? findingBatches.length
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
        cmsContext:
          domDiff?.cmsContext ||
          null,
        destinationVerification:
          domDiff?.destinationVerification ||
          null,
        items:
          diffItems,
        assessments: []
      },

      urlConsistency: [],
      linkResponses:
        snapshot.linkResponseChecks ||
        null,
      indexabilitySignals:
        snapshot.indexabilitySignals ||
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
        label
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
            inputLinks:
              batch,
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
            `Reviewing links · ${providerReviewLabel(provider, "link_group")}`
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
            `Identifying page type · ${providerReviewLabel(provider, "page_type")}`
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
            `Identifying intent · ${providerReviewLabel(provider, "intent")}`
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
              `Reviewing page and intent alignment · ${providerReviewLabel(provider, "alignment")}`
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
        const batch
        of findingBatches
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
                issue:
                  batch.issue,
                context:
                  pageContextForIssue(
                    batch.issue
                  )
              }
            );

          report.falsePositives.push({
            issue: {
              code:
                batch.issue.code,
              message:
                batch.issue.message
            },
            batch:
              batch.batch,
            batchCount:
              batch.batchCount,
            itemStart:
              batch.itemStart,
            itemEnd:
              batch.itemEnd,
            totalItems:
              batch.totalItems,
            inputExamples:
              Array.isArray(
                batch.issue
                  ?.deterministicValue
                  ?.examples
              )
                ? batch.issue
                    .deterministicValue
                    .examples
                : Array.isArray(
                    batch.issue
                      ?.deterministicValue
                  )
                  ? batch.issue
                      .deterministicValue
                  : [],
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
                batch.issue.code,
              batch:
                batch.batch,
              provider,
              error:
                call.error
            });
          }

          bump(
            `Reviewing findings · ${providerReviewLabel(provider, "false_positive")}`
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
          const domTask =
            provider === "nano"
              ? "dom_diff_summary"
              : "dom_diff_triage";

          const call =
            await runTaskSilent(
              domTask,
              provider,
              {
                items:
                  batch,
                cmsContext:
                  domDiff?.cmsContext ||
                  null
              }
            );

          report
            .domDiff
            .assessments
            .push({
              batch:
                batchIndex + 1,
              provider,
              task:
                domTask,
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
            `Reviewing DOM differences · ${providerReviewLabel(provider, provider === "nano" ? "dom_diff_summary" : "dom_diff_triage")}`
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
          `Reviewing URL and locale signals · ${providerReviewLabel(provider, "url_consistency")}`
        );
      }
    }

    renderIssues();
    renderDomDiffSummary();
    renderUrlSignals();
    renderPassedChecks();

    lastAnalyseAllReport =
      report;

    renderDomDiffBatches();

    renderAnalyseAllResults(
      report
    );

    setAnalyseAllProgress(
      100,
      report.errors.length
        ? `Analysis complete with ${report.errors.length} incomplete step${report.errors.length === 1 ? "" : "s"}`
        : "Analysis complete"
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
bindMainTabs();
  initialiseBatchControls();

  const ctx = await sw({type: "GET_LAST_CONTEXT"});

  snapshot = ctx?.snapshot || null;
  analysisRun = ctx?.analysisRun || null;
  domDiff =
    snapshot?.domDiff ||
    null;

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
    domDiff = null;
    domDiffBatchReviews.clear();
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

    const domBatches =
      $("#domDiffBatches");

    if (domBatches) {
      domBatches.innerHTML = "";
    }

    setStatus("");
  } catch (e) {
    setStatus(
      e?.message || String(e),
      true
    );
  }
};

$("#helpBtn").onclick = () =>
  chrome.tabs.create({
    url: chrome.runtime.getURL("help.html")
  });

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

$("#alignmentBtn").onclick =
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
        e?.message ||
        String(e),
        true
      );
    }

    const providers =
      enabledProviders();

    if (!providers.length) {
      return setStatus(
        "Choose at least one model.",
        true
      );
    }

    const target =
      $("#intentResults");

    const button =
      $("#alignmentBtn");

    target.innerHTML = "";

    if (button) {
      button.disabled =
        true;
      button.textContent =
        "Reviewing…";
    }

    try {
      for (
      const mode
      of modesToRun()
    ) {
      for (
        const provider
        of providers
      ) {
        setStatus(
          `Identifying page type · ${providerReviewLabel(provider, "page_type")}…`
        );

        const pageType =
          await runTaskSilent(
            "page_type",
            provider,
            {
              snapshot
            },
            mode
          );

        if (!pageType.ok) {
          const error =
            document.createElement(
              "div"
            );

          error.className =
            "card result-card error-card";

          error.innerHTML =
            `<div class="result-provider">${escapeHtml(providerReviewLabel(provider, "page_type"))}</div><div class="result-copy">Could not identify page type: ${escapeHtml(pageType.error)}</div>`;

          target.appendChild(
            error
          );

          continue;
        }

        setStatus(
          `Identifying intent · ${providerReviewLabel(provider, "intent")}…`
        );

        const intent =
          await runTaskSilent(
            "intent",
            provider,
            {
              snapshot
            },
            mode
          );

        if (!intent.ok) {
          const error =
            document.createElement(
              "div"
            );

          error.className =
            "card result-card error-card";

          error.innerHTML =
            `<div class="result-provider">${escapeHtml(providerReviewLabel(provider, "intent"))}</div><div class="result-copy">Could not identify intent: ${escapeHtml(intent.error)}</div>`;

          target.appendChild(
            error
          );

          continue;
        }

        setStatus(
          `Reviewing page and intent alignment · ${providerReviewLabel(provider, "alignment")}…`
        );

        const alignment =
          await runTaskSilent(
            "alignment",
            provider,
            {
              snapshot,
              pageTypeResult:
                pageType.result,
              intentResult:
                intent.result
            },
            mode
          );

        if (!alignment.ok) {
          const error =
            document.createElement(
              "div"
            );

          error.className =
            "card result-card error-card";

          error.innerHTML =
            `<div class="result-provider">${escapeHtml(providerReviewLabel(provider, "alignment"))}</div><div class="result-copy">Could not review alignment: ${escapeHtml(alignment.error)}</div>`;

          target.appendChild(
            error
          );

          continue;
        }

        const group =
          document.createElement(
            "div"
          );

        group.className =
          "alignment-workflow-group";

        group.appendChild(
          providerCard(
            "alignment",
            provider,
            alignment.result,
            mode
          )
        );

        const inputs =
          document.createElement(
            "details"
          );

        inputs.className =
          "card analyse-result-group alignment-inputs";

        inputs.innerHTML = `
          <summary>
            <span>Inputs used for alignment</span>
            <span class="summary-count">2</span>
          </summary>
          <div class="analyse-group-body">
            <div class="result-subsection">
              <div class="result-label">Page type</div>
              ${taskResultHtml("page_type", pageType.result)}
            </div>
            <div class="result-subsection">
              <div class="result-label">Intent</div>
              ${taskResultHtml("intent", intent.result)}
            </div>
          </div>
        `;

        group.appendChild(
          inputs
        );

        target.appendChild(
          group
        );
      }
    }
    } finally {
      if (button) {
        button.disabled =
          false;
        button.textContent =
          "Review alignment";
      }

      setStatus("");
    }
  };

$("#classifyLinksBtn").onclick =
  async () => {
    if (
      linkClassificationRunning
    ) {
      return;
    }

    if (!snapshot) {
      return setStatus(
        "Read the page first.",
        true
      );
    }

    const button =
      $("#classifyLinksBtn");

    const originalLabel =
      button?.textContent ||
      "Review next links";

    try {
      linkClassificationRunning =
        true;

      if (button) {
        button.disabled =
          true;

        button.textContent =
          "Reviewing…";
      }

      await ensureFullSnapshot();

      if (
        !enabledProviders().length
      ) {
        return setStatus(
          "Choose at least one model.",
          true
        );
      }

      const max =
        settings.limits
          .maxLinksForClassification;

      const pool =
        snapshot.links.slice(
          0,
          max
        );

      if (!pool.length) {
        return setStatus(
          "No HTTP(S) links found on this page.",
          true
        );
      }

      if (
        linkCursor >=
        pool.length
      ) {
        linkCursor = 0;
      }

      const batchStart =
        linkCursor;

      const batchEnd =
        Math.min(
          batchStart +
            runtimeLinkBatchSize(),
          pool.length
        );

      const batch =
        pool
          .slice(
            batchStart,
            batchEnd
          )
          .map(
            link => ({
              id:
                link.id,
              href:
                link.href,
              internal:
                link.internal,
              anchor:
                link.anchor,
              rel:
                link.rel,
              zone:
                link.zone,
              context:
                link.context
            })
          );

      const batchUrls =
        [
          ...new Set(
            batch
              .map(
                link =>
                  link.href
              )
              .filter(
                href =>
                  /^https?:\/\//i.test(
                    href ||
                    ""
                  )
              )
          )
        ];

      $("#linkProgress")
        .textContent =
          `Checking responses and reviewing links ${batchStart + 1}–${batchEnd} of ${pool.length}…`;

      let responseResult =
        null;

      try {
        responseResult =
          await checkLinkResponsesForUrls(
            batchUrls,
            {
              reset:
                false,
              updateSummary:
                true
            }
          );
      } catch (e) {
        responseResult =
          null;
      }

      const batchUrlSet =
        new Set(
          batchUrls
        );

      const batchResponses =
        (
          responseResult
            ?.results ||
          []
        ).filter(
          result =>
            batchUrlSet.has(
              result.requestedUrl
            )
        );

      $("#linkResults")
        .innerHTML =
          "";

      const runSummary =
        await runAcross(
          "link_group",
          {
            links:
              batch
          },
          $("#linkResults"),
          null,
          {
            links:
              batch,
            linkResponses:
              batchResponses
          }
        );

      if (
        runSummary
          ?.successCount >
        0
      ) {
        linkCursor =
          batchEnd;

        const responseNote =
          responseResult
            ? ` HTTP responses checked for ${batchResponses.length} unique destination${batchResponses.length === 1 ? "" : "s"}.`
            : " HTTP response checks were skipped because destination access was not granted.";

        $("#linkProgress")
          .textContent =
            linkCursor >=
              pool.length
              ? `Reviewed links ${batchStart + 1}–${batchEnd} of ${pool.length}.${responseNote} All links reviewed; the next click starts again from link 1.`
              : `Reviewed links ${batchStart + 1}–${batchEnd} of ${pool.length}.${responseNote} Next batch starts at link ${linkCursor + 1}.`;
      } else {
        $("#linkProgress")
          .textContent =
            `Links ${batchStart + 1}–${batchEnd} were not completed. The same batch will be retried next time.`;

        setStatus(
          "Link review did not complete for any selected model.",
          true
        );
      }
    } catch (e) {
      setStatus(
        e?.message ||
        String(e),
        true
      );
    } finally {
      linkClassificationRunning =
        false;

      if (button) {
        button.disabled =
          false;

        button.textContent =
          originalLabel;
      }
    }
  };

$("#checkIndexabilityBtn").onclick = async () => {
  if (!snapshot) {
    return setStatus(
      "Read the page first.",
      true
    );
  }

  const button =
    $("#checkIndexabilityBtn");

  try {
    await ensureFullSnapshot();

    const origins =
      new Set();

    for (
      const value
      of [
        snapshot.url,
        snapshot.canonicals?.[0]
      ]
    ) {
      if (!value) continue;

      try {
        origins.add(
          `${new URL(value, snapshot.url).origin}/*`
        );
      } catch {}
    }

    const requestedOrigins =
      [...origins];

    if (
      requestedOrigins.length
    ) {
      const granted =
        await chrome.permissions
          .request({
            origins:
              requestedOrigins
          });

      if (!granted) {
        return setStatus(
          "The HTTP / robots check needs temporary access to the page and canonical target origins.",
          true
        );
      }
    }

    button.disabled =
      true;

    setStatus(
      "Checking HTTP headers, server HTML, robots.txt and canonical target…"
    );

    const result =
      await sw({
        type:
          "CHECK_INDEXABILITY_SIGNALS",
        payload: {
          url:
            snapshot.url,
          canonicals:
            snapshot.canonicals ||
            [],
          canonicalRawHrefs:
            snapshot.canonicalRawHrefs ||
            [],
          robots:
            snapshot.robots ||
            "",
          robotsMetaValues:
            snapshot.robotsMetaValues ||
            [],
          googlebotMetaValues:
            snapshot.googlebotMetaValues ||
            []
        }
      });

    snapshot.indexabilitySignals =
      result;

    $("#indexabilityResults")
      .innerHTML =
        indexabilityResultsHtml(
          result
        );

    if (
      lastAnalyseAllReport
    ) {
      lastAnalyseAllReport
        .indexabilitySignals =
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
    if (button) {
      button.disabled =
        false;
    }
  }
};


$("#checkLinkResponsesBtn").onclick = async () => {
  if (!snapshot) {
    return setStatus(
      "Read the page first.",
      true
    );
  }

  const button =
    $("#checkLinkResponsesBtn");

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
                  href ||
                  ""
                )
            )
        )
      ];

    if (!urls.length) {
      return setStatus(
        "No HTTP(S) links were found to check.",
        true
      );
    }

    const origins =
      [
        ...new Set(
          urls
            .map(
              url => {
                try {
                  return `${new URL(url).origin}/*`;
                } catch {
                  return null;
                }
              }
            )
            .filter(Boolean)
        )
      ];

    if (!origins.length) {
      return setStatus(
        "No valid HTTP(S) link origins were found to check.",
        true
      );
    }

    const granted =
      await chrome.permissions
        .request({
          origins
        });

    if (!granted) {
      return setStatus(
        "Link response checking needs temporary access to the link origins being checked.",
        true
      );
    }

    button.disabled =
      true;

    const batchSize =
      Math.max(
        1,
        settings.limits
          .maxLinkResponseChecks ||
          100
      );

    let combined =
      null;

    for (
      let start = 0;
      start < urls.length;
      start += batchSize
    ) {
      const end =
        Math.min(
          start +
            batchSize,
          urls.length
        );

      setStatus(
        `Checking link responses ${start + 1}–${end} of ${urls.length}…`
      );

      combined =
        await sw({
          type:
            "CHECK_LINK_RESPONSES",
          urls:
            urls.slice(
              start,
              end
            ),
          reset:
            start === 0
        });

      snapshot.linkResponseChecks =
        combined;

      $("#linkResponseResults")
        .innerHTML =
          linkResponseResultsHtml(
            combined
          );
    }

    if (
      lastAnalyseAllReport
    ) {
      lastAnalyseAllReport
        .linkResponses =
          combined;

      renderAnalyseAllResults(
        lastAnalyseAllReport
      );
    }

    setStatus(
      `Checked all ${urls.length} unique link destinations.`
    );

    setTimeout(
      () =>
        setStatus(""),
      1800
    );
  } catch (e) {
    setStatus(
      e?.message ||
      String(e),
      true
    );
  } finally {
    if (button) {
      button.disabled =
        false;
    }
  }
};

$("#downloadDomDiffDebugBtn").onclick =
  async () => {
    try {
      const debug =
        await sw({
          type:
            "GET_DOM_DIFF_DEBUG"
        });

      if (!debug) {
        return setStatus(
          "Run DOM comparison first.",
          true
        );
      }

      const blob =
        new Blob(
          [
            JSON.stringify(
              debug,
              null,
              2
            )
          ],
          {
            type:
              "application/json"
          }
        );

      const url =
        URL.createObjectURL(
          blob
        );

      const a =
        document.createElement(
          "a"
        );

      a.href =
        url;

      a.download =
        `nano-dom-diff-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

      a.click();

      setTimeout(
        () =>
          URL.revokeObjectURL(
            url
          ),
        1000
      );

      setStatus(
        "Unfiltered DOM diff downloaded."
      );
    } catch (e) {
      setStatus(
        e?.message ||
        String(e),
        true
      );
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

  
      if (snapshot) {
        snapshot.domDiff =
          domDiff;
      }

      domDiffBatchReviews.clear();

      renderDomDiffSummary();

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
