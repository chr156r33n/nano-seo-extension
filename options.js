
let current;

const app =
  document.querySelector("#app");

const esc = s =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

async function load() {
  const {settings} =
    await chrome.storage.local.get(
      "settings"
    );

  current =
    mergeSettings(settings);

  render();
  bindHreflangReferenceActions();
}

function bindHreflangReferenceActions() {
  const loadAll =
    document.querySelector(
      "#loadAllLanguageHreflangs"
    );

  if (loadAll) {
    loadAll.onclick =
      () => {
        const textarea =
          document.querySelector(
            "#hreflangAgreedValues"
          );

        textarea.value =
          [
            ...HREFLANG_LANGUAGE_CODES,
            "x-default"
          ].join("\n");
      };
  }

  const addXDefault =
    document.querySelector(
      "#appendXDefaultHreflang"
    );

  if (addXDefault) {
    addXDefault.onclick =
      () => {
        const textarea =
          document.querySelector(
            "#hreflangAgreedValues"
          );

        const values =
          textarea.value
            .split(/\r?\n|,/)
            .map(
              value =>
                value.trim()
            )
            .filter(Boolean);

        if (
          !values.some(
            value =>
              value.toLowerCase() ===
              "x-default"
          )
        ) {
          values.push(
            "x-default"
          );
        }

        textarea.value =
          values.join("\n");
      };
  }
}

function render() {
  app.innerHTML = `
    <section>
      <div class="section-kicker">Models</div><h2>Choose models</h2>

      <div class="grid">
        <div>
          <label class="block">
            <input id="nanoEnabled" type="checkbox" ${current.providers.nano.enabled ? "checked" : ""}>
            Use Nano by default
          </label>

          <label class="block">
            Nano temperature
            <input id="nanoTemp" type="number" step="0.1" value="${current.providers.nano.temperature}">
          </label>

          <label class="block">
            Nano topK
            <input id="nanoTopK" type="number" value="${current.providers.nano.topK}">
          </label>
        </div>

        <div>
          <label class="block">
            <input id="geminiEnabled" type="checkbox" ${current.providers.gemini.enabled ? "checked" : ""}>
            Use Gemini API by default
          </label>

          <label class="block">
            Gemini model
            <input id="geminiModel" type="text" value="${esc(current.providers.gemini.model)}">
          </label>

          <label class="block">
            Gemini API key
            <input id="geminiKey" type="password" value="${esc(current.providers.gemini.apiKey)}">
          </label>

          <label class="block">
            <input id="openaiEnabled" type="checkbox" ${current.providers.openai.enabled ? "checked" : ""}>
            Use OpenAI API by default
          </label>

          <label class="block">
            OpenAI model
            <input id="openaiModel" type="text" value="${esc(current.providers.openai.model)}">
          </label>

          <label class="block">
            OpenAI API key
            <input id="openaiKey" type="password" value="${esc(current.providers.openai.apiKey)}">
          </label>
        </div>
      </div>
    </section>

    <section>
      <div class="section-kicker">Performance</div><h2>Processing limits</h2>

      <div class="grid">
        ${Object.entries(current.limits)
          .map(
            ([k, v]) =>
              `<label class="block">${k}<input data-limit="${k}" type="number" value="${v}"></label>`
          )
          .join("")}
      </div>
    </section>

    <section>
      <div class="section-kicker">Quick run</div><h2>Run analysis</h2>

      <p class="muted">
        Choose which stages run when you click Run analysis. Reading the page and running the automated checks always happens first.
        Alignment only runs when both Page type and Intent are enabled.
      </p>

      <div class="grid">
        ${[
          ["linkContext", "Understand link roles"],
          ["pageType", "Page type"],
          ["intent", "Intent"],
          ["alignment", "Check page type ↔ intent alignment"],
          ["triageFindings", "Review flagged checks with model context"],
          ["domDiff", "Compare server HTML with rendered page"],
          ["urlConsistency", "Review URL and locale signals"]
        ]
          .map(
            ([key, label]) => `
              <label class="block">
                <input
                  data-analyse-all="${key}"
                  type="checkbox"
                  ${current.analyseAll?.[key] ? "checked" : ""}
                >
                ${label}
              </label>
            `
          )
          .join("")}
      </div>

      <p class="muted small">
        Server/rendered comparison defaults to off because it makes an extra same-origin request and is best used as a deliberate rendering test.
      </p>
    </section>

    <section>
      <div class="section-kicker">Evidence weighting</div><h2>Semantic importance</h2>

      <p class="muted">
        Shared guidance that tells models which parts of the page matter most when making contextual judgements.
      </p>

      <label class="block">
        Global semantic-importance guidance
        <textarea id="semanticImportanceGuidance">${current.semanticImportanceGuidance}</textarea>
      </label>

      <div class="grid">
        ${Object.entries(current.semanticWeights)
          .map(
            ([k, v]) =>
              `<label class="block">${k}<input data-semantic-weight="${k}" type="number" step="0.05" value="${v}"></label>`
          )
          .join("")}
      </div>
    </section>

    <section>
      <div class="section-kicker">Locales</div><h2>Agreed hreflang values</h2>

      <p class="muted">
        One value per line. This remains the project-specific allow-list used for validation.
      </p>

      <textarea id="hreflangAgreedValues" placeholder="en-GB&#10;en-US&#10;fr-FR&#10;x-default">${(current.hreflangAgreedValues || []).join("\n")}</textarea>

      <div class="card" style="margin-top:14px">
        <h3>Hreflang reference</h3>
        <p class="muted small">
          Complete ISO 639-1 language-only reference (${HREFLANG_LANGUAGE_CODES.length} codes), plus x-default and some common region/script examples.
          Region and script variants are combinations rather than a finite global list, so they are shown as examples rather than auto-approved values.
        </p>

        <div class="row" style="margin:10px 0">
          <button id="loadAllLanguageHreflangs" class="secondary" type="button">
            Load all language-only values
          </button>
          <button id="appendXDefaultHreflang" class="secondary" type="button">
            Add x-default
          </button>
        </div>

        <details class="control-panel">
          <summary>Show all language codes</summary>
          <div class="control-panel-body">
            <pre>${HREFLANG_LANGUAGE_CODES.join("\n")}</pre>
          </div>
        </details>

        <details class="control-panel">
          <summary>Show all region codes</summary>
          <div class="control-panel-body">
            <pre>${HREFLANG_REGION_CODES.join("\n")}</pre>
          </div>
        </details>

        <details class="control-panel">
          <summary>Common region / script examples</summary>
          <div class="control-panel-body">
            <pre>${HREFLANG_SPECIAL_EXAMPLES.join("\n")}</pre>
          </div>
        </details>
      </div>
    </section>

    <section>
      <div class="section-kicker">Advanced</div><h2>Model prompts</h2>

      ${Object.entries(current.prompts)
        .map(
          ([task, p]) => `
            <div class="card">
              <h3>${task}</h3>

              <label class="block">
                System prompt
                <textarea data-prompt="${task}" data-part="system">${p.system}</textarea>
              </label>

              <label class="block">
                User prompt template
                <textarea data-prompt="${task}" data-part="user">${p.user}</textarea>
              </label>
            </div>
          `
        )
        .join("")}
    </section>

    <section>
      <div class="section-kicker">Advanced</div><h2>Finding-specific guidance</h2>

      <p class="muted">
        Only the guidance for the finding being reviewed is added to that model call.
      </p>

      ${Object.entries(current.falsePositiveGuidance)
        .map(
          ([code, guidance]) => `
            <div class="card">
              <h3>${code}</h3>

              <textarea data-guidance="${code}">${guidance}</textarea>
            </div>
          `
        )
        .join("")}
    </section>
  `;
}

function collect() {
  current.providers.nano.enabled =
    document.querySelector(
      "#nanoEnabled"
    ).checked;

  current.providers.nano.temperature =
    +document.querySelector(
      "#nanoTemp"
    ).value;

  current.providers.nano.topK =
    +document.querySelector(
      "#nanoTopK"
    ).value;

  current.providers.gemini.enabled =
    document.querySelector(
      "#geminiEnabled"
    ).checked;

  current.providers.gemini.model =
    document.querySelector(
      "#geminiModel"
    ).value.trim();

  current.providers.gemini.apiKey =
    document.querySelector(
      "#geminiKey"
    ).value.trim();

  current.providers.openai.enabled =
    document.querySelector(
      "#openaiEnabled"
    ).checked;

  current.providers.openai.model =
    document.querySelector(
      "#openaiModel"
    ).value.trim();

  current.providers.openai.apiKey =
    document.querySelector(
      "#openaiKey"
    ).value.trim();

  document
    .querySelectorAll(
      "[data-limit]"
    )
    .forEach(
      x =>
        current.limits[
          x.dataset.limit
        ] = +x.value
    );

  document
    .querySelectorAll(
      "[data-analyse-all]"
    )
    .forEach(
      x =>
        current.analyseAll[
          x.dataset.analyseAll
        ] = x.checked
    );

  current.semanticImportanceGuidance =
    document.querySelector(
      "#semanticImportanceGuidance"
    ).value;

  document
    .querySelectorAll(
      "[data-semantic-weight]"
    )
    .forEach(
      x =>
        current.semanticWeights[
          x.dataset.semanticWeight
        ] = +x.value
    );

  current.hreflangAgreedValues =
    document.querySelector(
      "#hreflangAgreedValues"
    )
      .value
      .split(/\r?\n|,/)
      .map(x => x.trim())
      .filter(Boolean);

  document
    .querySelectorAll(
      "[data-prompt]"
    )
    .forEach(
      x =>
        current.prompts[
          x.dataset.prompt
        ][
          x.dataset.part
        ] = x.value
    );

  document
    .querySelectorAll(
      "[data-guidance]"
    )
    .forEach(
      x =>
        current.falsePositiveGuidance[
          x.dataset.guidance
        ] = x.value
    );
}

function msg(t) {
  const e =
    document.querySelector(
      "#msg"
    );

  e.textContent = t;
  e.style.display =
    "block";

  setTimeout(
    () =>
      e.style.display =
        "none",
    1800
  );
}

document
  .querySelector(
    "#saveBtn"
  )
  .onclick =
    async () => {
      collect();

      await chrome.storage.local.set({
        settings: current
      });

      msg("Settings saved.");
    };

document
  .querySelector(
    "#resetBtn"
  )
  .onclick =
    async () => {
      current =
        structuredClone(
          DEFAULT_SETTINGS
        );

      await chrome.storage.local.set({
        settings: current
      });

      render();
      bindHreflangReferenceActions();
      msg("Defaults restored.");
    };

document
  .querySelector(
    "#clearCacheBtn"
  )
  .onclick =
    async () => {
      const r =
        await chrome.runtime.sendMessage({
          type:
            "CLEAR_CACHE"
        });

      if (r?.ok) {
        msg("Saved model results cleared.");
      }
    };

load();
