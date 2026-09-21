
importScripts("defaults.js", "db.js");

async function enableAutomaticSidePanelAction() {
  try {
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true
    });
  } catch (e) {
    console.error(
      "Could not enable Nano SEO Lab side panel action:",
      e
    );
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await enableAutomaticSidePanelAction();

  const {settings} =
    await chrome.storage.local.get("settings");

  if (!settings) {
    await chrome.storage.local.set({
      settings: DEFAULT_SETTINGS
    });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await enableAutomaticSidePanelAction();
});

// Restore Chrome's native toolbar-icon → side-panel behaviour whenever
// the service worker starts. This is more reliable than manually opening
// the panel from action.onClicked, and the extension no longer needs the
// old custom "authorised tab" bookkeeping that originally motivated the
// workaround.
enableAutomaticSidePanelAction();

async function getSettings() {
  const {settings} = await chrome.storage.local.get("settings");
  return mergeSettings(settings);
}

async function getCurrentActiveTab() {
  const [tab] =
    await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

  if (!tab?.id) {
    throw new Error(
      "No active browser tab was found."
    );
  }

  return tab;
}

function friendlyPageAccessError(error) {
  const message =
    String(
      error?.message ||
      error ||
      ""
    );

  if (
    /cannot access contents|host permission|cannot access a chrome|missing host permission|cannot access page/i.test(
      message
    )
  ) {
    return new Error(
      `Chrome has not granted temporary page access for this tab. ` +
      `Click the Nano SEO Lab toolbar icon on the page once, then run the analysis again.`
    );
  }

  return error instanceof Error
    ? error
    : new Error(message);
}


async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function renderTemplate(template, vars) {
  return template.replace(
    /\{\{([a-zA-Z0-9_]+)\}\}/g,
    (_, k) => vars[k] ?? ""
  );
}

function pageRepresentation(snapshot, mode, maxChars) {
  if (mode === "raw_html") {
    return {
      mode,
      url: snapshot.url,
      content: (snapshot.rawRenderedHtml || "").slice(0, maxChars)
    };
  }

  if (mode === "clean_html") {
    return {
      mode,
      url: snapshot.url,
      content: (snapshot.cleanHtml || "").slice(0, maxChars)
    };
  }

  if (mode === "markdown") {
    return {
      mode,
      url: snapshot.url,
      content: (snapshot.cleanMarkdown || "").slice(0, maxChars)
    };
  }

  if (mode === "digest") {
    return {
      mode,
      url: snapshot.url,
      content: snapshot.structuredDigest || {}
    };
  }

  return {
    mode: "raw",
    url: snapshot.url,
    content: (snapshot.bodyText || "").slice(0, maxChars)
  };
}

function taskVars(task, payload, settings) {
  if (task === "link_group") {
    return {
      links_json: JSON.stringify(payload.links, null, 2)
    };
  }

  if (task === "page_type" || task === "intent") {
    const mode = payload.inputMode || "raw";

    return {
      semantic_guidance: settings.semanticImportanceGuidance,
      page_json: JSON.stringify(
        pageRepresentation(
          payload.snapshot,
          mode,
          settings.limits.bodyChars
        ),
        null,
        2
      )
    };
  }

  if (task === "alignment") {
    return {
      page_type_json: JSON.stringify(payload.pageTypeResult, null, 2),
      intent_json: JSON.stringify(payload.intentResult, null, 2),
      page_summary_json: JSON.stringify({
        inputMode: payload.inputMode || "raw",
        url: payload.snapshot.url,
        title: payload.snapshot.title,
        h1s: payload.snapshot.h1s,
        schemaTypes: payload.snapshot.schemaTypes
      }, null, 2)
    };
  }

  if (task === "false_positive") {
    const guidance =
      settings.falsePositiveGuidance?.[payload.issue?.code] ||
      "Judge the finding conservatively using the supplied page context. If the evidence is insufficient, choose manual_review.";

    return {
      semantic_guidance: settings.semanticImportanceGuidance,
      guidance,
      issue_json: JSON.stringify(payload.issue, null, 2),
      context_json: JSON.stringify(payload.context, null, 2)
    };
  }

  if (task === "dom_diff_triage") {
    return {
      semantic_guidance: settings.semanticImportanceGuidance,
      diff_json: JSON.stringify(payload.items || [], null, 2)
    };
  }

  if (task === "url_consistency") {
    return {
      semantic_guidance: settings.semanticImportanceGuidance,
      agreed_hreflangs_json: JSON.stringify(settings.hreflangAgreedValues || [], null, 2),
      url_signals_json: JSON.stringify(payload.urlSignals || {}, null, 2)
    };
  }

  if (task === "jira_ticket") {
    const issueCode =
      payload.issue?.code ||
      payload.issue?.source ||
      "";

    const guidance =
      settings.falsePositiveGuidance?.[issueCode] ||
      "Describe the observed issue conservatively. Do not imply a confirmed defect when the evidence only indicates a likely or contextual problem.";

    return {
      semantic_guidance: settings.semanticImportanceGuidance,
      guidance,
      issue_json: JSON.stringify(payload.issue || {}, null, 2),
      context_json: JSON.stringify(payload.context || {}, null, 2),
      example_url: payload.exampleUrl || payload.context?.url || ""
    };
  }

  return {};
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Model did not return valid JSON");
  }
}

async function ensureOffscreen() {
  const path = "offscreen.html";
  const url = chrome.runtime.getURL(path);

  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [url]
  });

  if (contexts.length) return;

  await chrome.offscreen.createDocument({
    url: path,
    reasons: ["DOM_PARSER"],
    justification:
      "Provide a document context required to run Chrome's built-in LanguageModel API."
  });
}

async function callNano({system, prompt, schema, settings}) {
  await ensureOffscreen();

  const resp = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "RUN_NANO",
    system,
    prompt,
    schema,
    nanoConfig: settings.providers.nano
  });

  if (!resp?.ok) {
    throw new Error(resp?.error || "Nano runner failed");
  }

  return {
    parsed: resp.parsed,
    raw: resp.raw,
    meta: resp.meta || {}
  };
}

async function callGemini({system, prompt, schema, settings}) {
  const cfg = settings.providers.gemini;
  if (!cfg.apiKey) {
    throw new Error("Gemini API key is not configured.");
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(cfg.model)}:generateContent?key=` +
    `${encodeURIComponent(cfg.apiKey)}`;

  const body = {
    systemInstruction: {
      parts: [{text: system}]
    },
    contents: [{
      role: "user",
      parts: [{text: prompt}]
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.2
    }
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body)
  });

  const data = await r.json();

  if (!r.ok) {
    throw new Error(
      data?.error?.message ||
      `Gemini HTTP ${r.status}`
    );
  }

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map(p => p.text || "")
      .join("") || "";

  return {
    parsed: parseJson(text),
    raw: data,
    meta: {
      usage: data.usageMetadata || null
    }
  };
}

function extractOpenAIText(data) {
  const pieces = [];

  for (const item of (data.output || [])) {
    for (const c of (item.content || [])) {
      if (
        c.type === "output_text" &&
        typeof c.text === "string"
      ) {
        pieces.push(c.text);
      }
    }
  }

  return pieces.join("");
}

async function callOpenAI({system, prompt, schema, settings}) {
  const cfg = settings.providers.openai;

  if (!cfg.apiKey) {
    throw new Error(
      "OpenAI API key is not configured."
    );
  }

  const body = {
    model: cfg.model,
    input: [
      {
        role: "system",
        content: [{
          type: "input_text",
          text: system
        }]
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: prompt
        }]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "seo_lab_result",
        strict: true,
        schema
      }
    }
  };

  const r = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify(body)
    }
  );

  const data = await r.json();

  if (!r.ok) {
    throw new Error(
      data?.error?.message ||
      `OpenAI HTTP ${r.status}`
    );
  }

  const text = extractOpenAIText(data);

  return {
    parsed: parseJson(text),
    raw: data,
    meta: {
      usage: data.usage || null
    }
  };
}

function newAnalysisRunId() {
  return crypto.randomUUID();
}

async function createAnalysisRun(snapshot) {
  const run = {
    id: newAnalysisRunId(),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    url: snapshot.url,
    title: snapshot.title,
    pageFingerprint: snapshot.fingerprint,
    capturedAt: snapshot.capturedAt,
    checks: {
      total: snapshot.auditChecks?.length || 0,
      passed:
        snapshot.auditChecks
          ?.filter(x => x.status === "pass")
          .length || 0,
      findings:
        snapshot.auditChecks
          ?.filter(x => x.status === "finding")
          .length || 0
    },
    tasks: {}
  };

  await dbPut("analysisRuns", run);

  await chrome.storage.local.set({
    currentAnalysisRunId: run.id
  });

  return run;
}

async function updateAnalysisRun(
  analysisRunId,
  task,
  provider,
  outputRecord,
  inputMode = null
) {
  if (!analysisRunId) return;

  const run = await dbGet(
    "analysisRuns",
    analysisRunId
  );

  if (!run) return;

  run.tasks ||= {};
  run.tasks[task] ||= {};

  if (
    inputMode &&
    ["page_type", "intent", "alignment"].includes(task)
  ) {
    run.tasks[task][inputMode] ||= {};
    run.tasks[task][inputMode][provider] =
      outputRecord;
  } else if (
    task === "link_group" ||
    task === "false_positive" ||
    task === "dom_diff_triage"
  ) {
    run.tasks[task][provider] ||= [];
    run.tasks[task][provider].push(
      outputRecord
    );
  } else {
    run.tasks[task][provider] =
      outputRecord;
  }

  run.updatedAt =
    new Date().toISOString();

  await dbPut(
    "analysisRuns",
    run
  );
}

async function runTask({
  task,
  provider,
  payload,
  useCache = true,
  analysisRunId = null
}) {
  const settings = await getSettings();
  const promptDef = settings.prompts[task];
  const schema = TASK_SCHEMAS[task];

  if (!promptDef || !schema) {
    throw new Error(
      `Unknown task: ${task}`
    );
  }

  const vars =
    taskVars(
      task,
      payload,
      settings
    );

  const prompt =
    renderTemplate(
      promptDef.user,
      vars
    );

  const system =
    promptDef.system;

  const inputMode =
    payload?.inputMode || null;

  const model =
    provider === "nano"
      ? "gemini-nano/chrome"
      : settings.providers[provider]?.model;

  const keyMaterial =
    JSON.stringify({
      task,
      provider,
      model,
      inputMode,
      system,
      prompt,
      schema
    });

  const cacheKey =
    await sha256(
      keyMaterial
    );

  if (useCache) {
    const cached =
      await dbGet(
        "cache",
        cacheKey
      );

    if (cached) {
      const outputRecord = {
        at:
          new Date().toISOString(),
        inputMode,
        cacheHit: true,
        durationMs: 0,
        output:
          cached.output,
        error: null
      };

      await dbAdd(
        "runs",
        {
          analysisRunId,
          createdAt:
            outputRecord.at,
          task,
          provider,
          model,
          inputMode,
          cacheHit: true,
          durationMs: 0,
          prompt,
          system,
          schema,
          payload,
          output:
            cached.output,
          raw:
            cached.raw,
          error: null
        }
      );

      await updateAnalysisRun(
        analysisRunId,
        task,
        provider,
        outputRecord,
        inputMode
      );

      return {
        ...cached.output,
        _meta: {
          cacheHit: true,
          cacheKey,
          model,
          inputMode
        }
      };
    }
  }

  const started =
    performance.now();

  let result;
  let error = null;

  try {
    const args = {
      system,
      prompt,
      schema,
      settings
    };

    if (provider === "nano") {
      result =
        await callNano(args);
    } else if (
      provider === "gemini"
    ) {
      result =
        await callGemini(args);
    } else if (
      provider === "openai"
    ) {
      result =
        await callOpenAI(args);
    } else {
      throw new Error(
        `Unknown provider: ${provider}`
      );
    }
  } catch (e) {
    error =
      String(
        e?.message || e
      );
  }

  const durationMs =
    Math.round(
      performance.now() -
      started
    );

  const callLog = {
    analysisRunId,
    createdAt:
      new Date().toISOString(),
    task,
    provider,
    model,
    inputMode,
    cacheHit: false,
    durationMs,
    prompt,
    system,
    schema,
    payload,
    output:
      result?.parsed || null,
    raw:
      result?.raw || null,
    meta:
      result?.meta || null,
    error
  };

  await dbAdd(
    "runs",
    callLog
  );

  await updateAnalysisRun(
    analysisRunId,
    task,
    provider,
    {
      at:
        callLog.createdAt,
      inputMode,
      cacheHit: false,
      durationMs,
      output:
        result?.parsed || null,
      usage:
        result?.meta?.usage || null,
      error
    },
    inputMode
  );

  if (error) {
    throw new Error(error);
  }

  await dbPut(
    "cache",
    {
      key: cacheKey,
      createdAt:
        new Date().toISOString(),
      task,
      provider,
      model,
      inputMode,
      output:
        result.parsed,
      raw:
        result.raw
    }
  );

  return {
    ...result.parsed,
    _meta: {
      cacheHit: false,
      cacheKey,
      model,
      inputMode,
      durationMs,
      usage:
        result.meta?.usage || null
    }
  };
}

async function captureActiveTab() {
  const tab =
    await getCurrentActiveTab();

  const settings =
    await getSettings();

  let execution;

  try {
    execution =
      await chrome.scripting.executeScript({
      target: {
        tabId: tab.id
      },

      func: (contextChars, semanticWeights, agreedHreflangs, maxSchemaUrlRefs) => {
        const txt = (el) =>
          (el?.textContent || "")
            .replace(/\s+/g, " ")
            .trim();

        const meta = (name) =>
          document
            .querySelector(
              `meta[name="${name}"]`
            )
            ?.content || "";

        const bodyText =
          txt(document.body);

        const rawRenderedHtml =
          document.documentElement?.outerHTML || "";

        const consentPattern =
          /(cookie|consent|onetrust|privacy[-_ ]?preference|cmp)/i;

        const relatedPattern =
          /(related|recommend|you-may-also|similar)/i;

        const reviewPattern =
          /(review|rating|testimonial)/i;

        const faqPattern =
          /(faq|frequently-asked|accordion)/i;

        const productPattern =
          /(product|pdp|details|description|specification|ingredient)/i;

        function compactIdentity(el) {
          if (!el) return "";

          const id =
            el.id && el.id.length <= 80
              ? `#${el.id}`
              : "";

          const classes =
            [...(el.classList || [])]
              .filter(
                c =>
                  c.length <= 40 &&
                  !/^css-|^js-|^sc-|^_[a-z0-9]{6,}$/i.test(c)
              )
              .slice(0, 2)
              .map(c => `.${c}`)
              .join("");

          return `${el.tagName?.toLowerCase() || ""}${id}${classes}`;
        }

        function zoneFor(el) {
          if (!el) return "unknown";

          const identity =
            [
              el.id,
              el.className,
              el.getAttribute?.("aria-label"),
              el.getAttribute?.("role")
            ]
              .filter(Boolean)
              .join(" ");

          if (
            consentPattern.test(identity) ||
            el.closest?.('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="onetrust" i],[class*="onetrust" i]')
          ) return "cookie_consent";

          if (el.closest?.("footer")) return "footer";
          if (el.closest?.("nav")) return "navigation";
          if (el.closest?.("header")) return "header";
          if (el.closest?.("dialog,[role='dialog']")) return "utility";
          if (el.closest?.("aside")) return "utility";
          if (el.closest?.("article")) return "article";
          if (el.closest?.("main")) return "main";

          return "body";
        }

        function componentFor(el) {
          if (!el) return "unknown";

          let cur = el;

          for (let i = 0; i < 5 && cur; i += 1, cur = cur.parentElement) {
            const identity =
              [
                cur.id,
                cur.className,
                cur.getAttribute?.("aria-label")
              ]
                .filter(Boolean)
                .join(" ");

            if (consentPattern.test(identity)) return "cookie_consent";
            if (faqPattern.test(identity)) return "faq";
            if (reviewPattern.test(identity)) return "reviews";
            if (relatedPattern.test(identity)) return "related_content";
            if (productPattern.test(identity)) return "product_details";
          }

          const zone =
            zoneFor(el);

          if (zone === "navigation") return "navigation";
          if (zone === "footer") return "footer";
          if (zone === "utility") return "utility";

          return zone === "main" || zone === "article"
            ? "main_content"
            : "unknown";
        }

        function selectorFor(el) {
          if (!el || !el.tagName) return "";

          if (el.id && el.id.length <= 80) {
            return `${el.tagName.toLowerCase()}#${el.id}`;
          }

          const parts = [];
          let cur = el;

          for (let depth = 0; cur && cur.nodeType === 1 && depth < 4; depth += 1) {
            let part =
              cur.tagName.toLowerCase();

            const usefulClass =
              [...(cur.classList || [])]
                .find(
                  c =>
                    c.length <= 35 &&
                    !/^css-|^js-|^sc-|^_[a-z0-9]{6,}$/i.test(c)
                );

            if (usefulClass) {
              part += `.${usefulClass}`;
            } else if (cur.parentElement) {
              const siblings =
                [...cur.parentElement.children]
                  .filter(x => x.tagName === cur.tagName);

              if (siblings.length > 1) {
                part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
              }
            }

            parts.unshift(part);

            if (cur.matches("main,article,nav,footer,header,body")) break;
            cur = cur.parentElement;
          }

          return parts.join(" > ").slice(0, 220);
        }

        function weightKeyFor(el) {
          const zone =
            zoneFor(el);

          const component =
            componentFor(el);

          if (zone === "cookie_consent") return "cookie_consent";
          if (component === "product_details") return "product_details";
          if (component === "faq") return "faq";
          if (component === "reviews") return "reviews";
          if (component === "related_content") return "related_content";
          if (zone === "navigation" || zone === "header") return "navigation";
          if (zone === "footer") return "footer";
          if (zone === "utility") return "utility";

          if (el?.tagName === "H1" && (zone === "main" || zone === "article")) {
            return "main_h1";
          }

          if (el?.tagName === "H2" && (zone === "main" || zone === "article")) {
            return "main_h2";
          }

          return "main_content";
        }

        function elementContext(el) {
          const weightKey =
            weightKeyFor(el);

          return {
            tag:
              el?.tagName?.toLowerCase() || "",
            selector:
              selectorFor(el),
            zone:
              zoneFor(el),
            component:
              componentFor(el),
            weight_key:
              weightKey,
            semantic_weight:
              Number(
                semanticWeights?.[weightKey] ??
                semanticWeights?.main_content ??
                1
              )
          };
        }

        const schemaTypes =
          new Set();

        const schemaUrlRefs = [];
        const schemaParseErrors = [];

        const schemaUrlKeys =
          new Set([
            "url",
            "@id",
            "mainEntityOfPage",
            "contentUrl"
          ]);

        function normaliseSchemaUrl(value) {
          if (typeof value !== "string") return "";

          try {
            return new URL(value, location.href).href;
          } catch {
            return value;
          }
        }

        const walk = (v, path = "$", inheritedType = "") => {
          if (!v) return;

          if (Array.isArray(v)) {
            v.forEach(
              (item, i) =>
                walk(
                  item,
                  `${path}[${i}]`,
                  inheritedType
                )
            );
            return;
          }

          if (typeof v === "object") {
            const t =
              v["@type"];

            const nodeType =
              Array.isArray(t)
                ? t.map(String).join(",")
                : t
                  ? String(t)
                  : inheritedType;

            if (Array.isArray(t)) {
              t.forEach(
                x =>
                  schemaTypes.add(
                    String(x)
                  )
              );
            } else if (t) {
              schemaTypes.add(
                String(t)
              );
            }

            for (const [key, value] of Object.entries(v)) {
              const propertyPath =
                `${path}.${key}`;

              if (
                schemaUrlKeys.has(key) &&
                schemaUrlRefs.length < maxSchemaUrlRefs
              ) {
                if (typeof value === "string") {
                  schemaUrlRefs.push({
                    nodeType,
                    property: key,
                    propertyPath,
                    value: normaliseSchemaUrl(value)
                  });
                } else if (
                  value &&
                  typeof value === "object" &&
                  typeof value["@id"] === "string"
                ) {
                  schemaUrlRefs.push({
                    nodeType,
                    property: `${key}.@id`,
                    propertyPath: `${propertyPath}.@id`,
                    value: normaliseSchemaUrl(value["@id"])
                  });
                }
              }

              walk(
                value,
                propertyPath,
                nodeType
              );
            }
          }
        };

        document
          .querySelectorAll(
            'script[type="application/ld+json"]'
          )
          .forEach((s, index) => {
            try {
              walk(
                JSON.parse(
                  s.textContent
                ),
                `$jsonld[${index}]`
              );
            } catch (e) {
              schemaParseErrors.push({
                index,
                error:
                  String(
                    e?.message || e
                  ).slice(0, 220),
                excerpt:
                  String(
                    s.textContent || ""
                  )
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 240)
              });
            }
          });

        const allAnchorElements =
          [
            ...document.querySelectorAll(
              "a"
            )
          ];

        const anchors =
          [
            ...document.querySelectorAll(
              "a[href]"
            )
          ];

        const links =
          anchors
            .map((a, id) => {
              let href = "";

              try {
                href =
                  new URL(
                    a.getAttribute("href"),
                    location.href
                  ).href;
              } catch {
                href =
                  a.href || "";
              }

              const host = (() => {
                try {
                  return new URL(
                    href
                  ).hostname;
                } catch {
                  return "";
                }
              })();

              const closest =
                a.closest(
                  "nav,header,footer,main,article,aside,section,li,p,div"
                );

              let zone =
                "unknown";

              if (a.closest("nav")) {
                zone = "nav";
              } else if (
                a.closest("header")
              ) {
                zone = "header";
              } else if (
                a.closest("footer")
              ) {
                zone = "footer";
              } else if (
                a.closest("article")
              ) {
                zone = "article";
              } else if (
                a.closest("main")
              ) {
                zone = "main";
              } else if (
                a.closest("aside")
              ) {
                zone = "aside";
              }

              const rel =
                a.getAttribute(
                  "rel"
                ) || "";

              const visibleAnchor =
                txt(a).slice(
                  0,
                  180
                );

              const accessibleAnchor =
                (
                  a.getAttribute("aria-label") ||
                  a.getAttribute("title") ||
                  a.querySelector("img[alt]")?.getAttribute("alt") ||
                  ""
                )
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 180);

              return {
                id,
                href,
                host,
                internal:
                  host ===
                  location.hostname,
                anchor:
                  visibleAnchor,
                accessibleAnchor,
                rel,
                zone,
                context:
                  txt(closest).slice(
                    0,
                    contextChars
                  )
              };
            })
            .filter(
              x =>
                /^https?:/i.test(
                  x.href
                )
            );

        const rawHrefValues =
          allAnchorElements.map(
            a =>
              (
                a.getAttribute("href") || ""
              ).trim()
          );

        const emptyAnchorElements =
          allAnchorElements.filter(
            a => {
              const visible =
                txt(a);

              const accessible =
                (
                  a.getAttribute("aria-label") ||
                  a.getAttribute("title") ||
                  a.querySelector("img[alt]")?.getAttribute("alt") ||
                  ""
                )
                  .replace(/\s+/g, " ")
                  .trim();

              return !visible && !accessible;
            }
          );

        const emptyAnchorCount =
          emptyAnchorElements.length;

        const emptyAnchorDetails =
          emptyAnchorElements
            .slice(0, 20)
            .map(
              (a, index) => {
                const rawHref =
                  (
                    a.getAttribute("href") ||
                    ""
                  ).trim();

                let resolvedHref = "";

                try {
                  resolvedHref =
                    rawHref
                      ? new URL(
                          rawHref,
                          location.href
                        ).href
                      : "";
                } catch {
                  resolvedHref =
                    a.href || "";
                }

                const closest =
                  a.closest(
                    "nav,header,footer,main,article,aside,section,li,p,div"
                  );

                const style =
                  getComputedStyle(a);

                const visibleOnPage =
                  !a.hidden &&
                  a.getAttribute("aria-hidden") !== "true" &&
                  style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  style.opacity !== "0" &&
                  (
                    a.offsetWidth > 0 ||
                    a.offsetHeight > 0 ||
                    a.getClientRects().length > 0
                  );

                const childTags =
                  [...a.children]
                    .map(
                      el =>
                        el.tagName
                          ?.toLowerCase() ||
                        ""
                    )
                    .filter(Boolean)
                    .slice(0, 8);

                let internal = null;

                if (resolvedHref) {
                  try {
                    internal =
                      new URL(
                        resolvedHref
                      ).hostname ===
                      location.hostname;
                  } catch {
                    internal = null;
                  }
                }

                return {
                  example:
                    index + 1,
                  rawHref,
                  href:
                    resolvedHref,
                  internal,
                  rel:
                    a.getAttribute("rel") || "",
                  target:
                    a.getAttribute("target") || "",
                  role:
                    a.getAttribute("role") || "",
                  tabindex:
                    a.getAttribute("tabindex") || "",
                  visible_on_page:
                    visibleOnPage,
                  has_svg:
                    !!a.querySelector("svg"),
                  has_image:
                    !!a.querySelector("img"),
                  image_alt:
                    a.querySelector("img")?.getAttribute("alt") || "",
                  child_tags:
                    childTags,
                  nearby_text:
                    txt(closest)
                      .slice(
                        0,
                        contextChars
                      ),
                  ...elementContext(a)
                };
              }
            );

        const nofollowCount =
          anchors.filter(
            x =>
              /(^|\s)nofollow(\s|$)/i.test(
                x.rel
              )
          ).length;

        const sponsoredCount =
          anchors.filter(
            x =>
              /(^|\s)sponsored(\s|$)/i.test(
                x.rel
              )
          ).length;

        const ugcCount =
          anchors.filter(
            x =>
              /(^|\s)ugc(\s|$)/i.test(
                x.rel
              )
          ).length;

        const internalHttpLinks =
          location.protocol === "https:"
            ? links.filter(
                x =>
                  x.internal &&
                  /^http:\/\//i.test(
                    x.href
                  )
              )
            : [];

        const linkStats = {
          totalAnchors:
            allAnchorElements.length,
          httpLinks:
            links.length,
          internal:
            links.filter(
              x => x.internal
            ).length,
          external:
            links.filter(
              x => !x.internal
            ).length,
          nofollow:
            nofollowCount,
          sponsored:
            sponsoredCount,
          ugc:
            ugcCount,
          emptyAnchor:
            emptyAnchorCount,
          emptyAnchorExamples:
            emptyAnchorDetails,
          emptyHref:
            rawHrefValues.filter(
              x => !x
            ).length,
          hashOnly:
            rawHrefValues.filter(
              x => /^#/.test(x)
            ).length,
          javascript:
            rawHrefValues.filter(
              x => /^javascript:/i.test(x)
            ).length,
          internalHttpOnHttps:
            internalHttpLinks.length
        };

        const h1s =
          [
            ...document.querySelectorAll("h1")
          ]
            .map(txt)
            .filter(Boolean);

        const h2s =
          [
            ...document.querySelectorAll("h2")
          ]
            .map(txt)
            .filter(Boolean);

        const h3s =
          [
            ...document.querySelectorAll("h3")
          ]
            .map(txt)
            .filter(Boolean);

        const headingDetails =
          [
            ...document.querySelectorAll("h1,h2,h3,h4,h5,h6")
          ]
            .map(
              el => ({
                text:
                  txt(el).slice(0, 220),
                ...elementContext(el)
              })
            )
            .filter(
              x =>
                x.text
            );

        const meaningfulHeadings =
          headingDetails.filter(
            h =>
              h.semantic_weight >= 0.5 &&
              ![
                "cookie_consent",
                "navigation",
                "footer",
                "utility"
              ].includes(
                h.zone
              )
          );

        const headingHierarchyIssues = [];

        for (
          let i = 1;
          i < meaningfulHeadings.length;
          i += 1
        ) {
          const prev =
            meaningfulHeadings[i - 1];

          const cur =
            meaningfulHeadings[i];

          const prevLevel =
            Number(
              prev.tag.slice(1)
            );

          const curLevel =
            Number(
              cur.tag.slice(1)
            );

          if (
            Number.isFinite(prevLevel) &&
            Number.isFinite(curLevel) &&
            curLevel >
              prevLevel + 1
          ) {
            headingHierarchyIssues.push({
              from:
                `${prev.tag}: ${prev.text}`,
              to:
                `${cur.tag}: ${cur.text}`,
              fromSelector:
                prev.selector,
              toSelector:
                cur.selector
            });
          }
        }

        const title =
          document.title || "";

        const desc =
          meta("description");

        const canonicals =
          [
            ...document.querySelectorAll(
              'link[rel~="canonical"]'
            )
          ].map(
            x => x.href
          );

        const robotsMetaValues =
          [
            ...document.querySelectorAll(
              'meta[name="robots" i]'
            )
          ]
            .map(
              el =>
                (
                  el.content || ""
                ).trim()
            )
            .filter(Boolean);

        const robots =
          robotsMetaValues[0] || "";

        const robotsTokens =
          robotsMetaValues
            .flatMap(
              value =>
                value
                  .toLowerCase()
                  .split(/[\s,]+/)
                  .filter(Boolean)
            );

        const robotsConflict =
          (
            robotsTokens.includes("index") &&
            robotsTokens.includes("noindex")
          ) ||
          (
            robotsTokens.includes("follow") &&
            robotsTokens.includes("nofollow")
          );

        const viewport =
          document.querySelector(
            'meta[name="viewport"]'
          )?.content || "";

        const htmlLang =
          document.documentElement
            ?.getAttribute("lang")
            ?.trim() || "";

        const htmlLangLooksValid =
          !htmlLang ||
          /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(
            htmlLang
          );

        const og = {
          title:
            document.querySelector(
              'meta[property="og:title"]'
            )?.content || "",
          description:
            document.querySelector(
              'meta[property="og:description"]'
            )?.content || "",
          image:
            document.querySelector(
              'meta[property="og:image"]'
            )?.content || "",
          type:
            document.querySelector(
              'meta[property="og:type"]'
            )?.content || "",
          url:
            document.querySelector(
              'meta[property="og:url"]'
            )?.content || ""
        };

        const twitter = {
          card:
            document.querySelector(
              'meta[name="twitter:card"]'
            )?.content || "",
          title:
            document.querySelector(
              'meta[name="twitter:title"]'
            )?.content || "",
          description:
            document.querySelector(
              'meta[name="twitter:description"]'
            )?.content || "",
          image:
            document.querySelector(
              'meta[name="twitter:image"]'
            )?.content || ""
        };

        const hasAnyOg =
          Object.values(og)
            .some(Boolean);

        const missingOgCore =
          hasAnyOg
            ? [
                ["og:title", og.title],
                ["og:description", og.description],
                ["og:image", og.image],
                ["og:url", og.url]
              ]
                .filter(([, value]) => !value)
                .map(([name]) => name)
            : [];

        const hasAnyTwitter =
          Object.values(twitter)
            .some(Boolean);

        const missingTwitterCore =
          hasAnyTwitter
            ? [
                ["twitter:card", twitter.card],
                ["twitter:title", twitter.title],
                ["twitter:description", twitter.description],
                ["twitter:image", twitter.image]
              ]
                .filter(([, value]) => !value)
                .map(([name]) => name)
            : [];

        const favicon =
          document.querySelector(
            'link[rel~="icon"], link[rel="shortcut icon"]'
          )?.href || "";

        const socialMeta = {
          openGraph:
            og,
          twitter,
          favicon
        };

        const hreflangs =
          [
            ...document.querySelectorAll(
              'link[rel~="alternate"][hreflang]'
            )
          ].map(
            el => ({
              value:
                el.getAttribute("hreflang")?.trim() || "",
              href:
                el.href || el.getAttribute("href") || ""
            })
          );

        const mobileAnnotations =
          [
            ...document.querySelectorAll(
              'link[rel~="alternate"][media]:not([hreflang])'
            )
          ].map(
            el => ({
              media:
                el.getAttribute("media")?.trim() || "",
              href:
                el.href || el.getAttribute("href") || ""
            })
          );

        function levenshtein(a, b) {
          const aa = String(a || "").toLowerCase();
          const bb = String(b || "").toLowerCase();

          const dp =
            Array.from(
              {length: bb.length + 1},
              (_, j) => j
            );

          for (let i = 1; i <= aa.length; i += 1) {
            let prev = dp[0];
            dp[0] = i;

            for (let j = 1; j <= bb.length; j += 1) {
              const temp = dp[j];

              dp[j] =
                Math.min(
                  dp[j] + 1,
                  dp[j - 1] + 1,
                  prev + (
                    aa[i - 1] === bb[j - 1]
                      ? 0
                      : 1
                  )
                );

              prev = temp;
            }
          }

          return dp[bb.length];
        }

        const agreed =
          (agreedHreflangs || [])
            .map(v => String(v).trim())
            .filter(Boolean);

        const agreedMap =
          new Map(
            agreed.map(
              value => [
                value.toLowerCase(),
                value
              ]
            )
          );

        function suggestedHreflang(value) {
          if (!agreed.length) return "";

          const lower =
            String(value || "").toLowerCase();

          if (agreedMap.has(lower)) {
            return agreedMap.get(lower);
          }

          const language =
            lower.split("-")[0];

          const sameLanguage =
            agreed.filter(
              candidate =>
                candidate
                  .toLowerCase()
                  .split("-")[0] ===
                language
            );

          const pool =
            sameLanguage.length
              ? sameLanguage
              : agreed;

          return [...pool]
            .sort(
              (a, b) =>
                levenshtein(lower, a) -
                levenshtein(lower, b)
            )[0] || "";
        }

        const hreflangValidation =
          hreflangs.map(
            item => {
              const lower =
                item.value.toLowerCase();

              const formatLooksValid =
                lower === "x-default" ||
                /^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?$/i.test(
                  item.value
                );

              const agreedValue =
                agreedMap.get(lower) || "";

              return {
                ...item,
                in_agreed_list:
                  agreed.length
                    ? !!agreedValue
                    : null,
                format_looks_valid:
                  formatLooksValid,
                suggested_value:
                  agreed.length &&
                  !agreedValue
                    ? suggestedHreflang(item.value)
                    : agreedValue &&
                      agreedValue !== item.value
                      ? agreedValue
                      : ""
              };
            }
          );

        const hreflangCounts =
          new Map();

        for (
          const h
          of hreflangValidation
        ) {
          const key =
            h.value.toLowerCase();

          hreflangCounts.set(
            key,
            (
              hreflangCounts.get(key) ||
              0
            ) + 1
          );
        }

        const duplicateHreflangs =
          [
            ...hreflangCounts.entries()
          ]
            .filter(
              ([key, count]) =>
                key &&
                count > 1
            )
            .map(
              ([value, count]) => ({
                value,
                count
              })
            );

        const unapprovedHreflangs =
          hreflangValidation.filter(
            h =>
              h.in_agreed_list === false
          );

        const invalidHreflangs =
          hreflangValidation.filter(
            h =>
              !h.format_looks_valid
          );

        const emptyHrefHreflangs =
          hreflangValidation.filter(
            h =>
              !h.href
          );

        const hostEnvironment = (url) => {
          try {
            const u =
              new URL(url);

            return {
              url,
              scheme:
                u.protocol.replace(":", ""),
              host:
                u.hostname,
              suspicious_environment:
                /(localhost|127\.0\.0\.1|(?:^|[.-])(dev|stage|staging|uat|qa|test|preview|sandbox)(?:[.-]|$))/i.test(
                  u.hostname
                )
            };
          } catch {
            return {
              url,
              scheme: "",
              host: "",
              suspicious_environment: false
            };
          }
        };

        const urlSignals = {
          currentUrl:
            location.href,
          htmlLang,
          canonicals,
          hreflangs:
            hreflangValidation,
          mobileAnnotations,
          schemaUrlRefs,
          environments: [
            hostEnvironment(location.href),
            ...canonicals.map(hostEnvironment),
            ...hreflangs.map(x => hostEnvironment(x.href)),
            ...mobileAnnotations.map(x => hostEnvironment(x.href)),
            ...schemaUrlRefs.map(x => hostEnvironment(x.value))
          ]
        };

        const imgs =
          [...document.images];

        const missingAlt =
          imgs.filter(
            i =>
              !i.hasAttribute(
                "alt"
              )
          ).length;

        const emptyAlt =
          imgs.filter(
            i =>
              i.hasAttribute(
                "alt"
              ) &&
              !i.getAttribute("alt")
                ?.trim()
          ).length;

        const missingImageDimensions =
          imgs.filter(
            i =>
              !i.hasAttribute("width") ||
              !i.hasAttribute("height")
          ).length;

        const imageStats = {
          total:
            imgs.length,
          missingAlt,
          emptyAlt,
          missingDimensions:
            missingImageDimensions,
          lazy:
            imgs.filter(
              i =>
                i.loading === "lazy" ||
                i.getAttribute("loading") === "lazy"
            ).length
        };

        const buttons =
          [
            ...document.querySelectorAll(
              'button, input[type="submit"], input[type="button"], [role="button"]'
            )
          ]
            .map(el => {
              if (
                el.tagName === "INPUT"
              ) {
                return el.value || "";
              }

              return txt(el);
            })
            .filter(Boolean)
            .slice(0, 30);

        const mainCandidate =
          document.querySelector("main") ||
          document.querySelector("article") ||
          document.body;

        const clone =
          mainCandidate.cloneNode(true);

        clone
          .querySelectorAll(
            "script,style,noscript,svg,canvas,iframe,nav,footer,header,[hidden],[aria-hidden='true']"
          )
          .forEach(
            el =>
              el.remove()
          );

        const allowedCleanAttrs =
          new Set([
            "href",
            "src",
            "alt",
            "title",
            "role",
            "aria-label",
            "itemprop",
            "itemscope",
            "itemtype",
            "type",
            "name",
            "value",
            "rel",
            "hreflang",
            "media"
          ]);

        clone
          .querySelectorAll("*")
          .forEach(
            el => {
              for (
                const attr
                of [...el.attributes]
              ) {
                if (
                  !allowedCleanAttrs.has(
                    attr.name.toLowerCase()
                  )
                ) {
                  el.removeAttribute(
                    attr.name
                  );
                }
              }
            }
          );

        const cleanHtml =
          clone.outerHTML || "";

        const blockTags =
          new Set([
            "P",
            "DIV",
            "SECTION",
            "ARTICLE",
            "MAIN",
            "ASIDE",
            "LI",
            "H1",
            "H2",
            "H3",
            "H4",
            "H5",
            "H6",
            "BLOCKQUOTE",
            "PRE"
          ]);

        function nodeToMarkdown(node) {
          if (
            node.nodeType ===
            Node.TEXT_NODE
          ) {
            return node.textContent
              .replace(/\s+/g, " ");
          }

          if (
            node.nodeType !==
            Node.ELEMENT_NODE
          ) {
            return "";
          }

          const tag =
            node.tagName;

          const inner =
            [...node.childNodes]
              .map(nodeToMarkdown)
              .join("")
              .trim();

          if (
            !inner &&
            !["IMG", "BR"].includes(tag)
          ) {
            return "";
          }

          if (tag === "H1") {
            return `\n# ${inner}\n`;
          }

          if (tag === "H2") {
            return `\n## ${inner}\n`;
          }

          if (tag === "H3") {
            return `\n### ${inner}\n`;
          }

          if (tag === "H4") {
            return `\n#### ${inner}\n`;
          }

          if (tag === "LI") {
            return `\n- ${inner}`;
          }

          if (tag === "A") {
            const href =
              node.getAttribute("href") || "";

            return href
              ? `[${inner}](${href})`
              : inner;
          }

          if (
            tag === "STRONG" ||
            tag === "B"
          ) {
            return `**${inner}**`;
          }

          if (
            tag === "EM" ||
            tag === "I"
          ) {
            return `*${inner}*`;
          }

          if (tag === "BR") {
            return "\n";
          }

          if (
            tag === "BLOCKQUOTE"
          ) {
            return `\n> ${inner}\n`;
          }

          if (
            blockTags.has(tag)
          ) {
            return `\n${inner}\n`;
          }

          return inner;
        }

        const cleanMarkdown =
          nodeToMarkdown(clone)
            .replace(/\n{3,}/g, "\n\n")
            .replace(/[ \t]+\n/g, "\n")
            .trim();

        const structuralSignals = {
          hasMain:
            !!document.querySelector("main"),

          hasArticle:
            !!document.querySelector("article"),

          h1Count:
            h1s.length,

          h2Count:
            h2s.length,

          h3Count:
            h3s.length,

          formCount:
            document.forms.length,

          buttonCount:
            buttons.length,

          imageCount:
            imgs.length,

          internalLinkCount:
            links.filter(
              x => x.internal
            ).length,

          externalLinkCount:
            links.filter(
              x => !x.internal
            ).length,

          productSchema:
            [...schemaTypes]
              .includes("Product"),

          articleSchema:
            [...schemaTypes]
              .includes("Article") ||
            [...schemaTypes]
              .includes("NewsArticle") ||
            [...schemaTypes]
              .includes("BlogPosting"),

          breadcrumbSchema:
            [...schemaTypes]
              .includes("BreadcrumbList"),

          faqSchema:
            [...schemaTypes]
              .includes("FAQPage")
        };

        const structuredDigest = {
          url:
            location.href,

          pathname:
            location.pathname,

          title,

          metaDescription:
            desc,

          h1s,

          headings:
            headingDetails
              .slice(0, 24),

          schemaTypes:
            [...schemaTypes]
              .sort(),

          buttons,

          structuralSignals,

          urlSignals: {
            htmlLang,
            canonical:
              canonicals[0] || "",
            hreflangs:
              hreflangValidation.slice(0, 30)
          },

          mainTextExcerpt:
            txt(mainCandidate)
              .slice(0, 5000)
        };

        const auditChecks = [];

        const addCheck = (
          code,
          status,
          message,
          deterministicValue
        ) => {
          auditChecks.push({
            code,
            status,
            message,
            deterministicValue
          });
        };

        addCheck(
          "h1_presence",
          h1s.length === 0
            ? "finding"
            : "pass",
          h1s.length === 0
            ? "No H1 element found"
            : `${h1s.length} H1 element(s) found`,
          h1s.length
        );

        addCheck(
          "multiple_h1",
          h1s.length > 1
            ? "finding"
            : "pass",
          h1s.length > 1
            ? `${h1s.length} H1 elements found`
            : "No multiple-H1 condition detected",
          h1s.length
        );

        addCheck(
          "title_presence",
          !title.trim()
            ? "finding"
            : "pass",
          !title.trim()
            ? "Document title is empty"
            : "Document title is present",
          title
        );

        addCheck(
          "title_length",
          title.length > 60 ||
          (
            title.trim() &&
            title.length < 15
          )
            ? "finding"
            : "pass",
          title.length > 60
            ? `Title is ${title.length} characters`
            : (
              title.trim() &&
              title.length < 15
            )
              ? `Title is only ${title.length} characters`
              : `Title length is ${title.length} characters`,
          title.length
        );

        addCheck(
          "meta_description_presence",
          !desc.trim()
            ? "finding"
            : "pass",
          !desc.trim()
            ? "Meta description is missing/empty"
            : "Meta description is present",
          desc
        );

        addCheck(
          "meta_description_length",
          desc.length > 170
            ? "finding"
            : "pass",
          desc.length > 170
            ? `Meta description is ${desc.length} characters`
            : `Meta description length is ${desc.length} characters`,
          desc.length
        );

        addCheck(
          "canonical_presence",
          canonicals.length === 0
            ? "finding"
            : "pass",
          canonicals.length === 0
            ? "Canonical link is missing"
            : "Canonical link is present",
          canonicals.length
        );

        addCheck(
          "multiple_canonical",
          canonicals.length > 1
            ? "finding"
            : "pass",
          canonicals.length > 1
            ? `${canonicals.length} canonical links found`
            : "No multiple-canonical condition detected",
          canonicals.length
        );

        const crossOriginCanonical =
          canonicals[0] &&
          (() => {
            try {
              return (
                new URL(
                  canonicals[0]
                ).origin !==
                location.origin
              );
            } catch {
              return false;
            }
          })();

        addCheck(
          "canonical_cross_origin",
          crossOriginCanonical
            ? "finding"
            : "pass",
          crossOriginCanonical
            ? "Canonical points to a different origin"
            : canonicals[0]
              ? "Canonical remains on the same origin"
              : "No canonical available for cross-origin check",
          canonicals[0] || ""
        );

        addCheck(
          "robots_noindex",
          /noindex/i.test(
            robots
          )
            ? "finding"
            : "pass",
          /noindex/i.test(
            robots
          )
            ? "Robots meta contains noindex"
            : "No noindex directive detected in robots meta",
          robots
        );

        addCheck(
          "images_missing_alt",
          missingAlt > 0
            ? "finding"
            : "pass",
          missingAlt > 0
            ? `${missingAlt} images lack an alt attribute`
            : "All images have an alt attribute",
          missingAlt
        );

        addCheck(
          "heading_hierarchy",
          headingHierarchyIssues.length
            ? "finding"
            : "pass",
          headingHierarchyIssues.length
            ? `${headingHierarchyIssues.length} meaningful heading level jump(s) detected`
            : "No meaningful heading level jumps detected",
          headingHierarchyIssues
        );

        addCheck(
          "html_lang_presence",
          !htmlLang
            ? "finding"
            : "pass",
          !htmlLang
            ? "HTML lang attribute is missing"
            : `HTML lang is ${htmlLang}`,
          htmlLang
        );

        addCheck(
          "html_lang_format",
          htmlLang && !htmlLangLooksValid
            ? "finding"
            : "pass",
          htmlLang && !htmlLangLooksValid
            ? `HTML lang value looks malformed: ${htmlLang}`
            : "HTML lang format looks plausible",
          htmlLang
        );

        addCheck(
          "robots_conflict",
          robotsConflict
            ? "finding"
            : "pass",
          robotsConflict
            ? `Conflicting robots directives detected: ${robotsMetaValues.join(" | ")}`
            : "No conflicting robots meta directives detected",
          robotsMetaValues
        );

        const canonicalHasFragment =
          canonicals.some(
            value => {
              try {
                return !!new URL(value).hash;
              } catch {
                return false;
              }
            }
          );

        addCheck(
          "canonical_fragment",
          canonicalHasFragment
            ? "finding"
            : "pass",
          canonicalHasFragment
            ? "Canonical URL contains a fragment"
            : "Canonical URL contains no fragment",
          canonicals
        );

        const canonicalProtocolDowngrade =
          location.protocol === "https:" &&
          canonicals.some(
            value =>
              /^http:\/\//i.test(value)
          );

        addCheck(
          "canonical_protocol_downgrade",
          canonicalProtocolDowngrade
            ? "finding"
            : "pass",
          canonicalProtocolDowngrade
            ? "HTTPS page canonicalises to an HTTP URL"
            : "No HTTPS-to-HTTP canonical downgrade detected",
          canonicals
        );

        addCheck(
          "jsonld_parse_error",
          schemaParseErrors.length
            ? "finding"
            : "pass",
          schemaParseErrors.length
            ? `${schemaParseErrors.length} JSON-LD block(s) could not be parsed`
            : "All JSON-LD blocks parsed successfully",
          schemaParseErrors
        );

        addCheck(
          "hreflang_duplicate_value",
          duplicateHreflangs.length
            ? "finding"
            : "pass",
          duplicateHreflangs.length
            ? `${duplicateHreflangs.length} duplicate hreflang value(s) detected`
            : "No duplicate hreflang values detected",
          duplicateHreflangs
        );

        addCheck(
          "hreflang_unapproved_value",
          unapprovedHreflangs.length
            ? "finding"
            : "pass",
          unapprovedHreflangs.length
            ? `${unapprovedHreflangs.length} hreflang value(s) are outside the configured agreed list`
            : agreed.length
              ? "All hreflang values are in the configured agreed list"
              : "No agreed hreflang list configured",
          unapprovedHreflangs
        );

        addCheck(
          "hreflang_invalid_format",
          invalidHreflangs.length
            ? "finding"
            : "pass",
          invalidHreflangs.length
            ? `${invalidHreflangs.length} hreflang value(s) have an implausible format`
            : "Hreflang value formats look plausible",
          invalidHreflangs
        );

        addCheck(
          "hreflang_empty_href",
          emptyHrefHreflangs.length
            ? "finding"
            : "pass",
          emptyHrefHreflangs.length
            ? `${emptyHrefHreflangs.length} hreflang declaration(s) have no usable href`
            : "All hreflang declarations have target URLs",
          emptyHrefHreflangs
        );

        addCheck(
          "open_graph_incomplete",
          missingOgCore.length
            ? "finding"
            : "pass",
          missingOgCore.length
            ? `Open Graph is partially configured; missing ${missingOgCore.join(", ")}`
            : hasAnyOg
              ? "Open Graph core tags are present"
              : "No Open Graph implementation detected",
          {
            present:
              hasAnyOg,
            missing:
              missingOgCore,
            values:
              og
          }
        );

        const preferredIdentity =
          canonicals[0] ||
          location.href;

        const ogUrlMismatch =
          og.url &&
          (() => {
            try {
              const a =
                new URL(
                  og.url,
                  location.href
                );

              const b =
                new URL(
                  preferredIdentity,
                  location.href
                );

              a.hash = "";
              b.hash = "";

              return a.href !== b.href;
            } catch {
              return true;
            }
          })();

        addCheck(
          "og_url_mismatch",
          ogUrlMismatch
            ? "finding"
            : "pass",
          ogUrlMismatch
            ? "og:url differs from the preferred page identity"
            : "og:url is absent or consistent with the preferred page identity",
          {
            ogUrl:
              og.url,
            preferredIdentity
          }
        );

        addCheck(
          "twitter_card_incomplete",
          missingTwitterCore.length
            ? "finding"
            : "pass",
          missingTwitterCore.length
            ? `Twitter/X card metadata is partially configured; missing ${missingTwitterCore.join(", ")}`
            : hasAnyTwitter
              ? "Twitter/X card core tags are present"
              : "No Twitter/X card implementation detected",
          {
            present:
              hasAnyTwitter,
            missing:
              missingTwitterCore,
            values:
              twitter
          }
        );

        addCheck(
          "favicon_presence",
          !favicon
            ? "finding"
            : "pass",
          !favicon
            ? "No favicon link declaration detected"
            : "Favicon link declaration is present",
          favicon
        );

        addCheck(
          "images_empty_alt",
          emptyAlt > 0
            ? "finding"
            : "pass",
          emptyAlt > 0
            ? `${emptyAlt} image(s) have an empty alt attribute`
            : "No images have an empty alt attribute",
          emptyAlt
        );

        addCheck(
          "images_missing_dimensions",
          missingImageDimensions > 0
            ? "finding"
            : "pass",
          missingImageDimensions > 0
            ? `${missingImageDimensions} image(s) lack explicit width and/or height attributes`
            : "All images declare width and height attributes",
          missingImageDimensions
        );

        addCheck(
          "links_empty_anchor",
          emptyAnchorCount > 0
            ? "finding"
            : "pass",
          emptyAnchorCount > 0
            ? `${emptyAnchorCount} link(s) have no visible or accessible anchor text`
            : "No empty link anchors detected",
          {
            count:
              emptyAnchorCount,
            examples:
              emptyAnchorDetails,
            examples_capped:
              emptyAnchorCount >
              emptyAnchorDetails.length
          }
        );

        addCheck(
          "internal_http_links",
          internalHttpLinks.length > 0
            ? "finding"
            : "pass",
          internalHttpLinks.length > 0
            ? `${internalHttpLinks.length} internal HTTP link(s) found on an HTTPS page`
            : "No internal HTTP links found on this HTTPS page",
          internalHttpLinks.slice(0, 30)
        );

        addCheck(
          "viewport_presence",
          !viewport.trim()
            ? "finding"
            : "pass",
          !viewport.trim()
            ? "Viewport meta tag is missing"
            : "Viewport meta tag is present",
          viewport
        );

        const findings =
          auditChecks
            .filter(
              x =>
                x.status ===
                "finding"
            )
            .map(x => ({
              code:
                x.code,
              message:
                x.message,
              deterministicValue:
                x.deterministicValue
            }));

        return {
          url:
            location.href,

          origin:
            location.origin,

          title,

          metaDescription:
            desc,

          canonical:
            canonicals[0] || "",

          canonicals,

          robots,

          robotsMetaValues,

          viewport,

          h1s,

          h2s,

          h3s,

          schemaTypes:
            [...schemaTypes]
              .sort(),

          schemaParseErrors,

          bodyText,

          rawRenderedHtml,

          cleanHtml,

          cleanMarkdown,

          headingDetails,

          structuredDigest,

          urlSignals,

          links,

          linkStats,

          buttons,

          socialMeta,

          imageStats,

          imageCount:
            imgs.length,

          missingAltCount:
            missingAlt,

          emptyAltCount:
            emptyAlt,

          missingImageDimensionsCount:
            missingImageDimensions,

          auditChecks,

          issues:
            findings,

          capturedAt:
            new Date()
              .toISOString()
        };
      },

      args: [
        settings
          .limits
          .contextChars,
        settings
          .semanticWeights,
        settings
          .hreflangAgreedValues,
        settings
          .limits
          .maxSchemaUrlRefs
      ]
    });
  } catch (e) {
    throw friendlyPageAccessError(
      e
    );
  }

  const [{result}] =
    execution;

  const fingerprint =
    await sha256(
      JSON.stringify({
        url:
          result.url,
        title:
          result.title,
        h1s:
          result.h1s,
        canonical:
          result.canonical,
        robots:
          result.robots,
        bodyHead:
          result.bodyText.slice(
            0,
            20000
          )
      })
    );

  result.fingerprint =
    fingerprint;

  await dbPut(
    "snapshots",
    result
  );

  await chrome.storage.local.set({
    lastSnapshotFingerprint:
      fingerprint
  });

  const analysisRun =
    await createAnalysisRun(
      result
    );

  return {
    snapshot: result,
    analysisRun
  };
}


async function buildDomDiff() {
  const tab =
    await getCurrentActiveTab();

  const settings =
    await getSettings();

  let execution;

  try {
    execution =
      await chrome.scripting.executeScript({
      target: {
        tabId: tab.id
      },

      world: "MAIN",

      func: async (maxItems, semanticWeights) => {
        const normaliseText = (value) =>
          String(value || "")
            .replace(/\s+/g, " ")
            .trim();

        const clip = (value, max = 260) => {
          const text = normaliseText(value);
          return text.length > max
            ? `${text.slice(0, max - 1)}…`
            : text;
        };

        const consentPattern =
          /(cookie|consent|onetrust|privacy[-_ ]?preference|cmp)/i;

        const relatedPattern =
          /(related|recommend|you-may-also|similar)/i;

        const reviewPattern =
          /(review|rating|testimonial)/i;

        const faqPattern =
          /(faq|frequently-asked|accordion)/i;

        const productPattern =
          /(product|pdp|details|description|specification|ingredient)/i;

        const zoneFor = (el) => {
          if (!el) return "unknown";

          const identity =
            [
              el.id,
              el.className,
              el.getAttribute?.("aria-label"),
              el.getAttribute?.("role")
            ]
              .filter(Boolean)
              .join(" ");

          if (
            consentPattern.test(identity) ||
            el.closest?.('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="onetrust" i],[class*="onetrust" i]')
          ) return "cookie_consent";

          if (el.closest?.("footer")) return "footer";
          if (el.closest?.("nav")) return "navigation";
          if (el.closest?.("header")) return "header";
          if (el.closest?.("dialog,[role='dialog'],aside")) return "utility";
          if (el.closest?.("article")) return "article";
          if (el.closest?.("main")) return "main";

          return "body";
        };

        const componentFor = (el) => {
          let cur = el;

          for (let i = 0; cur && i < 5; i += 1, cur = cur.parentElement) {
            const identity =
              [
                cur.id,
                cur.className,
                cur.getAttribute?.("aria-label")
              ]
                .filter(Boolean)
                .join(" ");

            if (consentPattern.test(identity)) return "cookie_consent";
            if (faqPattern.test(identity)) return "faq";
            if (reviewPattern.test(identity)) return "reviews";
            if (relatedPattern.test(identity)) return "related_content";
            if (productPattern.test(identity)) return "product_details";
          }

          const zone =
            zoneFor(el);

          if (zone === "navigation") return "navigation";
          if (zone === "footer") return "footer";
          if (zone === "utility") return "utility";

          return zone === "main" || zone === "article"
            ? "main_content"
            : "unknown";
        };

        const selectorFor = (el) => {
          if (!el || !el.tagName) return "";

          if (el.id && el.id.length <= 80) {
            return `${el.tagName.toLowerCase()}#${el.id}`;
          }

          const parts = [];
          let cur = el;

          for (let depth = 0; cur && cur.nodeType === 1 && depth < 4; depth += 1) {
            let part =
              cur.tagName.toLowerCase();

            const usefulClass =
              [...(cur.classList || [])]
                .find(
                  c =>
                    c.length <= 35 &&
                    !/^css-|^js-|^sc-|^_[a-z0-9]{6,}$/i.test(c)
                );

            if (usefulClass) {
              part += `.${usefulClass}`;
            } else if (cur.parentElement) {
              const siblings =
                [...cur.parentElement.children]
                  .filter(x => x.tagName === cur.tagName);

              if (siblings.length > 1) {
                part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
              }
            }

            parts.unshift(part);

            if (cur.matches("main,article,nav,footer,header,body")) break;
            cur = cur.parentElement;
          }

          return parts.join(" > ").slice(0, 220);
        };

        const weightKeyFor = (el) => {
          const zone =
            zoneFor(el);

          const component =
            componentFor(el);

          if (zone === "cookie_consent") return "cookie_consent";
          if (component === "product_details") return "product_details";
          if (component === "faq") return "faq";
          if (component === "reviews") return "reviews";
          if (component === "related_content") return "related_content";
          if (zone === "navigation" || zone === "header") return "navigation";
          if (zone === "footer") return "footer";
          if (zone === "utility") return "utility";
          if (el?.tagName === "H1" && (zone === "main" || zone === "article")) return "main_h1";
          if (el?.tagName === "H2" && (zone === "main" || zone === "article")) return "main_h2";

          return "main_content";
        };

        const elementContext = (el) => {
          const weightKey =
            weightKeyFor(el);

          return {
            tag:
              el?.tagName?.toLowerCase() || "",
            selector:
              selectorFor(el),
            zone:
              zoneFor(el),
            component:
              componentFor(el),
            weight_key:
              weightKey,
            semantic_weight:
              Number(
                semanticWeights?.[weightKey] ??
                semanticWeights?.main_content ??
                1
              )
          };
        };

        const currentUrl =
          location.href;

        let response;

        try {
          response =
            await fetch(
              currentUrl,
              {
                method: "GET",
                credentials: "include",
                cache: "no-store"
              }
            );
        } catch (e) {
          throw new Error(
            `Could not refetch the current page from its own origin: ${e?.message || e}`
          );
        }

        if (!response.ok) {
          throw new Error(
            `Server refetch returned HTTP ${response.status}`
          );
        }

        const rawHtml =
          await response.text();

        const responseUrl =
          response.url ||
          currentUrl;

        const rawDoc =
          new DOMParser()
            .parseFromString(
              rawHtml,
              "text/html"
            );

        const renderedDoc =
          document;

        const absUrl = (
          value,
          base
        ) => {
          if (!value) return "";

          try {
            const u =
              new URL(
                value,
                base
              );

            if (
              !["http:", "https:"]
                .includes(
                  u.protocol
                )
            ) {
              return "";
            }

            u.hash = "";
            return u.href;
          } catch {
            return "";
          }
        };

        const jsonLdTypes = (doc) => {
          const types =
            new Set();

          const walk = (v) => {
            if (!v) return;

            if (Array.isArray(v)) {
              v.forEach(walk);
              return;
            }

            if (
              typeof v ===
              "object"
            ) {
              const t =
                v["@type"];

              if (Array.isArray(t)) {
                t.forEach(
                  x =>
                    types.add(
                      String(x)
                    )
                );
              } else if (t) {
                types.add(
                  String(t)
                );
              }

              Object.values(v)
                .forEach(walk);
            }
          };

          doc
            .querySelectorAll(
              'script[type="application/ld+json"]'
            )
            .forEach(
              node => {
                try {
                  walk(
                    JSON.parse(
                      node.textContent
                    )
                  );
                } catch {}
              }
            );

          return [
            ...types
          ].sort();
        };

        const inventory = (
          doc,
          base
        ) => {
          const meta = {
            title:
              normaliseText(
                doc.title
              ),

            description:
              normaliseText(
                doc.querySelector(
                  'meta[name="description"]'
                )?.content
              ),

            robots:
              normaliseText(
                doc.querySelector(
                  'meta[name="robots"]'
                )?.content
              ),

            canonical:
              absUrl(
                doc.querySelector(
                  'link[rel~="canonical"]'
                )?.getAttribute(
                  "href"
                ),
                base
              )
          };

          const headings =
            [
              ...doc.querySelectorAll(
                "h1,h2,h3"
              )
            ]
              .map(
                el => ({
                  level:
                    el.tagName.toLowerCase(),
                  text:
                    clip(
                      el.textContent,
                      220
                    ),
                  element:
                    elementContext(el)
                })
              )
              .filter(
                x =>
                  x.text
              );

          const links =
            [
              ...doc.querySelectorAll(
                "a[href]"
              )
            ]
              .map(
                el => ({
                  href:
                    absUrl(
                      el.getAttribute(
                        "href"
                      ),
                      base
                    ),
                  text:
                    clip(
                      el.textContent,
                      160
                    ),
                  element:
                    elementContext(el)
                })
              )
              .filter(
                x =>
                  x.href
              );

          const main =
            doc.querySelector(
              "main"
            ) ||
            doc.querySelector(
              "article"
            ) ||
            doc.body;

          const textBlocks =
            main
              ? [
                  ...main.querySelectorAll(
                    "p,li"
                  )
                ]
                  .map(
                    el => ({
                      text:
                        clip(
                          el.textContent,
                          260
                        ),
                      element:
                        elementContext(el)
                    })
                  )
                  .filter(
                    item =>
                      item.text.length >=
                      35
                  )
              : [];

          const buttons =
            [
              ...doc.querySelectorAll(
                'button,[role="button"],input[type="submit"],input[type="button"]'
              )
            ]
              .map(
                el => ({
                  text:
                    clip(
                      el.tagName === "INPUT"
                        ? el.value
                        : el.textContent,
                      160
                    ),
                  element:
                    elementContext(el)
                })
              )
              .filter(
                item =>
                  item.text
              );

          return {
            meta,
            headings,
            links,
            schemaTypes:
              jsonLdTypes(doc),
            jsonLdCount:
              doc.querySelectorAll(
                'script[type="application/ld+json"]'
              ).length,
            textBlocks,
            buttons
          };
        };

        const raw =
          inventory(
            rawDoc,
            responseUrl
          );

        const rendered =
          inventory(
            renderedDoc,
            currentUrl
          );

        let nextId = 1;
        const items = [];

        const add = (
          priority,
          kind,
          changeType,
          rawValue,
          renderedValue,
          detail = {}
        ) => {
          items.push({
            id:
              nextId++,
            priority,
            kind,
            change_type:
              changeType,
            raw:
              rawValue ?? "",
            rendered:
              renderedValue ?? "",
            ...detail
          });
        };

        const metaFields = [
          "title",
          "description",
          "robots",
          "canonical"
        ];

        for (
          const field
          of metaFields
        ) {
          if (
            raw.meta[field] !==
            rendered.meta[field]
          ) {
            add(
              1,
              "metadata",
              "changed",
              raw.meta[field],
              rendered.meta[field],
              {field}
            );
          }
        }

        if (
          raw.jsonLdCount !==
          rendered.jsonLdCount
        ) {
          add(
            2,
            "structured_data",
            "script_count_changed",
            raw.jsonLdCount,
            rendered.jsonLdCount,
            {
              field:
                "jsonld_script_count"
            }
          );
        }

        const addSetDiff = (
          rawValues,
          renderedValues,
          keyFn,
          priority,
          kind,
          packFn = x => x
        ) => {
          const rawMap =
            new Map();

          const renderedMap =
            new Map();

          for (
            const value
            of rawValues
          ) {
            const key =
              keyFn(value);

            if (
              key &&
              !rawMap.has(key)
            ) {
              rawMap.set(
                key,
                value
              );
            }
          }

          for (
            const value
            of renderedValues
          ) {
            const key =
              keyFn(value);

            if (
              key &&
              !renderedMap.has(key)
            ) {
              renderedMap.set(
                key,
                value
              );
            }
          }

          for (
            const [key, value]
            of rawMap
          ) {
            if (
              !renderedMap.has(key)
            ) {
              add(
                priority,
                kind,
                "removed_in_rendered",
                packFn(value),
                ""
              );
            }
          }

          for (
            const [key, value]
            of renderedMap
          ) {
            if (
              !rawMap.has(key)
            ) {
              add(
                priority,
                kind,
                "added_in_rendered",
                "",
                packFn(value)
              );
            }
          }
        };

        addSetDiff(
          raw.schemaTypes,
          rendered.schemaTypes,
          x => x,
          2,
          "schema_type"
        );

        addSetDiff(
          raw.headings,
          rendered.headings,
          x =>
            `${x.level}|${x.text.toLowerCase()}`,
          3,
          "heading",
          x => x
        );

        addSetDiff(
          raw.links,
          rendered.links,
          x =>
            `${x.href}|${x.text.toLowerCase()}`,
          4,
          "link",
          x => x
        );

        addSetDiff(
          raw.textBlocks,
          rendered.textBlocks,
          x =>
            x.text.toLowerCase(),
          5,
          "content_block",
          x => x
        );

        addSetDiff(
          raw.buttons,
          rendered.buttons,
          x =>
            x.text.toLowerCase(),
          6,
          "button",
          x => x
        );

        items.sort(
          (a, b) =>
            a.priority -
              b.priority ||
            a.id -
              b.id
        );

        const total =
          items.length;

        const kept =
          items
            .slice(
              0,
              maxItems
            )
            .map(
              item => {
                const {
                  priority,
                  ...clean
                } = item;

                return clean;
              }
            );

        const byKind = {};

        for (
          const item
          of items
        ) {
          byKind[item.kind] =
            (
              byKind[item.kind] ||
              0
            ) + 1;
        }

        return {
          source:
            "same_origin_server_refetch_vs_live_rendered_dom",

          caveat:
            "The server HTML is a same-origin refetch made after page load, not a guaranteed copy of the original navigation response.",

          capturedAt:
            new Date()
              .toISOString(),

          response: {
            requestedUrl:
              currentUrl,
            responseUrl,
            status:
              response.status
          },

          summary: {
            rawHtmlChars:
              rawHtml.length,

            renderedHtmlChars:
              document.documentElement
                ?.outerHTML
                ?.length || 0,

            totalDiffItems:
              total,

            returnedDiffItems:
              kept.length,

            droppedByCap:
              Math.max(
                0,
                total -
                  kept.length
              ),

            byKind
          },

          items:
            kept
        };
      },

      args: [
        settings
          .limits
          .maxDomDiffItems,
        settings
          .semanticWeights
      ]
    });
  } catch (e) {
    throw friendlyPageAccessError(
      e
    );
  }

  const [{result}] =
    execution;

  const {
    lastSnapshotFingerprint,
    currentAnalysisRunId
  } =
    await chrome.storage.local.get([
      "lastSnapshotFingerprint",
      "currentAnalysisRunId"
    ]);

  if (
    lastSnapshotFingerprint
  ) {
    const snapshot =
      await dbGet(
        "snapshots",
        lastSnapshotFingerprint
      );

    if (snapshot) {
      snapshot.domDiff =
        result;

      await dbPut(
        "snapshots",
        snapshot
      );
    }
  }

  if (
    currentAnalysisRunId
  ) {
    const run =
      await dbGet(
        "analysisRuns",
        currentAnalysisRunId
      );

    if (run) {
      run.domDiff =
        result;

      run.updatedAt =
        new Date()
          .toISOString();

      await dbPut(
        "analysisRuns",
        run
      );
    }
  }

  return result;
}

chrome.runtime.onMessage.addListener(
  (
    msg,
    sender,
    sendResponse
  ) => {
    if (
      msg?.target ===
      "offscreen"
    ) {
      return false;
    }

    (async () => {
      if (
        msg.type ===
        "CAPTURE"
      ) {
        return await captureActiveTab();
      }

      if (
        msg.type ===
        "GET_LAST_CONTEXT"
      ) {
        const {
          lastSnapshotFingerprint,
          currentAnalysisRunId
        } =
          await chrome.storage.local.get([
            "lastSnapshotFingerprint",
            "currentAnalysisRunId"
          ]);

        return {
          snapshot:
            lastSnapshotFingerprint
              ? await dbGet(
                  "snapshots",
                  lastSnapshotFingerprint
                )
              : null,

          analysisRun:
            currentAnalysisRunId
              ? await dbGet(
                  "analysisRuns",
                  currentAnalysisRunId
                )
              : null
        };
      }

      if (
        msg.type ===
        "RUN_TASK"
      ) {
        return await runTask(
          msg
        );
      }

      if (
        msg.type ===
        "BUILD_DOM_DIFF"
      ) {
        return await buildDomDiff();
      }

      if (
        msg.type ===
        "GET_RUNS"
      ) {
        const runs =
          await dbGetAll(
            "runs"
          );

        return runs
          .sort(
            (a, b) =>
              String(
                b.createdAt
              ).localeCompare(
                String(
                  a.createdAt
                )
              )
          )
          .slice(
            0,
            msg.limit || 200
          );
      }

      if (
        msg.type ===
        "GET_ANALYSIS_RUNS"
      ) {
        const runs =
          await dbGetAll(
            "analysisRuns"
          );

        return runs
          .sort(
            (a, b) =>
              String(
                b.startedAt
              ).localeCompare(
                String(
                  a.startedAt
                )
              )
          )
          .slice(
            0,
            msg.limit || 500
          );
      }

      if (
        msg.type ===
        "GET_ANALYSIS_RUN"
      ) {
        return await dbGet(
          "analysisRuns",
          msg.id
        );
      }

      if (
        msg.type ===
        "CLEAR_ANALYSIS_HISTORY"
      ) {
        await dbClear(
          "analysisRuns"
        );

        await chrome.storage.local.remove(
          "currentAnalysisRunId"
        );

        return true;
      }

      if (
        msg.type ===
        "CLEAR_CACHE"
      ) {
        await dbClear(
          "cache"
        );
        return true;
      }

      if (
        msg.type ===
        "CLEAR_LOGS"
      ) {
        await dbClear(
          "runs"
        );
        return true;
      }

      if (
        msg.type ===
        "GET_SETTINGS"
      ) {
        return await getSettings();
      }


      throw new Error(
        "Unknown message"
      );
    })()
      .then(
        v =>
          sendResponse({
            ok: true,
            value: v
          })
      )
      .catch(
        e =>
          sendResponse({
            ok: false,
            error: String(
              e?.message || e
            )
          })
      );

    return true;
  }
);
