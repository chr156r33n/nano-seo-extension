# Chrome Web Store submission notes

These notes are the source of truth for the first public Chrome Web Store submission of Nano SEO Lab 1.0.0.

## Single purpose

**Nano SEO Lab audits the current webpage for technical and semantic SEO signals and helps the user review those findings.**

The deterministic browser checks, rendered-DOM comparison, optional model review, manual HTTP/link checks, history and Jira-ready text drafts all support that page-audit workflow.

## Store listing

### Name

Nano SEO Lab

### Short description

Audit webpages with deterministic SEO checks, rendered-DOM comparison, and optional AI-assisted review.

### Detailed description

Nano SEO Lab is a browser-native SEO auditing tool for inspecting the page you are currently viewing.

It combines deterministic browser checks with optional AI-assisted review so factual page conditions stay separate from contextual judgement.

Core workflow:

- run technical page checks for metadata, canonicals, robots, headings, hreflang, structured data, links, images and related signals;
- compare server HTML with the rendered DOM to surface meaningful JavaScript-driven changes;
- review findings with Chrome's built-in Nano model where available, or optionally with Gemini or OpenAI using your own API key;
- inspect the evidence behind findings rather than receiving a single opaque score;
- run manual link-response and indexability checks when you explicitly need additional network evidence;
- keep analysis history and model-call logs locally for inspection and research.

Nano SEO Lab uses temporary access to the page you invoke it on by default. Persistent website access is optional.

Chrome's built-in Nano review is local to Chrome. Gemini and OpenAI are optional and are only contacted when you select those providers.

### Suggested category

Developer Tools

## Privacy tab

### Single-purpose description

Audit the webpage selected by the user for SEO and rendered-page signals, then optionally use a selected AI model to help interpret those audit findings.

### Remote code

**No.**

The extension does not load or execute remotely hosted JavaScript or WebAssembly. Gemini and OpenAI are optional data-processing APIs that return model output; returned data is parsed as data and is not executed as extension code.

### Data disclosure

The extension processes **website content**, including URLs, page text, rendered HTML and technical metadata, because that is the material being audited.

For a conservative Store disclosure, also disclose **web history** if the dashboard treats locally retained URLs of previously analysed pages as browsing-history data.

If Gemini or OpenAI is used, the relevant page evidence is transmitted directly to the selected provider. The extension also handles **authentication information** in the form of a user-supplied API key, but provider API keys are kept in Chrome session storage rather than persistent extension settings.

Nano SEO Lab does not operate a developer-controlled analytics backend and does not sell or use data for advertising.

Privacy policy URL for submission can point at the public repository's `PRIVACY.md` page.

## Permission justifications

### activeTab

Used to inspect the webpage on which the user invokes Nano SEO Lab. This provides temporary page access without requiring permanent access to all websites by default.

### scripting

Used to read deterministic SEO evidence and rendered-DOM state from the active page and to perform the server-versus-rendered comparison.

### storage

Used for extension configuration, lightweight current-run state and session-only provider API keys. Larger page snapshots, history and model-call records are retained locally in IndexedDB.

### unlimitedStorage

Used because page snapshots, rendered HTML, analysis history and model-call logs can exceed normal extension storage quotas during repeated technical audits. Data remains local to the browser unless the user explicitly selects an external model provider.

### offscreen

Used to provide the document context required for Chrome's built-in LanguageModel API. The offscreen document is local extension code.

### sidePanel

Used to provide the persistent Nano SEO Lab audit interface alongside the webpage being inspected.

### Host permission: generativelanguage.googleapis.com

Allows optional direct calls to Google's Gemini API when the user enables Gemini and supplies their own API key.

### Host permission: api.openai.com

Allows optional direct calls to the OpenAI API when the user enables OpenAI and supplies their own API key.

### Optional host permissions: http://*/* and https://*/*

Used only when the user grants broader website access or explicitly runs network checks that need access to page, canonical, robots.txt or link-destination origins. Default page analysis can use temporary active-tab access instead.

## Reviewer test instructions

1. Install the extension and pin it if useful.
2. Open an ordinary public HTTP or HTTPS webpage.
3. Click the Nano SEO Lab toolbar icon to grant temporary access and open the Side Panel.
4. Click **Run analysis**. Deterministic checks work without configuring an external API.
5. Open the Technical tab and run **DOM comparison** to inspect server-versus-rendered differences.
6. External Gemini/OpenAI credentials are not required to test the core extension. Those providers are optional.
7. If Chrome's built-in Nano model is unavailable on the review device, deterministic auditing and the rest of the non-Nano workflow remain available.

## Store assets still required in the Developer Dashboard

Repository packaging cannot supply the final Store listing media automatically. Before submission prepare:

- at least one representative screenshot of the Side Panel in use (Chrome currently accepts 1280×800 or 640×400 screenshots, with up to five);
- any promotional images you choose to use;
- developer support/contact information;
- distribution settings;
- the public privacy-policy URL;
- Chrome Web Store developer-account two-step verification and the required Store Listing / Privacy declarations.

Keep screenshots focused on the real UI and do not imply functionality that is not present.

## Pre-submission smoke test

Before uploading the ZIP, load the packaged build unpacked and run the core workflow on a normal public webpage. In particular, verify Chrome Nano on a device where the built-in LanguageModel API is available, plus one manual network check that requests an additional origin. The release package intentionally retains the existing offscreen-document Nano runner because that is the architecture tested during development; changing the execution context during release hardening would introduce unnecessary regression risk.
