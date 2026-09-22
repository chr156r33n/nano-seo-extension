let rows = [];

async function sw(msg) {
  const r =
    await chrome.runtime.sendMessage(
      msg
    );

  if (!r?.ok) {
    throw new Error(
      r?.error ||
      "failed"
    );
  }

  return r.value;
}

function esc(s) {
  return String(
    s ?? ""
  ).replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c])
  );
}

function pretty(value) {
  return esc(
    JSON.stringify(
      value,
      null,
      2
    )
  );
}

function timingHtml(run) {
  const timing =
    run.meta?.timing ||
    {};

  const chips = [
    Number.isFinite(
      timing.sessionCreateMs
    )
      ? `create ${timing.sessionCreateMs}ms`
      : Number.isFinite(
          timing.baseSessionCreateMs
        )
        ? `create ${timing.baseSessionCreateMs}ms`
        : "",
    Number.isFinite(
      timing.cloneMs
    ) &&
    timing.cloneMs > 0
      ? `clone ${timing.cloneMs}ms`
      : "",
    Number.isFinite(
      timing.promptMs
    )
      ? `prompt ${timing.promptMs}ms`
      : "",
    Number.isFinite(
      timing.parseMs
    ) &&
    timing.parseMs > 0
      ? `parse ${timing.parseMs}ms`
      : ""
  ].filter(Boolean);

  return chips.length
    ? `<div class="chip-row" style="margin-top:7px">${chips
        .map(
          chip =>
            `<span class="mini-chip">${esc(chip)}</span>`
        )
        .join("")}</div>`
    : "";
}

function sourceHtml(run) {
  const source =
    run.source ||
    {};

  const bits = [
    source.url,
    source.pageFingerprint
      ? `fingerprint ${source.pageFingerprint}`
      : "",
    source.analysisRunId
      ? `run ${source.analysisRunId}`
      : ""
  ].filter(Boolean);

  return bits.length
    ? `<div class="muted small" style="margin-top:6px">${bits
        .map(esc)
        .join(" · ")}</div>`
    : "";
}

function renderRun(run) {
  const output =
    run.output ?? null;

  return `
    <details class="card">
      <summary>
        <strong>${esc(run.task)}</strong>
        · ${esc(run.provider)}
        · ${esc(run.model)}
        · ${run.cacheHit ? "cache" : `${run.durationMs}ms`}
        · ${esc(run.createdAt)}
        ${run.error ? " · ERROR" : ""}
      </summary>

      ${timingHtml(run)}
      ${sourceHtml(run)}

      ${run.error
        ? `<div class="result-copy" style="margin-top:10px"><strong>Error:</strong> ${esc(run.error)}</div>`
        : ""}

      <div class="result-subsection">
        <div class="result-label">Output</div>
        <pre>${pretty(output)}</pre>
      </div>

      <details class="raw-json" style="margin-top:10px">
        <summary>Prompt and schema</summary>
        <div class="result-subsection">
          <div class="result-label">System</div>
          <pre>${esc(run.system || "")}</pre>
        </div>
        <div class="result-subsection">
          <div class="result-label">Prompt</div>
          <pre>${esc(run.prompt || "")}</pre>
        </div>
        <div class="result-subsection">
          <div class="result-label">Schema</div>
          <pre>${pretty(run.schema || null)}</pre>
        </div>
      </details>

      <details class="raw-json">
        <summary>Provider metadata</summary>
        <pre>${pretty(run.meta || null)}</pre>
      </details>
    </details>
  `;
}

async function load() {
  rows =
    await sw({
      type:
        "GET_RUNS",
      limit:
        1000
    });

  const providers = {};

  for (
    const r
    of rows
  ) {
    providers[r.provider] =
      (
        providers[
          r.provider
        ] ||
        0
      ) + 1;
  }

  document
    .querySelector(
      "#stats"
    )
    .innerHTML =
      `<p><strong>${rows.length}</strong> calls · ${Object.entries(providers)
        .map(
          ([k, v]) =>
            `${esc(k)}: ${v}`
        )
        .join(" · ")}</p>`;

  document
    .querySelector(
      "#runs"
    )
    .innerHTML =
      rows.length
        ? rows
            .map(
              renderRun
            )
            .join("")
        : '<div class="muted">No model calls yet.</div>';
}

document
  .querySelector(
    "#refreshBtn"
  )
  .onclick =
    load;

document
  .querySelector(
    "#downloadBtn"
  )
  .onclick =
    () => {
      const b =
        new Blob(
          [
            JSON.stringify(
              rows,
              null,
              2
            )
          ],
          {
            type:
              "application/json"
          }
        );

      const u =
        URL.createObjectURL(
          b
        );

      const a =
        document.createElement(
          "a"
        );

      a.href = u;

      a.download =
        "nano-seo-lab-runs.json";

      a.click();

      setTimeout(
        () =>
          URL.revokeObjectURL(
            u
          ),
        1000
      );
    };

document
  .querySelector(
    "#clearBtn"
  )
  .onclick =
    async () => {
      await sw({
        type:
          "CLEAR_LOGS"
      });

      await load();
    };

load();
