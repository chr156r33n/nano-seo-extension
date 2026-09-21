
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
}

function render() {
  app.innerHTML = `
    <section>
      <h2>Providers</h2>

      <div class="grid">
        <div>
          <label class="block">
            <input id="nanoEnabled" type="checkbox" ${current.providers.nano.enabled ? "checked" : ""}>
            Nano enabled by default
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
            Gemini API enabled by default
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
            OpenAI API enabled by default
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
      <h2>Limits</h2>

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
      <h2>Analyse all</h2>

      <p class="muted">
        Choose which model-assisted stages run when you click Analyse all. Deterministic page capture always runs.
        Alignment only runs when both Page type and Intent are enabled.
      </p>

      <div class="grid">
        ${[
          ["linkContext", "Link context classification"],
          ["pageType", "Page type"],
          ["intent", "Intent"],
          ["alignment", "Page type ↔ intent alignment"],
          ["triageFindings", "Triage deterministic findings"],
          ["domDiff", "Server HTML ↔ rendered DOM diff"],
          ["urlConsistency", "URL / locale consistency"]
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
        DOM diff defaults to off because it performs an extra same-origin refetch and is better treated as a deliberate rendering test than an every-page check.
      </p>
    </section>

    <section>
      <h2>Semantic importance</h2>

      <p class="muted">
        Shared guidance used by page type, intent, false-positive, DOM-diff and URL-consistency judgements.
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
      <h2>Hreflang agreed values</h2>

      <p class="muted">
        One value per line. Leave empty to skip agreed-list validation. No reciprocal crawling is performed.
      </p>

      <textarea id="hreflangAgreedValues" placeholder="en-GB&#10;en-US&#10;fr-FR&#10;x-default">${(current.hreflangAgreedValues || []).join("\n")}</textarea>
    </section>

    <section>
      <h2>Prompts</h2>

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
      <h2>False-positive guidance</h2>

      <p class="muted">
        Only the guidance for the finding being triaged is added to the model input.
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

      msg("Saved.");
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
        msg("Cache cleared.");
      }
    };

load();
