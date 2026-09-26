# Nano SEO Lab v0.9

This update extends the deterministic page audit and makes **Analyse all** configurable.

## Detailed SEO Extension baseline

The deterministic additions were informed by the public feature set of the Detailed SEO Extension: page metadata, heading structure, link rel data, images, structured data, hreflang and related page-level inspection.

The goal here is not to clone Detailed. It is to create richer deterministic evidence that can later be triaged or interpreted by Nano.

## New deterministic checks / evidence

In addition to the existing title, description, H1, canonical, robots, alt and viewport checks:

### Headings
- H1-H6 extraction with semantic element context
- meaningful heading hierarchy jumps
- low-value areas such as footer/navigation/cookie/utility content are downweighted using the configured semantic weights

### HTML language
- missing `html[lang]`
- implausible language-tag format

### Robots
- all robots meta values captured
- conflicting `index/noindex` or `follow/nofollow` declarations

### Canonical
- fragment in canonical
- HTTPS page canonicalising to HTTP

### Structured data
- JSON-LD parse errors are now retained instead of silently ignored
- existing schema type / URL reference extraction remains

### Hreflang
- duplicate hreflang values
- values outside the configured agreed list
- implausible values
- missing target hrefs

No reciprocal target crawling is added.

### Social/page identity
- Open Graph values
- incomplete partial Open Graph implementations
- `og:url` mismatch with preferred page identity
- Twitter/X card values and partial implementations
- favicon presence

These are intentionally lower-severity candidates for Nano triage rather than being treated as equivalent to indexation failures.

### Links
Deterministic link statistics now include:
- internal / external
- nofollow
- sponsored
- ugc
- empty visible/accessibility anchor
- empty href
- hash-only
- javascript links
- internal HTTP links on HTTPS pages

### Images
Image statistics now include:
- missing alt
- empty alt
- missing width/height attributes
- lazy-loaded count

Empty alt and missing dimensions remain contextual findings; Nano can decide whether they are likely meaningful.

## Configure Analyse all

Config now has an **Analyse all** section with independent toggles for:

- Link context classification
- Page type
- Intent
- Page type ↔ intent alignment
- Triage deterministic findings
- Server HTML ↔ rendered DOM diff
- URL / locale consistency

### Defaults

Everything is enabled **except DOM diff**.

DOM diff remains available manually, but it no longer performs a same-origin refetch on every Analyse all run unless you enable it.

Alignment only runs when both Page type and Intent are enabled.

Deterministic page capture always runs, because every other stage depends on that evidence.

---

# v0.8.4 activeTab / Side Panel fix

This fixes the `service_worker.js:56` failure from v0.8.3.

## Root cause

`chrome.sidePanel.open()` may only be called in direct response to a user action.

v0.8.3 did this:

    await chrome.storage.session.set(...)
    await chrome.sidePanel.open(...)

That first `await` could cause Chrome to no longer treat `sidePanel.open()` as part of the toolbar-click user gesture.

## Fix

The toolbar handler is now deliberately synchronous:

    chrome.action.onClicked.addListener((tab) => {
      chrome.sidePanel.open({ tabId: tab.id });
    });

No storage or other asynchronous work happens before `sidePanel.open()`.

The extension also no longer maintains a second, custom "authorised tab ID" check.

Chrome's own permission model is now the source of truth:

1. click the toolbar icon
2. Chrome grants `activeTab`
3. the Side Panel opens immediately
4. Capture / Analyse All queries the current tab and attempts `chrome.scripting.executeScript()`
5. if Chrome denies access, the extension reports that actual failure

This is simpler and avoids duplicating Chrome's permission state.

---

# v0.8.3 Side Panel / activeTab fix

This fixes the persistent permission loop from v0.8-v0.8.2.

## Root cause

v0.8 called:

    chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true
    });

Chrome persists that side-panel behaviour. Removing the call in a later build does not necessarily reset it.

While the persisted value is `true`, clicking the toolbar icon opens the Side Panel directly instead of firing `chrome.action.onClicked`.

The v0.8.1/v0.8.2 permission design depended on `chrome.action.onClicked` to record the exact tab that received the temporary `activeTab` permission. Because that listener was not firing, the Side Panel kept reporting:

    This tab has not granted Nano SEO Lab temporary access yet

## Fix

v0.8.3 explicitly sets:

    openPanelOnActionClick: false

on:
- install/update
- browser startup
- service-worker startup

The toolbar click now reliably reaches `chrome.action.onClicked`.

That handler:
1. stores the clicked tab ID
2. receives Chrome's `activeTab` grant for that tab
3. opens the Side Panel for that tab

No permanent `<all_urls>` host permission is added.

After replacing the files, reload the unpacked extension once in `chrome://extensions`, then click the toolbar icon on the page you want to analyse.

---

# v0.8.2 Tab targeting fix

This fixes a false "HTTP/HTTPS pages only" error introduced in v0.8.1.

The problem was an early check against `tab.url`. Chrome treats `url` as a sensitive `tabs.Tab` property, so it can be absent even when script injection is allowed via `activeTab`.

v0.8.2 instead:

1. stores the exact tab ID when you click the Nano SEO Lab toolbar icon
2. checks that the same tab is still the active tab
3. executes the analysis against that tab ID directly
4. lets `chrome.scripting.executeScript()` determine whether the page is actually scriptable

If you switch tabs, click the Nano SEO Lab toolbar icon once on the new tab before analysing it.

---

# v0.8.1 Side Panel page-access fix

This package fixes the Side Panel / `activeTab` permission issue in v0.8.

## Important usage

Open Nano SEO Lab by clicking its **toolbar extension icon while on the page you want to analyse**.

That action now:
1. grants Chrome's temporary `activeTab` permission for the current page
2. opens the Nano SEO Lab Side Panel

Buttons inside the persistent Side Panel do not themselves grant `activeTab`.

If you switch to a different tab/site and analysis reports that page access is not active, click the Nano SEO Lab toolbar icon on that tab once, then continue.

The extension still does **not** request permanent access to all websites.

Restricted pages such as `chrome://...`, the Chrome Web Store and extension pages cannot be analysed.

---

# Nano SEO Lab v0.7 consolidated patch

This patch includes everything from v0.6 plus:

- raw rendered HTML and clean HTML page-type/intent modes
- revised split-intent definition
- editable global semantic-importance guidance
- editable semantic weights
- clearer DOM-diff element identity
- hreflang agreed-value validation/suggestions
- canonical/schema/mobile/hreflang URL-consistency review

## Replace

- `defaults.js`
- `service_worker.js`
- `popup.html`
- `popup.js`
- `options.js`
- `history.js`

No manifest change is required.

## Page type / intent modes

The selectable inputs are now:

1. Raw body text
2. Raw rendered HTML
3. Clean HTML
4. Clean Markdown
5. Structured digest
6. Compare all five

Clean HTML removes obvious non-content elements and strips most implementation attributes while preserving useful semantic/link attributes.

## Intent definition

`supporting_intents` is now separate from `secondary_intents`.

Supporting informational content on a product page, such as FAQs, specifications, reviews or usage instructions, should not automatically create split intent.

`split_intent` should only be true when genuinely distinct user goals materially shape the page.

## Semantic importance

Config now contains:

- editable global semantic-importance guidance
- editable weights for hero/main headings/main content/product details/FAQ/reviews/related content/navigation/footer/utility/cookie consent

The guidance is injected into page type, intent, false-positive, DOM-diff and URL-consistency tasks.

Heading details in the structured digest now include:

- tag
- selector
- zone
- component
- semantic weight key
- semantic weight

## DOM diff

Diff items now carry element identity where available:

- tag
- selector
- zone
- component
- semantic weight

The popup displays the element being reviewed before the LLM judgement.

This makes a cookie-banner H2 visibly different from a main product-description H2.

## Hreflang

Config now has an editable **Hreflang agreed values** list.

Example:

    en-GB
    en-US
    fr-FR
    x-default

For every declared hreflang the extension records:

- value
- href
- whether it is in the agreed list
- whether the value looks syntactically plausible
- suggested agreed value when it is not in the list

Matching is case-insensitive, while suggestions preserve the casing in your configured list.

If the agreed list is empty, the extension does not pretend to know your locale strategy.

## URL & locale consistency

A new section reviews declarations on the current page only:

- current URL
- HTML `lang`
- canonical(s)
- hreflang values + hrefs
- JSON-LD `url`, `@id`, `mainEntityOfPage` and `contentUrl` references
- `rel=alternate` media/mobile annotations
- host/protocol/environment patterns

The LLM is explicitly told to look for:

- unexpected dev/stage/UAT/test/preview hosts
- HTTP/HTTPS inconsistencies
- unexpected subdomain/domain switches
- canonical/current mismatches
- page-identity schema refs that disagree with the page
- implausible hreflang mappings
- suspicious mobile alternate mappings

It is also explicitly told that:

- cross-domain hreflang can be valid
- root Organization/WebSite schema IDs are not required to equal the exact current page
- fragment `@id` values are normal
- missing mobile annotations are not a problem for responsive sites
- no hreflang reciprocity/status/target-canonical checks are performed

## No crawling

This feature does not fetch:

- hreflang targets
- canonical targets
- schema URL targets
- mobile alternate targets

It reviews only the declarations available on the current page.


## Jira ticket drafts

Issues can now generate a Jira-ready draft using **Nano**.

Buttons are available for:

- deterministic audit findings
- individual DOM-diff items
- URL/locale consistency findings that are not judged `likely_correct`

Nano receives the issue plus the relevant page/context data and returns:

- summary
- current behaviour
- desired behaviour
- why this is important
- example URL
- evidence

The ticket can be copied from the popup.

This feature creates draft text only. It does not connect to Jira or create a remote ticket.


## v0.7.1 URL consistency hotfix

Section 5 no longer requires a snapshot containing the newer `urlSignals` object.

For older snapshots it falls back to:

- current URL
- canonical / canonicals

This means canonical consistency can always be reviewed.

Capture a fresh analysis run to populate the additional:

- hreflang
- schema URL refs
- mobile annotations
- environment/host signals


## v0.8 Side Panel + Analyse All

The main UI now lives in Chrome's Side Panel rather than an action popup.

### New files

- `manifest.json`
- `sidepanel.html`
- `sidepanel.js`
- `styles.css`

The manifest adds the `sidePanel` permission, removes `default_popup`, and makes the extension action open the Side Panel.

### Analyse all

`Analyse all` runs sequentially:

1. capture current page / create analysis run
2. build deterministic server-refetch vs rendered-DOM diff
3. classify every configured link batch
4. page type for the selected input mode(s)
5. intent for the selected input mode(s)
6. page type ↔ intent alignment
7. triage every deterministic audit finding
8. assess every retained DOM-diff batch
9. review URL / canonical / hreflang / schema / mobile consistency

It uses every provider currently selected in the Side Panel.

The progress bar updates after each model call. Analysis results are accumulated and rendered together when the sequence completes. Individual calls continue to be written to the normal call logs and analysis history.

Jira-ticket generation remains manual and is not included in Analyse All.

Closing the Side Panel while Analyse All is running stops the UI orchestration for that run.


## Lightweight UI/config contracts

Two dependency-free Node checks cover regressions that are easy to miss in manual extension testing:

```bash
node test-site/ui-contrast-contract.mjs
node test-site/settings-persistence-contract.mjs
```

The contrast contract checks named foreground/background pairs on high-risk surfaces. The settings contract verifies that saved user configuration remains authoritative across default updates while newly introduced default keys can still be added.
