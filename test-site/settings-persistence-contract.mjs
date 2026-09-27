#!/usr/bin/env node

/**
 * Settings persistence contract.
 *
 * Run:
 *   node test-site/settings-persistence-contract.mjs
 *
 * Existing saved values must survive a default update. New default keys may be
 * added only where the saved settings do not already contain a value.
 */

import fs from "node:fs";
import vm from "node:vm";

const source =
  fs.readFileSync(
    new URL("../defaults.js", import.meta.url),
    "utf8"
  );

const context =
  vm.createContext({
    structuredClone
  });

vm.runInContext(
  source +
  "\nthis.__mergeSettings = mergeSettings;" +
  "\nthis.__DEFAULT_SETTINGS = DEFAULT_SETTINGS;" +
  "\nthis.__persistentSettings = persistentSettings;" +
  "\nthis.__providerSecretsFromSettings = providerSecretsFromSettings;" +
  "\nthis.__applyProviderSecrets = applyProviderSecrets;",
  context
);

const mergeSettings =
  context.__mergeSettings;

const defaults =
  context.__DEFAULT_SETTINGS;

const persistentSettings =
  context.__persistentSettings;

const providerSecretsFromSettings =
  context.__providerSecretsFromSettings;

const applyProviderSecrets =
  context.__applyProviderSecrets;

const saved = {
  providers: {
    nano: {
      enabled: false,
      temperature: 0.77
    },
    gemini: {
      model: "my-custom-model"
    }
  },
  limits: {
    linkBatchSize: 17
  },
  prompts: {
    page_type: {
      system: "CUSTOM SYSTEM PROMPT",
      user: "CUSTOM USER PROMPT"
    }
  },
  deterministicImpactProfiles: {
    h1_presence: {
      baselinePriority: "low",
      consequence: "CUSTOM CONSEQUENCE"
    }
  },
  semanticImportanceGuidance:
    "CUSTOM SEMANTIC GUIDANCE",
  hreflangAgreedValues: [
    "en-gb",
    "fr-fr"
  ],
  siteCheckExclusions: [
    {
      hostname: "example.com",
      checks: [
        "h1_presence"
      ],
      note: "CUSTOM EXCLUSION"
    }
  ],
  analyseAll: {
    domDiff: true
  }
};

const merged =
  mergeSettings(saved);

const failures = [];

function expect(
  condition,
  message
) {
  if (!condition) {
    failures.push(message);
  }
}

expect(
  merged.providers.nano.enabled === false,
  "Saved provider enabled state was overwritten."
);

expect(
  merged.providers.nano.temperature === 0.77,
  "Saved provider temperature was overwritten."
);

expect(
  merged.providers.gemini.model ===
    "my-custom-model",
  "Saved provider model was overwritten."
);

expect(
  merged.limits.linkBatchSize === 17,
  "Saved processing limit was overwritten."
);

expect(
  merged.prompts.page_type.system ===
    "CUSTOM SYSTEM PROMPT",
  "Saved system prompt was overwritten."
);

expect(
  merged.prompts.page_type.user ===
    "CUSTOM USER PROMPT",
  "Saved user prompt was overwritten."
);

expect(
  merged.deterministicImpactProfiles
    .h1_presence
    .baselinePriority ===
      "low",
  "Saved impact priority was overwritten."
);

expect(
  merged.deterministicImpactProfiles
    .h1_presence
    .consequence ===
      "CUSTOM CONSEQUENCE",
  "Saved impact consequence was overwritten."
);

expect(
  merged.semanticImportanceGuidance ===
    "CUSTOM SEMANTIC GUIDANCE",
  "Saved semantic guidance was overwritten."
);

expect(
  JSON.stringify(
    merged.hreflangAgreedValues
  ) ===
    JSON.stringify([
      "en-gb",
      "fr-fr"
    ]),
  "Saved hreflang allow-list was overwritten."
);

expect(
  merged.siteCheckExclusions?.[0]?.note ===
    "CUSTOM EXCLUSION",
  "Saved site exclusion was overwritten."
);

expect(
  merged.analyseAll.domDiff === true,
  "Saved full-analysis configuration was overwritten."
);

expect(
  merged.providers.nano.topK ===
    defaults.providers.nano.topK,
  "A missing saved provider field did not inherit the current default."
);

const persistedSecrets =
  persistentSettings({
    ...merged,
    providers: {
      ...merged.providers,
      gemini: {
        ...merged.providers.gemini,
        apiKey:
          "GEMINI_SECRET"
      },
      openai: {
        ...merged.providers.openai,
        apiKey:
          "OPENAI_SECRET"
      }
    }
  });

expect(
  !Object.hasOwn(
    persistedSecrets
      .providers
      .gemini,
    "apiKey"
  ),
  "Gemini API key was retained in persistent settings."
);

expect(
  !Object.hasOwn(
    persistedSecrets
      .providers
      .openai,
    "apiKey"
  ),
  "OpenAI API key was retained in general persistent settings."
);

const providerSecrets =
  providerSecretsFromSettings({
    ...merged,
    providers: {
      ...merged.providers,
      gemini: {
        ...merged.providers.gemini,
        apiKey:
          "GEMINI_SECRET"
      },
      openai: {
        ...merged.providers.openai,
        apiKey:
          "OPENAI_SECRET"
      }
    }
  });

expect(
  providerSecrets.geminiApiKey ===
    "GEMINI_SECRET" &&
  providerSecrets.openaiApiKey ===
    "OPENAI_SECRET",
  "Provider API keys were not extracted for persistent local secret storage."
);

const rehydrated =
  applyProviderSecrets(
    persistedSecrets,
    providerSecrets
  );

expect(
  rehydrated.providers.gemini.apiKey ===
    "GEMINI_SECRET" &&
  rehydrated.providers.openai.apiKey ===
    "OPENAI_SECRET",
  "Persisted provider API keys were not restored into runtime settings."
);

vm.runInContext(
  "DEFAULT_SETTINGS.__contractProbe = { newDefault: 'available' };",
  context
);

const withNewDefault =
  mergeSettings(saved);

expect(
  withNewDefault.__contractProbe
    ?.newDefault ===
      "available",
  "A newly introduced default field was not added to existing settings."
);

if (failures.length) {
  console.error(
    "\nSettings persistence contract failed:"
  );

  for (const failure of failures) {
    console.error(
      "- " +
      failure
    );
  }

  process.exit(1);
}

console.log(
  "PASS saved settings remain authoritative"
);

console.log(
  "PASS missing fields inherit current defaults"
);

console.log(
  "PASS provider API keys are stored separately and restored into runtime settings"
);

console.log(
  "PASS new default keys can be added without rewriting saved config"
);
