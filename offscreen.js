const baseSessions = new Map();
const MAX_BASE_SESSIONS = 12;

let availabilityPromise = null;
let availabilityValue = null;

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m =
      text.match(
        /\{[\s\S]*\}/
      );

    if (m) {
      return JSON.parse(
        m[0]
      );
    }

    throw new Error(
      "Nano did not return valid JSON"
    );
  }
}

function nanoContextError({
  requested,
  available,
  contextWindow
}) {
  const error =
    new Error(
      `Nano input is too large: ${requested ?? "unknown"} tokens requested, ${available ?? contextWindow ?? "unknown"} available in this session.`
    );

  error.name =
    "NanoContextBudgetError";

  error.code =
    "NANO_INPUT_TOO_LARGE";

  error.requested =
    requested ?? null;

  error.available =
    available ?? null;

  error.contextWindow =
    contextWindow ?? null;

  return error;
}

function sessionKey(msg) {
  return JSON.stringify({
    task:
      msg.sessionKey || "",
    system:
      msg.system || "",
    temperature:
      Number.isFinite(
        msg.nanoConfig
          ?.temperature
      )
        ? msg.nanoConfig
            .temperature
        : null,
    topK:
      Number.isFinite(
        msg.nanoConfig
          ?.topK
      )
        ? msg.nanoConfig
            .topK
        : null
  });
}

function makeSessionOptions(msg) {
  const options = {
    initialPrompts: [
      {
        role:
          "system",
        content:
          msg.system
      }
    ],
    expectedInputs: [
      {
        type:
          "text",
        languages: [
          "en"
        ]
      }
    ],
    expectedOutputs: [
      {
        type:
          "text",
        languages: [
          "en"
        ]
      }
    ]
  };

  // Extension-only sampling controls are optional.
  // Chrome requires both values or neither.
  if (
    Number.isFinite(
      msg.nanoConfig
        ?.temperature
    ) &&
    Number.isFinite(
      msg.nanoConfig
        ?.topK
    )
  ) {
    options.temperature =
      msg.nanoConfig
        .temperature;

    options.topK =
      msg.nanoConfig
        .topK;
  }

  return options;
}

async function ensureAvailability() {
  if (availabilityPromise) {
    return {
      availability:
        await availabilityPromise,
      availabilityMs:
        0,
      availabilityCached:
        true
    };
  }

  const started =
    performance.now();

  availabilityPromise =
    LanguageModel
      .availability({
        expectedInputs: [
          {
            type:
              "text",
            languages: [
              "en"
            ]
          }
        ],
        expectedOutputs: [
          {
            type:
              "text",
            languages: [
              "en"
            ]
          }
        ]
      })
      .then(value => {
        availabilityValue =
          value;

        return value;
      })
      .catch(error => {
        availabilityPromise =
          null;

        throw error;
      });

  const availability =
    await availabilityPromise;

  return {
    availability,
    availabilityMs:
      Math.round(
        performance.now() -
        started
      ),
    availabilityCached:
      false
  };
}

function destroyBaseEntry(entry) {
  try {
    entry?.session
      ?.destroy();
  } catch {}
}

function trimBaseSessions() {
  if (
    baseSessions.size <=
    MAX_BASE_SESSIONS
  ) {
    return;
  }

  const oldest =
    [...baseSessions.entries()]
      .sort(
        (a, b) =>
          a[1].lastUsed -
          b[1].lastUsed
      )[0];

  if (!oldest) return;

  destroyBaseEntry(
    oldest[1]
  );

  baseSessions.delete(
    oldest[0]
  );
}

async function getBaseSession(
  msg
) {
  const key =
    sessionKey(msg);

  const existing =
    baseSessions.get(
      key
    );

  if (existing) {
    existing.lastUsed =
      Date.now();

    return {
      key,
      session:
        existing.session,
      reused:
        true,
      createMs:
        0
    };
  }

  const started =
    performance.now();

  const session =
    await LanguageModel
      .create(
        makeSessionOptions(
          msg
        )
      );

  const createMs =
    Math.round(
      performance.now() -
      started
    );

  baseSessions.set(
    key,
    {
      session,
      createdAt:
        Date.now(),
      lastUsed:
        Date.now()
    }
  );

  trimBaseSessions();

  return {
    key,
    session,
    reused:
      false,
    createMs
  };
}

async function cloneBaseSession(
  msg
) {
  let base =
    await getBaseSession(
      msg
    );

  const started =
    performance.now();

  try {
    const session =
      await base.session
        .clone();

    return {
      ...base,
      session,
      cloneMs:
        Math.round(
          performance.now() -
          started
        )
    };
  } catch (error) {
    // If Chrome invalidated a cached base session, rebuild it once.
    const cached =
      baseSessions.get(
        base.key
      );

    destroyBaseEntry(
      cached
    );

    baseSessions.delete(
      base.key
    );

    base =
      await getBaseSession(
        msg
      );

    const retryStarted =
      performance.now();

    const session =
      await base.session
        .clone();

    return {
      ...base,
      reused:
        false,
      cloneMs:
        Math.round(
          performance.now() -
          retryStarted
        ),
      rebuiltAfterCloneError:
        String(
          error?.message ||
          error
        )
    };
  }
}

async function runNano(msg) {
  if (
    !globalThis
      .LanguageModel
  ) {
    throw new Error(
      "LanguageModel API is unavailable in this Chrome context."
    );
  }

  const totalStarted =
    performance.now();

  const availabilityInfo =
    await ensureAvailability();

  if (
    availabilityInfo
      .availability ===
    "unavailable"
  ) {
    throw new Error(
      "Gemini Nano is unavailable on this device."
    );
  }

  const baseInfo =
    await cloneBaseSession(
      msg
    );

  const session =
    baseInfo.session;

  const contextUsageBefore =
    Number.isFinite(
      session.contextUsage
    )
      ? session.contextUsage
      : null;

  const contextWindow =
    Number.isFinite(
      session.contextWindow
    )
      ? session.contextWindow
      : null;

  try {
    // Keep structured-output enforcement, but do not inject the JSON
    // schema into Nano's model context. Chrome documents the schema as
    // consuming context-window tokens unless this option is enabled.
    const promptOptions = {
      responseConstraint:
        msg.schema,
      omitResponseConstraintInput:
        true
    };

    let measuredInputUsage =
      null;

    let measureMs =
      0;

    const availableContext =
      Number.isFinite(
        contextWindow
      )
        ? Math.max(
            0,
            contextWindow -
            (
              Number.isFinite(
                contextUsageBefore
              )
                ? contextUsageBefore
                : 0
            )
          )
        : null;

    if (
      typeof session
        .measureContextUsage ===
      "function"
    ) {
      const measureStarted =
        performance.now();

      measuredInputUsage =
        await session
          .measureContextUsage(
            msg.prompt,
            promptOptions
          );

      measureMs =
        Math.round(
          performance.now() -
          measureStarted
        );

      if (
        Number.isFinite(
          measuredInputUsage
        ) &&
        Number.isFinite(
          availableContext
        ) &&
        measuredInputUsage >
          availableContext
      ) {
        throw nanoContextError({
          requested:
            measuredInputUsage,
          available:
            availableContext,
          contextWindow
        });
      }
    }

    const promptStarted =
      performance.now();

    let raw;

    try {
      raw =
        await session.prompt(
          msg.prompt,
          promptOptions
        );
    } catch (error) {
      if (
        error?.name ===
          "QuotaExceededError" ||
        /input is too large|too large|context window/i.test(
          String(
            error?.message ||
            error ||
            ""
          )
        )
      ) {
        throw nanoContextError({
          requested:
            Number.isFinite(
              error?.requested
            )
              ? error.requested
              : measuredInputUsage,
          available:
            availableContext,
          contextWindow:
            Number.isFinite(
              error?.contextWindow
            )
              ? error.contextWindow
              : contextWindow
        });
      }

      throw error;
    }

    const promptMs =
      Math.round(
        performance.now() -
        promptStarted
      );

    const parseStarted =
      performance.now();

    const parsed =
      parseJson(raw);

    const parseMs =
      Math.round(
        performance.now() -
        parseStarted
      );

    const contextUsageAfter =
      Number.isFinite(
        session.contextUsage
      )
        ? session.contextUsage
        : null;

    return {
      ok:
        true,
      raw,
      parsed,
      meta: {
        availability:
          availabilityInfo
            .availability,
        timing: {
          totalMs:
            Math.round(
              performance.now() -
              totalStarted
            ),
          availabilityMs:
            availabilityInfo
              .availabilityMs,
          baseSessionCreateMs:
            baseInfo
              .createMs,
          cloneMs:
            baseInfo
              .cloneMs,
          measureContextMs:
            measureMs,
          promptMs,
          parseMs
        },
        session: {
          baseSessionReused:
            baseInfo
              .reused,
          availabilityCached:
            availabilityInfo
              .availabilityCached,
          cacheSize:
            baseSessions.size,
          rebuiltAfterCloneError:
            baseInfo
              .rebuiltAfterCloneError ||
            null
        },
        input: {
          promptChars:
            String(
              msg.prompt ||
              ""
            ).length,
          systemChars:
            String(
              msg.system ||
              ""
            ).length,
          schemaChars:
            JSON.stringify(
              msg.schema ||
              {}
            ).length,
          responseConstraintInputOmitted:
            true
        },
        output: {
          responseChars:
            String(
              raw ||
              ""
            ).length
        },
        context: {
          usageBefore:
            contextUsageBefore,
          measuredInputUsage,
          availableBefore:
            availableContext,
          usageAfter:
            contextUsageAfter,
          window:
            contextWindow,
          measuredUtilisation:
            Number.isFinite(
              measuredInputUsage
            ) &&
            Number.isFinite(
              availableContext
            ) &&
            availableContext > 0
              ? measuredInputUsage /
                availableContext
              : null
        }
      }
    };
  } finally {
    session.destroy();
  }
}

chrome.runtime
  .onMessage
  .addListener(
    (
      msg,
      sender,
      sendResponse
    ) => {
      if (
        msg?.target !==
          "offscreen" ||
        msg.type !==
          "RUN_NANO"
      ) {
        return false;
      }

      runNano(msg)
        .then(
          sendResponse
        )
        .catch(
          e =>
            sendResponse({
              ok:
                false,
              error:
                String(
                  e?.message ||
                  e
                ),
              errorCode:
                e?.code ||
                null,
              requested:
                Number.isFinite(
                  e?.requested
                )
                  ? e.requested
                  : null,
              available:
                Number.isFinite(
                  e?.available
                )
                  ? e.available
                  : null,
              contextWindow:
                Number.isFinite(
                  e?.contextWindow
                )
                  ? e.contextWindow
                  : null
            })
        );

      return true;
    }
  );

addEventListener(
  "beforeunload",
  () => {
    for (
      const entry
      of baseSessions
        .values()
    ) {
      destroyBaseEntry(
        entry
      );
    }

    baseSessions.clear();
  }
);
