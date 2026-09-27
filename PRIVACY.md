# Nano SEO Lab Privacy Policy

Effective date: 27 September 2026

Nano SEO Lab is a browser extension for inspecting webpages with deterministic SEO checks, server-versus-rendered comparisons, and optional AI-assisted review.

## What data the extension handles

When you ask Nano SEO Lab to inspect a page, it can process information from that page including:

- the page URL and title;
- page text and rendered HTML;
- headings, links, images, metadata, structured data and related technical signals;
- deterministic audit results and model-review results;
- URLs requested by manual link-response, canonical or robots checks.

Nano SEO Lab does not intentionally collect account passwords, payment details, health data, personal communications or other unrelated personal information.

## Where data is stored

Page snapshots, analysis runs, model-call logs and cached model results are stored locally in your browser using extension storage and IndexedDB.

Configuration such as model choices, processing limits, prompts and audit preferences is stored locally in Chrome.

Gemini and OpenAI API keys are stored persistently in local Chrome extension storage so you do not need to re-enter them each time you open Chrome. They are kept separately from the extension's general settings and are not synced by Nano SEO Lab to any developer-operated service.

You can clear cached model results separately or delete all locally stored analysis data from the extension's Settings page.

## AI processing

### Chrome built-in Nano

When Chrome's built-in LanguageModel API is selected, model inference runs through Chrome's local built-in AI capability. Nano SEO Lab does not send that model request to a server operated by the Nano SEO Lab developer.

### Gemini API

Gemini is optional. If you enable Gemini and provide your own API key, Nano SEO Lab sends the evidence required for the selected review task directly from your browser to Google's Generative Language API. The API key is sent to Google as part of that request.

### OpenAI API

OpenAI is optional. If you enable OpenAI and provide your own API key, Nano SEO Lab sends the evidence required for the selected review task directly from your browser to the OpenAI API. The API key is sent to OpenAI in the request authorization header.

Data sent to Google or OpenAI is subject to the terms and privacy practices of the provider you choose.

## Network checks

Some checks are deliberately manual because they make additional network requests. These include link-response checks and checks of HTTP headers, robots.txt and canonical targets.

Nano SEO Lab requests website access only when needed. By default it uses Chrome's temporary active-tab access. You can optionally grant persistent access to ordinary HTTP and HTTPS websites from Settings.

## Data sharing, sale and advertising

Nano SEO Lab does not:

- operate a developer-controlled analytics or telemetry service;
- sell user data;
- use user data for advertising;
- share page-analysis data with third parties other than an AI provider you explicitly select for a model-review task;
- load or execute remotely hosted extension code.

## Retention and deletion

Local page snapshots, analysis history, model-call logs and cached model results remain in the browser until they are cleared by the user or removed with the extension.

Use **Settings → Clear all local analysis data** to delete local snapshots, analysis history, model-call logs and cached model results.

API keys stored for Gemini or OpenAI remain in local Chrome extension storage until you replace them, restore defaults, clear extension storage, or uninstall the extension.

Uninstalling the extension removes its extension storage according to Chrome's normal extension-data behaviour.

## Changes to this policy

This policy may be updated when Nano SEO Lab's data handling changes. Material changes will be reflected in the repository and the Chrome Web Store listing as appropriate.

## Contact

For questions about Nano SEO Lab or this privacy policy, use the issue tracker for the Nano SEO Lab GitHub repository.
