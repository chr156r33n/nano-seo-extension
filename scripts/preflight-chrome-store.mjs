#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const runtimeFiles = [
  "manifest.json",
  "db.js",
  "defaults.js",
  "service_worker.js",
  "offscreen.html",
  "offscreen.js",
  "sidepanel.html",
  "sidepanel.js",
  "options.html",
  "options.js",
  "history.html",
  "history.js",
  "logs.html",
  "logs.js",
  "help.html",
  "styles.css",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png"
];

const failures = [];
const fail = message => failures.push(message);

for (const file of runtimeFiles) {
  if (!fs.existsSync(path.join(root, file))) fail("Missing runtime file: " + file);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
} catch (error) {
  fail("manifest.json is invalid JSON: " + error.message);
}

if (manifest) {
  if (manifest.manifest_version !== 3) fail("Chrome Web Store package must use Manifest V3.");
  if (manifest.version !== "1.0.0") fail("Expected release version 1.0.0; found " + manifest.version);
  if (!manifest.description || manifest.description.length > 132) fail("Manifest description must be 1–132 characters.");
  for (const size of ["16", "32", "48", "128"]) {
    if (!manifest.icons?.[size]) fail("Manifest is missing " + size + "px icon.");
  }
  if (manifest.background?.service_worker !== "service_worker.js") fail("Unexpected service worker entry.");
}

const crcTable = (() => {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n += 1) {
    let c = n;

    for (let k = 0; k < 8; k += 1) {
      c =
        (c & 1)
          ? 0xedb88320 ^ (c >>> 1)
          : c >>> 1;
    }

    table[n] = c >>> 0;
  }

  return table;
})();

const crc32 = buffer => {
  let c = 0xffffffff;

  for (const byte of buffer) {
    c =
      crcTable[(c ^ byte) & 0xff] ^
      (c >>> 8);
  }

  return (c ^ 0xffffffff) >>> 0;
};

for (const file of runtimeFiles.filter(file => file.endsWith(".png"))) {
  const buffer =
    fs.readFileSync(
      path.join(root, file)
    );

  if (
    buffer.length < 33 ||
    buffer.subarray(0, 8).toString("hex") !==
      "89504e470d0a1a0a"
  ) {
    fail(file + " is not a valid PNG file.");
    continue;
  }

  let offset = 8;

  while (
    offset + 12 <=
    buffer.length
  ) {
    const length =
      buffer.readUInt32BE(
        offset
      );

    const type =
      buffer
        .subarray(
          offset + 4,
          offset + 8
        )
        .toString(
          "ascii"
        );

    const dataEnd =
      offset +
      8 +
      length;

    if (
      dataEnd + 4 >
      buffer.length
    ) {
      fail(file + " has a truncated " + type + " PNG chunk.");
      break;
    }

    const expected =
      buffer.readUInt32BE(
        dataEnd
      );

    const actual =
      crc32(
        buffer.subarray(
          offset + 4,
          dataEnd
        )
      );

    if (
      expected !==
      actual
    ) {
      fail(file + " has an invalid CRC in its " + type + " PNG chunk.");
      break;
    }

    offset =
      dataEnd +
      4;

    if (
      type ===
      "IEND"
    ) {
      break;
    }
  }
}

for (const file of runtimeFiles.filter(file => file.endsWith(".js"))) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  try {
    new vm.Script(source, {filename: file});
  } catch (error) {
    fail(file + " does not parse: " + error.message);
  }
  if (/\beval\s*\(/.test(source) || /\bnew\s+Function\s*\(/.test(source)) {
    fail(file + " contains dynamic code execution.");
  }
}

for (const file of runtimeFiles.filter(file => file.endsWith(".html"))) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//i.test(source)) {
    fail(file + " loads remotely hosted JavaScript.");
  }
}

try {
  const source = fs.readFileSync(path.join(root, "defaults.js"), "utf8");
  const context = vm.createContext({structuredClone});
  vm.runInContext(
    source +
      "\nthis.__defaults = DEFAULT_SETTINGS;" +
      "\nthis.__persistentSettings = persistentSettings;" +
      "\nthis.__providerSecretsFromSettings = providerSecretsFromSettings;" +
      "\nthis.__applyProviderSecrets = applyProviderSecrets;",
    context
  );

  const withSecrets = structuredClone(context.__defaults);
  withSecrets.providers.gemini.apiKey = "GEMINI_SECRET";
  withSecrets.providers.openai.apiKey = "OPENAI_SECRET";

  const persisted = context.__persistentSettings(withSecrets);
  const secrets = context.__providerSecretsFromSettings(withSecrets);
  const rehydrated = context.__applyProviderSecrets(persisted, secrets);

  if (Object.hasOwn(persisted.providers.gemini, "apiKey") || Object.hasOwn(persisted.providers.openai, "apiKey")) {
    fail("Provider API keys are mixed into the general settings object.");
  }

  if (
    secrets.geminiApiKey !== "GEMINI_SECRET" ||
    secrets.openaiApiKey !== "OPENAI_SECRET" ||
    rehydrated.providers.gemini.apiKey !== "GEMINI_SECRET" ||
    rehydrated.providers.openai.apiKey !== "OPENAI_SECRET"
  ) {
    fail("Persistent local provider-key separation/rehydration contract failed.");
  }
} catch (error) {
  fail("Could not verify settings privacy contract: " + error.message);
}

for (const forbidden of ["popup.html", "popup.js", "README.md", "test-site"]) {
  if (runtimeFiles.some(file => file === forbidden || file.startsWith(forbidden + "/"))) {
    fail("Development-only path is in runtime package list: " + forbidden);
  }
}

if (failures.length) {
  console.error("Chrome Web Store preflight failed:");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log("PASS manifest, required runtime assets and PNG integrity");
console.log("PASS JavaScript syntax and remote-code checks");
console.log("PASS provider secrets separated from general settings and rehydrated locally");
console.log("PASS development-only files excluded from Store package list");
