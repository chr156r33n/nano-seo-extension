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

function numericErrorValue(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : null;
}

function buildErrorResponse(
  error,
  meta
) {
  return {
    ok:
      false,
    error:
      String(
        error?.message ||
        error
      ),
    errorCode:
      error?.code ||
      null,
    requested:
      numericErrorValue(
        error?.requested
      ),
    available:
      numericErrorValue(
        error?.available
      ),
    contextWindow:
      numericErrorValue(
        error?.contextWindow
      ),
    quota:
      numericErrorValue(
        error?.quota
      ),
    chromeErrorName:
      error?.name ||
      null,
    chromeErrorMessage:
      String(
        error?.message ||
        error ||
        ""
      ),
    meta:
      meta ||
      null
  };
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

  const availabilityStarted =
    performance.now();

  const availability =
    await LanguageModel
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
      });

  const availabilityMs =
    Math.round(
      performance.now() -
      availabilityStarted
    );

  if (
    availability ===
    "unavailable"
  ) {
    throw new Error(
      "Gemini Nano is unavailable on this device."
    );
  }

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

  // Match the pre-session-reuse runner: use both sampling controls or neither.
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

  const createStarted =
    performance.now();

  const session =
    await LanguageModel
      .create(
        options
      );

  const sessionCreateMs =
    Math.round(
      performance.now() -
      createStarted
    );

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

  const baseMeta = () => ({
    availability,
    timing: {
      totalMs:
        Math.round(
          performance.now() -
          totalStarted
        ),
      availabilityMs,
      sessionCreateMs,
      // Kept for the existing UI while this regression test is running.
      baseSessionCreateMs:
        sessionCreateMs,
      cloneMs:
        0,
      promptMs:
        0,
      parseMs:
        0
    },
    session: {
      runnerMode:
        "fresh_session",
      baseSessionReused:
        false,
      availabilityCached:
        false,
      cacheSize:
        0,
      rebuiltAfterCloneError:
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
        false
    },
    context: {
      usageBefore:
        contextUsageBefore,
      usageAfter:
        null,
      window:
        contextWindow
    }
  });

  try {
    const promptStarted =
      performance.now();

    let raw;

    try {
      // Deliberately mirror the pre-PR #8 call semantics.
      raw =
        await session.prompt(
          msg.prompt,
          {
            responseConstraint:
              msg.schema
          }
        );
    } catch (error) {
      const meta =
        baseMeta();

      meta.timing.promptMs =
        Math.round(
          performance.now() -
          promptStarted
        );

      meta.timing.totalMs =
        Math.round(
          performance.now() -
          totalStarted
        );

      error.nanoMeta =
        meta;

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

    const meta =
      baseMeta();

    meta.timing.promptMs =
      promptMs;

    meta.timing.parseMs =
      parseMs;

    meta.timing.totalMs =
      Math.round(
        performance.now() -
        totalStarted
      );

    meta.output = {
      responseChars:
        String(
          raw ||
          ""
        ).length
    };

    meta.context.usageAfter =
      contextUsageAfter;

    return {
      ok:
        true,
      raw,
      parsed,
      meta
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
          error =>
            sendResponse(
              buildErrorResponse(
                error,
                error?.nanoMeta ||
                null
              )
            )
        );

      return true;
    }
  );
