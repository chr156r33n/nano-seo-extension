
let rows = [];

async function sw(msg) {
  const r =
    await chrome.runtime.sendMessage(
      msg
    );

  if (!r?.ok) {
    throw new Error(
      r?.error || "failed"
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

function taskSummary(run) {
  const out = [];

  for (
    const [task, value]
    of Object.entries(
      run.tasks || {}
    )
  ) {
    if (
      !value ||
      typeof value !== "object"
    ) {
      continue;
    }

    if (
      [
        "page_type",
        "intent",
        "alignment"
      ].includes(task)
    ) {
      const modes =
        Object.entries(value)
          .map(
            ([mode, providers]) =>
              `${mode}: ${Object.keys(providers || {}).join(", ") || "none"}`
          );

      out.push(
        `${task} (${modes.join(" | ")})`
      );
    } else {
      out.push(
        `${task} (${Object.keys(value).join(", ") || "none"})`
      );
    }
  }

  return out.length
    ? out.join(" · ")
    : "No model tasks run";
}

function renderRun(run) {
  const providers =
    new Set();

  const collectProviders = (
    task,
    value
  ) => {
    if (
      !value ||
      typeof value !== "object"
    ) {
      return;
    }

    if (
      [
        "page_type",
        "intent",
        "alignment"
      ].includes(task)
    ) {
      for (
        const providerMap
        of Object.values(value)
      ) {
        Object.keys(
          providerMap || {}
        ).forEach(
          p =>
            providers.add(p)
        );
      }

      return;
    }

    Object.keys(value)
      .forEach(
        p =>
          providers.add(p)
      );
  };

  for (
    const [task, value]
    of Object.entries(
      run.tasks || {}
    )
  ) {
    collectProviders(
      task,
      value
    );
  }

  const domSummary =
    run.domDiff?.summary;

  return `
    <details class="card">
      <summary>
        <strong>${esc(new Date(run.startedAt).toLocaleString())}</strong>
        · ${esc(run.title || "(untitled)")}
        · ${esc(run.url)}
      </summary>

      <div class="small muted" style="margin:8px 0">
        run ${esc(run.id)}<br>
        fingerprint ${esc(run.pageFingerprint)}<br>
        checks: ${run.checks?.total ?? 0} total · ${run.checks?.passed ?? 0} passed · ${run.checks?.findings ?? 0} findings<br>
        providers: ${esc([...providers].join(", ") || "none")}<br>
        tasks: ${esc(taskSummary(run))}<br>
        DOM diff: ${
          domSummary
            ? `${domSummary.totalDiffItems ?? 0} total · ${domSummary.returnedDiffItems ?? 0} retained`
            : "not run"
        }
      </div>

      <pre>${esc(JSON.stringify(run, null, 2))}</pre>
    </details>
  `;
}

async function load() {
  rows =
    await sw({
      type:
        "GET_ANALYSIS_RUNS",
      limit: 1000
    });

  document
    .querySelector(
      "#summary"
    )
    .innerHTML =
      `<p><strong>${rows.length}</strong> analysis runs</p>`;

  document
    .querySelector(
      "#history"
    )
    .innerHTML =
      rows.length
        ? rows
            .map(renderRun)
            .join("")
        : '<div class="muted">No analysis runs yet.</div>';
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
        `nano-seo-lab-history-${new Date().toISOString().slice(0, 10)}.json`;

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
          "CLEAR_ANALYSIS_HISTORY"
      });

      await load();
    };

load();
