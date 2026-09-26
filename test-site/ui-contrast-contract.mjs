#!/usr/bin/env node

/**
 * Small UI contrast contract for Nano SEO Lab.
 *
 * Run:
 *   node test-site/ui-contrast-contract.mjs
 *
 * Covers named, high-risk foreground/background pairs. Add a contract whenever
 * text is introduced on a non-default surface.
 */

import fs from "node:fs";

const css =
  fs.readFileSync(
    new URL("../styles.css", import.meta.url),
    "utf8"
  );

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value.split("").map(char => char + char).join("")
      : value;

  if (!/^[0-9a-f]{6}$/i.test(full)) {
    throw new Error("Unsupported colour: " + hex);
  }

  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16)
  ];
}

function luminance(hex) {
  const channels =
    hexToRgb(hex)
      .map(value => value / 255)
      .map(
        value =>
          value <= 0.04045
            ? value / 12.92
            : Math.pow((value + 0.055) / 1.055, 2.4)
      );

  return (
    channels[0] * 0.2126 +
    channels[1] * 0.7152 +
    channels[2] * 0.0722
  );
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

function variable(name) {
  const match =
    css.match(
      new RegExp(
        name.replace(/[.*+?^$()|[\]\\]/g, "\\$&") +
        "\\s*:\\s*(#[0-9a-fA-F]{3,6})"
      )
    );

  if (!match) {
    throw new Error("Missing CSS variable " + name);
  }

  return match[1];
}

function selectorBlock(selector) {
  const escaped =
    selector.replace(
      /[.*+?^$()|[\]\\]/g,
      "\\$&"
    );

  const match =
    css.match(
      new RegExp(
        escaped + "\\s*\\{([^}]*)\\}",
        "m"
      )
    );

  if (!match) {
    throw new Error("Missing CSS selector " + selector);
  }

  return match[1];
}

const colours = {
  brand: variable("--brand"),
  brandDark: variable("--brand-dark"),
  ink: variable("--ink"),
  paper: variable("--paper")
};

const contracts = [
  {
    name: "Primary text on full-analysis surface",
    foreground: "#ffffff",
    background: colours.brand,
    minimum: 4.5
  },
  {
    name: "Advanced run setting labels on full-analysis surface",
    foreground: "#ffffff",
    background: colours.brand,
    minimum: 4.5
  },
  {
    name: "Advanced run setting input text",
    foreground: colours.ink,
    background: colours.paper,
    minimum: 4.5
  },
  {
    name: "Primary button text on full-analysis surface",
    foreground: colours.brandDark,
    background: colours.paper,
    minimum: 4.5
  }
];

const requiredDeclarations = [
  {
    selector: ".analyse-all-advanced > summary",
    pattern: /color:\s*#fff(?:fff)?\s*;/i,
    reason: "Advanced settings summary must remain white on the brand surface."
  },
  {
    selector: ".analyse-all-advanced input",
    pattern: /background:\s*#fff(?:fff)?\s*;[\s\S]*color:\s*var\(--ink\)\s*;/i,
    reason: "Advanced inputs need a light surface with dark text."
  }
];

const failures = [];

for (const contract of contracts) {
  const ratio =
    contrast(
      contract.foreground,
      contract.background
    );

  if (ratio < contract.minimum) {
    failures.push(
      contract.name + ": " +
      ratio.toFixed(2) + ":1 < " +
      contract.minimum + ":1"
    );
  } else {
    console.log(
      "PASS " +
      contract.name +
      ": " +
      ratio.toFixed(2) +
      ":1"
    );
  }
}

for (const contract of requiredDeclarations) {
  try {
    const block =
      selectorBlock(
        contract.selector
      );

    if (!contract.pattern.test(block)) {
      failures.push(
        contract.selector +
        ": " +
        contract.reason
      );
    } else {
      console.log(
        "PASS " +
        contract.selector
      );
    }
  } catch (error) {
    failures.push(
      error.message
    );
  }
}

if (failures.length) {
  console.error(
    "\\nUI contrast contract failed:"
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
  "\\nUI contrast contract passed."
);
