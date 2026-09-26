
let current;
let allowAllWebsites = false;

const ALL_WEBSITE_ORIGINS = [
  "http://*/*",
  "https://*/*"
];

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

  allowAllWebsites =
    await chrome.permissions
      .contains({
        origins:
          ALL_WEBSITE_ORIGINS
      });

  render();
  bindHreflangReferenceActions();
  bindWebsiteAccessActions();
}

function bindHreflangReferenceActions() {
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

function bindWebsiteAccessActions() {
  const toggle =
    document.querySelector(
      "#allowAllWebsites"
    );

  const status =
    document.querySelector(
      "#websiteAccessStatus"
    );

  if (!toggle) {
    return;
  }

  const updateStatus =
    () => {
      if (!status) {
        return;
      }

      status.textContent =
        allowAllWebsites
          ? "Persistent access is enabled for ordinary HTTP and HTTPS pages."
          : "Using on-demand page access. Open Nano SEO Lab from the toolbar on pages that have not been granted access.";
    };

  updateStatus();

  toggle.onchange =
    async () => {
      if (
        toggle.checked
      ) {
        const granted =
          await chrome.permissions
            .request({
              origins:
                ALL_WEBSITE_ORIGINS
            });

        allowAllWebsites =
          Boolean(
            granted
          );

        toggle.checked =
          allowAllWebsites;

        updateStatus();

        msg(
          allowAllWebsites
            ? "All-website access enabled."
            : "Website access was not granted."
        );

        return;
      }

      const removed =
        await chrome.permissions
          .remove({
            origins:
              ALL_WEBSITE_ORIGINS
          });

      allowAllWebsites =
        !removed &&
        await chrome.permissions
          .contains({
            origins:
              ALL_WEBSITE_ORIGINS
          });

      toggle.checked =
        allowAllWebsites;

      updateStatus();

      msg(
        allowAllWebsites
          ? "Website access is still enabled."
          : "All-website access disabled."
      );
    };
}

function render() {
  const exclusionCheckIds =
    [
      ...new Set([
        ...Object.keys(
          current.falsePositiveGuidance ||
          {}
        ),
        "raw_rendered_canonical_conflict",
        "http_rendered_canonical_conflict",
        "http_raw_canonical_conflict",
        "raw_rendered_robots_conflict",
        "http_html_robots_conflict",
        "current_response_non_2xx",
        "http_x_robots_noindex",
        "robots_blocks_noindex_discovery",
        "robots_txt_blocked",
        "current_response_redirect",
        "redirect_canonical_conflict",
        "canonical_target_request_error",
        "canonical_target_non_2xx",
        "canonical_target_redirect",
        "canonical_target_noindex",
        "canonical_target_canonicalises_elsewhere",
        "source_head_missing",
        "source_head_likely_break",
        "source_head_missing_close",
        "ai_crawlers_blocked"
      ])
    ]
      .sort();

  const issueProfileCodes =
    Object.keys({
      ...(current.falsePositiveGuidance || {}),
      ...(current.deterministicImpactProfiles || {})
    })
      .sort();

  app.innerHTML = `
    <div class="settings-groups">
      <details class="settings-group">
        <summary>
          <span>
            <span class="section-kicker">Models & access</span>
            <strong>Providers and page permissions</strong>
            <small>Choose default models and how the extension can access webpages.</small>
          </span>
        </summary>
        <div class="settings-group-body">
          <h2>Choose models</h2>

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

          <div class="settings-subsection">
            <h2>Page permissions</h2>
            <p class="muted">
              Nano SEO Lab normally uses Chrome's temporary page access, which means you need to invoke the extension on each tab before it can inspect that page.
            </p>

            <div class="card">
              <label class="block">
                <input id="allowAllWebsites" type="checkbox" ${allowAllWebsites ? "checked" : ""}>
                Allow all websites
              </label>

              <p class="muted small" style="margin-bottom:0">
                When enabled, Chrome grants persistent access to ordinary HTTP and HTTPS pages so Nano SEO Lab can analyse newly-opened tabs without requiring another toolbar click.
                This does not apply to protected browser pages such as chrome:// URLs.
              </p>

              <div id="websiteAccessStatus" class="small" style="margin-top:8px"></div>
            </div>
          </div>
        </div>
      </details>

      <details class="settings-group">
        <summary>
          <span>
            <span class="section-kicker">Analysis workflow</span>
            <strong>Full-page analysis and processing limits</strong>
            <small>Control what Run analysis does. Processing limits are advanced tuning controls.</small>
          </span>
        </summary>
        <div class="settings-group-body">
          <h2>Run analysis</h2>

          <p class="muted">
            Choose which stages run when you click Run analysis. Reading the page and running the automated checks always happens first.
            Alignment only runs when both Page type and Intent are enabled.
          </p>

          <p class="muted small">
            Saved settings are preserved across extension updates. New defaults only fill settings that do not already have a saved value. Use Restore defaults if you explicitly want to replace your configuration with the current bundled defaults.
          </p>

          <div class="grid">
            ${[
              ["linkContext", "Understand link roles"],
              ["pageType", "Page type"],
              ["intent", "Intent"],
              ["alignment", "Review page type ↔ intent alignment"],
              ["triageFindings", "Review findings with model context"],
              ["domDiff", "Compare server HTML with rendered page"],
              ["urlConsistency", "Review URL and page-identity signals"]
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

          <div class="settings-subsection">
            <h2>Processing limits</h2>
            <div class="grid">
              ${Object.entries(current.limits)
                .map(
                  ([k, v]) =>
                    `<label class="block">${k}<input data-limit="${k}" type="number" value="${v}"></label>`
                )
                .join("")}
            </div>
          </div>
        </div>
      </details>

      <details class="settings-group">
        <summary>
          <span>
            <span class="section-kicker">Evidence & locales</span>
            <strong>Semantic weighting and hreflang policy</strong>
            <small>Configure how page evidence is weighted and any project-specific locale allow-list.</small>
          </span>
        </summary>
        <div class="settings-group-body">
          <h2>Semantic importance</h2>

          <p class="muted">
            Shared guidance that tells models which parts of the page matter most when making contextual judgements.
          </p>

          <label class="block">
            Global semantic-importance guidance
            <textarea id="semanticImportanceGuidance">${esc(current.semanticImportanceGuidance)}</textarea>
          </label>

          <div class="grid">
            ${Object.entries(current.semanticWeights)
              .map(
                ([k, v]) =>
                  `<label class="block">${k}<input data-semantic-weight="${k}" type="number" step="0.05" value="${v}"></label>`
              )
              .join("")}
          </div>

          <div class="settings-subsection">
            <h2>Hreflang allow-list</h2>

            <p class="muted">
              One value per line. This is an optional project-specific allow-list, not a list of locales that must be present. A bare language code such as <code>es</code>, <code>pt</code>, <code>ko</code> or <code>zh</code> permits valid regional/script variants in that language family; a specific locale such as <code>en-GB</code> remains exact.
            </p>

            <textarea id="hreflangAgreedValues" placeholder="en-GB&#10;en-US&#10;fr-FR&#10;x-default">${(current.hreflangAgreedValues || []).map(esc).join("\n")}</textarea>

            <div class="row" style="margin-top:10px">
              <button id="appendXDefaultHreflang" class="secondary" type="button">
                Add x-default
              </button>
            </div>

            <details class="control-panel">
              <summary>Hreflang reference</summary>
              <div class="control-panel-body">
                <p class="muted small">
                  Valid language/region combinations such as en-GB are checked independently against language and region standards.
                </p>

                <details class="subdetails">
                  <summary>All language codes</summary>
                  <pre>${HREFLANG_LANGUAGE_CODES.join("\n")}</pre>
                </details>

                <details class="subdetails">
                  <summary>All region codes</summary>
                  <pre>${HREFLANG_REGION_CODES.join("\n")}</pre>
                </details>

                <details class="subdetails">
                  <summary>Common region / script examples</summary>
                  <pre>${HREFLANG_SPECIAL_EXAMPLES.join("\n")}</pre>
                </details>
              </div>
            </details>
          </div>
        </div>
      </details>

      <details class="settings-group">
        <summary>
          <span>
            <span class="section-kicker">Site-specific rules</span>
            <strong>Hostname check exclusions</strong>
            <small>Suppress known or non-actionable findings before model review.</small>
          </span>
        </summary>
        <div class="settings-group-body">
          <h2>Site check exclusions</h2>

          <p class="muted">
            One profile per line:
            <code>hostname | check_code, check_code | optional note</code>
          </p>

          <textarea
            id="siteCheckExclusions"
            placeholder="www.example.com | title_length, meta_description_length | CMS constraint&#10;*.example.co.uk | canonical_relative_href | known platform behaviour"
          >${(current.siteCheckExclusions || []).map(profile => [profile.hostname, (profile.checks || []).join(", "), profile.note || ""].join(" | ").replace(/ \| $/, "")).map(esc).join("\n")}</textarea>

          <p class="muted small">
            Exact hostnames and <code>*.example.com</code> wildcards are supported. Excluded checks remain visible for traceability but are not treated as findings, reviewed by a model, or added to prioritised actions.
          </p>

          <details class="control-panel">
            <summary>Available check IDs</summary>
            <div class="control-panel-body">
              <pre>${exclusionCheckIds.join("\n")}</pre>
            </div>
          </details>
        </div>
      </details>

      <details class="settings-group">
        <summary>
          <span>
            <span class="section-kicker">Issue profiles</span>
            <strong>Deterministic impact and consequence mapping</strong>
            <small>Edit baseline impact, priority and model edge-case guidance for each check.</small>
          </span>
        </summary>
        <div class="settings-group-body">
          <p class="muted">
            Only the profile for the finding being reviewed is added to that model call.
          </p>

          <div class="settings-nested-list">
            ${issueProfileCodes
              .map(
                code => {
                  const profile =
                    current.deterministicImpactProfiles?.[code] ||
                    {
                      impacts: [],
                      baselinePriority: "context-dependent",
                      consequence: ""
                    };

                  const guidance =
                    current.falsePositiveGuidance?.[code] ||
                    "";

                  return `
                    <details class="settings-nested">
                      <summary>${esc(code)}</summary>
                      <div class="settings-nested-body">
                        <label class="block">
                          Impact labels
                          <input
                            data-impact-labels="${esc(code)}"
                            value="${esc((profile.impacts || []).join(", "))}"
                            placeholder="Indexing, CTR, Accessibility"
                          >
                        </label>

                        <label class="block">
                          Baseline priority
                          <select data-impact-priority="${esc(code)}">
                            ${["low","medium","high","context-dependent"]
                              .map(
                                value =>
                                  `<option value="${value}" ${profile.baselinePriority === value ? "selected" : ""}>${value}</option>`
                              )
                              .join("")}
                          </select>
                        </label>

                        <label class="block">
                          Consequence summary
                          <textarea data-impact-consequence="${esc(code)}">${esc(profile.consequence || "")}</textarea>
                        </label>

                        <label class="block">
                          Model edge-case guidance
                          <textarea data-guidance="${esc(code)}">${esc(guidance)}</textarea>
                        </label>
                      </div>
                    </details>
                  `;
                }
              )
              .join("")}
          </div>
        </div>
      </details>

      <details class="settings-group">
        <summary>
          <span>
            <span class="section-kicker">Advanced</span>
            <strong>Model prompts</strong>
            <small>Edit task-specific system and user prompts.</small>
          </span>
        </summary>
        <div class="settings-group-body">
          <div class="settings-nested-list">
            ${Object.entries(current.prompts)
              .map(
                ([task, p]) => `
                  <details class="settings-nested">
                    <summary>${esc(task)}</summary>
                    <div class="settings-nested-body">
                      <label class="block">
                        System prompt
                        <textarea data-prompt="${esc(task)}" data-part="system">${esc(p.system)}</textarea>
                      </label>

                      <label class="block">
                        User prompt template
                        <textarea data-prompt="${esc(task)}" data-part="user">${esc(p.user)}</textarea>
                      </label>
                    </div>
                  </details>
                `
              )
              .join("")}
          </div>
        </div>
      </details>
    </div>
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

  current.siteCheckExclusions =
    document.querySelector(
      "#siteCheckExclusions"
    )
      .value
      .split(/\r?\n/)
      .map(
        line => {
          const parts =
            line
              .split("|")
              .map(
                part =>
                  part.trim()
              );

          const hostname =
            parts.shift() ||
            "";

          const checks =
            (
              parts.shift() ||
              ""
            )
              .split(",")
              .map(
                code =>
                  code.trim()
              )
              .filter(Boolean);

          const note =
            parts
              .join(" | ")
              .trim();

          return {
            hostname,
            checks,
            note
          };
        }
      )
      .filter(
        profile =>
          profile.hostname &&
          profile.checks.length
      );

  current.deterministicImpactProfiles =
    current.deterministicImpactProfiles ||
    {};

  document
    .querySelectorAll(
      "[data-impact-labels]"
    )
    .forEach(
      input => {
        const code =
          input.dataset
            .impactLabels;

        current.deterministicImpactProfiles[
          code
        ] = {
          ...(
            current.deterministicImpactProfiles[
              code
            ] ||
            {}
          ),
          impacts:
            input.value
              .split(",")
              .map(
                value =>
                  value.trim()
              )
              .filter(Boolean)
        };
      }
    );

  document
    .querySelectorAll(
      "[data-impact-priority]"
    )
    .forEach(
      input => {
        const code =
          input.dataset
            .impactPriority;

        current.deterministicImpactProfiles[
          code
        ] = {
          ...(
            current.deterministicImpactProfiles[
              code
            ] ||
            {}
          ),
          baselinePriority:
            input.value
        };
      }
    );

  document
    .querySelectorAll(
      "[data-impact-consequence]"
    )
    .forEach(
      input => {
        const code =
          input.dataset
            .impactConsequence;

        current.deterministicImpactProfiles[
          code
        ] = {
          ...(
            current.deterministicImpactProfiles[
              code
            ] ||
            {}
          ),
          consequence:
            input.value.trim()
        };
      }
    );

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
      bindWebsiteAccessActions();
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
