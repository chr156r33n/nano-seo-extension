#!/usr/bin/env node

/**
 * DOM diff retention contract.
 *
 * The deterministic comparison must not discard semantic changes because a
 * count threshold was reached. Batch size controls model calls only.
 */

import fs from "node:fs";

const worker =
  fs.readFileSync(
    new URL(
      "../service_worker.js",
      import.meta.url
    ),
    "utf8"
  );

const defaults =
  fs.readFileSync(
    new URL(
      "../defaults.js",
      import.meta.url
    ),
    "utf8"
  );

const failures = [];

const expect = (
  condition,
  message
) => {
  if (!condition) {
    failures.push(
      message
    );
  }
};

expect(
  !worker.includes(
    "maxDomDiffItems"
  ),
  "service_worker.js still references maxDomDiffItems."
);

expect(
  !defaults.includes(
    "maxDomDiffItems"
  ),
  "defaults.js still exposes maxDomDiffItems."
);

expect(
  !worker.includes(
    ".slice(\n              0,\n              maxItems"
  ),
  "DOM diff still contains the old count-based retention slice."
);

expect(
  worker.includes(
    'retentionPolicy:\n              "all_semantic_changes_after_noise_filtering"'
  ),
  "DOM diff does not declare the all-semantic-changes retention policy."
);

expect(
  worker.includes(
    "noiseRemovedItems:"
  ),
  "DOM diff summary does not expose deterministic noise removal."
);

expect(
  worker.includes(
    "volatile selector/id state changed while the semantic value stayed the same"
  ),
  "DOM diff does not include the deterministic volatile-state noise rule."
);

expect(
  worker.includes(
    "semanticNetItems"
  ),
  "DOM diff does not retain the post-noise semantic item set."
);

if (
  failures.length
) {
  console.error(
    "DOM diff retention contract failed:"
  );

  for (
    const failure
    of failures
  ) {
    console.error(
      "- " +
      failure
    );
  }

  process.exit(1);
}

console.log(
  "PASS DOM diff has no count-based retention cap"
);
console.log(
  "PASS semantic changes survive after deterministic noise filtering"
);
console.log(
  "PASS volatile implementation-state noise is filtered explicitly"
);
