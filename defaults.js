
const HREFLANG_LANGUAGE_CODES = [
  "aa", "ab", "ae", "af", "ak", "am", "an", "ar", "as", "av", "ay", "az",
  "ba", "be", "bg", "bi", "bm", "bn", "bo", "br", "bs", "ca", "ce", "ch",
  "co", "cr", "cs", "cu", "cv", "cy", "da", "de", "dv", "dz", "ee", "el",
  "en", "eo", "es", "et", "eu", "fa", "ff", "fi", "fj", "fo", "fr", "fy",
  "ga", "gd", "gl", "gn", "gu", "gv", "ha", "he", "hi", "ho", "hr", "ht",
  "hu", "hy", "hz", "ia", "id", "ie", "ig", "ii", "ik", "io", "is", "it",
  "iu", "ja", "jv", "ka", "kg", "ki", "kj", "kk", "kl", "km", "kn", "ko",
  "kr", "ks", "ku", "kv", "kw", "ky", "la", "lb", "lg", "li", "ln", "lo",
  "lt", "lu", "lv", "mg", "mh", "mi", "mk", "ml", "mn", "mr", "ms", "mt",
  "my", "na", "nb", "nd", "ne", "ng", "nl", "nn", "no", "nr", "nv", "ny",
  "oc", "oj", "om", "or", "os", "pa", "pi", "pl", "ps", "pt", "qu", "rm",
  "rn", "ro", "ru", "rw", "sa", "sc", "sd", "se", "sg", "sh", "si", "sk",
  "sl", "sm", "sn", "so", "sq", "sr", "ss", "st", "su", "sv", "sw", "ta",
  "te", "tg", "th", "ti", "tk", "tl", "tn", "to", "tr", "ts", "tt", "tw",
  "ty", "ug", "uk", "ur", "uz", "ve", "vi", "vo", "wa", "wo", "xh", "yi",
  "yo", "za", "zh", "zu"
];

const HREFLANG_REGION_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT",
  "AU", "AW", "AX", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI",
  "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY",
  "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN",
  "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM",
  "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK",
  "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL",
  "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM",
  "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR",
  "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN",
  "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS",
  "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK",
  "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW",
  "MX", "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP",
  "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM",
  "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW",
  "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM",
  "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF",
  "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW",
  "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW"
];

const HREFLANG_SPECIAL_EXAMPLES = [
  "x-default",
  "en-GB",
  "en-US",
  "de-CH",
  "fr-CA",
  "pt-BR",
  "pt-PT",
  "es-MX",
  "zh-Hans",
  "zh-Hant",
  "zh-Hans-US"
];

const MODEL_EVIDENCE_GUIDANCE = `Evidence quality:
- Explain conclusions from supplied evidence.
- Do not speculate about why a page, element, content choice or implementation exists.
- Do not attribute motives, strategies, goals, causes or intentions to site owners, authors, developers or businesses unless the supplied evidence states them.
- When a rationale is requested, explain why the conclusion follows from the evidence, not why the implementation was supposedly chosen.
- Omit unknown causes rather than filling gaps with a plausible story. Semantic or contextual inference is allowed only when the task asks for it and the evidence supports it.`;

const DEFAULT_SETTINGS = {
  providers: {
    nano: { enabled: true, temperature: 0.2, topK: 3 },
    gemini: { enabled: false, apiKey: "", model: "gemini-3.8-flash" },
    openai: { enabled: false, apiKey: "", model: "gpt-5.6-luna" }
  },

  limits: {
    bodyChars: 12000,
    linkBatchSize: 8,
    findingBatchSize: 5,
    maxFindingReviewItems: 100,
    maxLinksForClassification: 40,
    maxLinkResponseChecks: 100,
    linkResponseConcurrency: 6,
    linkResponseTimeoutMs: 12000,
    contextChars: 320,
    domDiffBatchSize: 6,
    maxSchemaUrlRefs: 40
  },

  semanticImportanceGuidance: `Judge semantic importance by an element's role in communicating the page's primary topic and user goal, not simply by its HTML tag.

Generally prioritise primary/main content, product/category/service information, prominent hero content, headings closely related to the main topic, and information needed to understand, evaluate or act on the page.

Generally downweight cookie/consent UI, navigation, menus, footer content, legal boilerplate, account/utility controls, repeated sitewide content, unrelated recommendations, and modal/hidden interface content.

A heading is not important merely because it is an H1/H2/H3. Its importance depends on its relationship to the page's primary topic and purpose.`,

  semanticWeights: {
    hero_primary: 2.0,
    main_h1: 2.0,
    main_h2: 1.25,
    main_content: 1.0,
    product_details: 1.25,
    faq: 0.6,
    reviews: 0.75,
    related_content: 0.5,
    navigation: 0.15,
    footer: 0.1,
    utility: 0.1,
    cookie_consent: 0.0
  },

  hreflangAgreedValues: [],

  siteCheckExclusions: [],

  analyseAll: {
    linkContext: true,
    pageType: true,
    intent: true,
    alignment: true,
    triageFindings: true,
    domDiff: false,
    urlConsistency: true
  },

  prompts: {
    link_group: {
      system: "You classify webpage links by their role in the page. Use only the supplied evidence. Be conservative when context is ambiguous.",
      user: `Classify each link into exactly one category:
primary_navigation, secondary_navigation, breadcrumb, footer, editorial_contextual, related_content, product_category, cta, pagination, legal, social, utility, other.

Return one result per supplied id. Do not infer facts not present in the input.

LINKS:
{{links_json}}`
    },

    page_type: {
      system: "You classify webpages from browser-extracted evidence. Judge semantic importance by page role, not HTML tag level. Do not judge search intent here.",
      user: `Classify the structural/page type using exactly one primary type:
homepage, product, category_listing, article_editorial, location, service, comparison, faq, search_results, other.

SEMANTIC IMPORTANCE GUIDANCE:
{{semantic_guidance}}

PAGE EVIDENCE:
{{page_json}}`
    },

    intent: {
      system: "You infer the user goal served by a page. Do not confuse informational content with a separate informational user goal. Judge semantic importance by page role, not heading level.",
      user: `Infer the user intent this page actually serves.

Primary intent must be one of:
transactional, commercial_investigation, informational, navigational, local, mixed, unclear.

Supporting content does NOT automatically create a secondary intent. FAQs, specifications, product details, reviews, delivery information, usage instructions and explanatory copy may simply support the dominant goal.

Use:
- supporting_intents for content forms that help satisfy the primary goal
- secondary_intents only for genuinely distinct user goals that could plausibly justify a separate destination page/search result
- split_intent = true only when two or more distinct user goals materially shape the page

SEMANTIC IMPORTANCE GUIDANCE:
{{semantic_guidance}}

PAGE EVIDENCE:
{{page_json}}`
    },

    alignment: {
      system: "You compare independently-derived page type and intent findings. You are looking for mismatch or meaningful split intent, not enforcing simplistic one-to-one mappings.",
      user: `Assess whether the page structure/type is appropriate for the intent(s) the page appears to serve.

PAGE TYPE RESULT:
{{page_type_json}}

INTENT RESULT:
{{intent_json}}

PAGE SUMMARY:
{{page_summary_json}}`
    },

    false_positive: {
      system: "You assess the practical impact of deterministic SEO audit findings. First separate whether the detector's literal condition is actually present from whether that real condition has meaningful impact. Use likely_false_positive only when the detector itself appears factually wrong about the condition it claims to have found. If the supplied deterministic evidence confirms the condition exists, do not call it a false positive; use no_material_impact, low_impact, context_dependent, meaningful_issue or manual_review instead. The SPECIFIC AFFECTED EVIDENCE is the primary evidence and must be inspected before using general page context. Use the trusted consequence profile to understand the kinds of impact the check can have, but do not invent impacts that are not supported by the evidence. Cite concrete supplied values, URLs, selectors, zones or element properties in evidence_used and the rationale.",
      user: `Assess this deterministic audit finding on this specific page.

Classify the overall finding as exactly one of:
likely_false_positive
no_material_impact
low_impact
context_dependent
meaningful_issue
manual_review

Use these labels consistently:
- likely_false_positive: the detector's literal factual claim is probably wrong; use this only when the supplied evidence suggests the detected condition itself is not actually present
- no_material_impact: the condition is definitely present, but the supplied context indicates no meaningful practical consequence on this page
- low_impact: the condition is definitely present and has a limited practical consequence
- context_dependent: the condition is present, but its consequence materially depends on page/site context that cannot be resolved confidently from the supplied evidence
- meaningful_issue: the condition is present and the supplied evidence supports a meaningful consequence worth action within the configured consequence profile
- manual_review: the evidence is insufficient to determine either the condition or its consequence reliably

IMPORTANT:
- Return all required fields: judgement, confidence, rationale, evidence_used, item_assessments, useful_context.
- First answer the factual question: does the supplied deterministic evidence establish that the detector's literal condition exists?
- If yes, likely_false_positive is not an allowed interpretation. A real-but-benign condition is no_material_impact, not a false positive.
- A stylistic, semantic or best-practice disagreement does not make a detector false positive when its literal condition is present.
- Inspect SPECIFIC AFFECTED EVIDENCE first.
- Do not base the judgement mainly on aggregate page counts.
- The consequence profile gives the permitted impact framing and baseline priority. Do not promote an issue above that baseline merely because it is real.
- evidence_used must identify concrete supplied evidence, not generic SEO principles. Return no more than 6 evidence_used items.
- If the evidence contains an examples array, assess every supplied example individually in item_assessments using the same judgement labels.
- If there are no individual examples, return an empty item_assessments array.

TRUSTED CONSEQUENCE PROFILE:
{{impact_profile_json}}

SPECIFIC AFFECTED EVIDENCE:
{{evidence_json}}

RULE-SPECIFIC GUIDANCE:
{{guidance}}

FINDING:
{{issue_json}}

PAGE CONTEXT:
{{context_json}}

GLOBAL SEMANTIC IMPORTANCE GUIDANCE:
{{semantic_guidance}}`
    },

    dom_diff_summary: {
      system: "You turn deterministic server-HTML vs rendered-DOM evidence into a concise, natural explanation for a human reviewer. You do not decide severity, importance, priority, impact category, or whether action is required. Verified facts are authoritative.",
      user: `Explain each supplied DOM difference in natural language so a reviewer can understand why it is worth looking at without having to mentally reconstruct the raw evidence.

Your role is to reduce interpretation friction, not repeat the evidence field-by-field and not make the decision for the reviewer.

Write the summary as a useful synthesis:
- lead with the meaningful change, not the data structure
- combine related facts into one clear explanation rather than listing every status, boolean or field
- mention technical details only when they materially help explain what changed
- where relevant, contrast the practical server-HTML and rendered behaviour in plain English
- for link destination changes, prioritise destination outcome: whether each URL works, whether they resolve to the same final URL, and whether their declared canonicals overlap
- if two different hrefs converge on the same final URL or canonical destination, say that explicitly because it materially changes how the difference should be understood
- only mention zone, component or nearby DOM context when it genuinely helps identify or explain the changed element
- use surrounding content to make the explanation intelligible, but do not invent meaning that is not supplied
- preserve genuine uncertainty where it matters

Do not:
- merely restate every supplied fact
- describe an unchanged anchor as changed, or an href as anchor text
- invent causes, penalties, indexing outcomes, crawler behaviour or implementation details
- infer page scope or intent from URL folder names
- assign severity, importance, confidence, priority or a recommendation

Aim for one or two natural sentences per item.

EXPECTED IDS:
{{expected_ids_json}}

Return exactly one result for every expected id above.

DOM EVIDENCE:
{{diff_json}}`
    },

    dom_diff_triage: {
      system: "You assess the practical significance of a verified server-HTML vs rendered-DOM difference. Verified facts are authoritative. Judge the specific change in context without inventing unsupported technical consequences.",
      user: `Judge the practical significance of the supplied server-HTML vs rendered-DOM change for SEO and users.

VERIFIED facts are authoritative. Do not contradict them or invent facts that are not supplied.

Use:
- before / after for the changed value
- context for the surrounding page meaning
- verified for established technical facts
- transformation for compact wording/factual changes

The output field change_area describes the area of the change, not whether it is harmful:
- link_destination: href/destination changes
- anchor_context: anchor wording/context changes where the destination itself is unchanged
- page_understanding: heading/content meaning changes
- indexing_control, content_retrieval, url_consistency, structured_data or ui_only when those are the best factual fit
- judgement expresses likely practical significance

Rules:
- do not infer page scope, hierarchy or intent from URL folder names alone
- a different href that resolves to the same final URL can still be a link_destination change without being an important discovery problem
- use anchor_context for anchor-text-only changes when the destination and availability are unchanged
- if a working link is unavailable in server HTML but available after rendering, that rendering dependency is relevant when judging the destination change
- semantic_weight is element importance, not change severity
- uncertainty fields mean evidence is incomplete; do not silently resolve them

GLOBAL SEMANTIC IMPORTANCE GUIDANCE:
{{semantic_guidance}}

CMS CONTEXT:
{{cms_context_json}}

EXPECTED IDS:
{{expected_ids_json}}

Return exactly one result for every expected id above.

VERIFIED DOM ITEM:
{{diff_json}}`
    },

    url_consistency: {
      system: "You review URL, locale and page-identity signals declared by the current document. Do not crawl or assume anything about target URLs that was not supplied. Different locale subdomains/domains can be valid. Missing mobile annotations are not a problem on responsive sites.",
      user: `Review these page identity signals as a set and decide whether they look internally consistent and logically correct.

Pay particular attention to:
- current URL vs canonical
- unexpected host/subdomain changes
- development/staging/preview/test hosts leaking into production declarations
- HTTP vs HTTPS inconsistencies
- schema URL/@id/mainEntityOfPage references that appear to identify this page but disagree with its canonical/current URL
- rel=alternate media/mobile annotations that point to an unexpected host, protocol or page
- contradictions across these supplied identity signals

Important:
- hreflang is validated deterministically elsewhere and is intentionally not part of this model task
- schema Organization/WebSite identifiers can legitimately point to a root or entity URL rather than the exact current page
- fragment @id values based on the canonical/current URL are normal
- do not flag absence of a rel=alternate mobile annotation by itself
- do not check HTTP status, target canonicals or target content

GLOBAL SEMANTIC IMPORTANCE GUIDANCE:
{{semantic_guidance}}

DECLARED URL/PAGE-IDENTITY SIGNALS:
{{url_signals_json}}`
    },

    jira_ticket: {
      system: "You draft concise Jira tickets for technical SEO and browser-rendering issues. Use only the supplied evidence. Do not invent implementation details, root causes, or acceptance criteria that cannot be inferred from the evidence.",
      user: `Create a concise Jira ticket for this issue.

Use the supplied URL as the concrete example.

Keep the ticket practical and brief. Explain observed behaviour rather than speculating about implementation.

Required structure:
- summary: short ticket title
- current_behavior: what is currently happening, using the example URL where useful
- desired_behavior: what should happen instead
- why_important: brief SEO/search/AI-retrieval reason
- example_url
- evidence: the key facts that support the ticket

GLOBAL SEMANTIC IMPORTANCE GUIDANCE:
{{semantic_guidance}}

ISSUE-SPECIFIC GUIDANCE:
{{guidance}}

ISSUE:
{{issue_json}}

CONTEXT:
{{context_json}}

EXAMPLE URL:
{{example_url}}`
    }
  },

  deterministicImpactProfiles: {
    h1_presence: {
      impacts: ["Page understanding", "Accessibility"],
      baselinePriority: "low",
      consequence: "A missing H1 can weaken document structure and accessibility, but is not itself an indexing requirement."
    },
    multiple_h1: {
      impacts: ["Page understanding", "Accessibility"],
      baselinePriority: "low",
      consequence: "Multiple H1s can create ambiguous structure when several important headings compete, but multiple H1 elements are not inherently harmful."
    },
    title_presence: {
      impacts: ["Ranking", "CTR", "Search appearance"],
      baselinePriority: "high",
      consequence: "A missing document title removes an important relevance and search-result presentation signal."
    },
    title_length: {
      impacts: ["CTR", "Search appearance"],
      baselinePriority: "low",
      consequence: "Title length mainly affects clarity and search-result presentation; length alone does not determine ranking or indexability."
    },
    meta_description_presence: {
      impacts: ["CTR", "Search appearance"],
      baselinePriority: "low",
      consequence: "A missing meta description can reduce control over search snippets but does not prevent crawling or indexing."
    },
    meta_description_length: {
      impacts: ["CTR", "Search appearance"],
      baselinePriority: "low",
      consequence: "Meta-description length mainly affects snippet quality and messaging rather than crawling, indexing or ranking directly."
    },
    canonical_presence: {
      impacts: ["Indexing", "Canonicalisation"],
      baselinePriority: "medium",
      consequence: "A missing canonical can leave duplicate or parameterised URLs without an explicit preferred-URL signal."
    },
    multiple_canonical: {
      impacts: ["Indexing", "Canonicalisation"],
      baselinePriority: "high",
      consequence: "Multiple canonical declarations can create conflicting preferred-URL signals, especially when their targets differ."
    },
    canonical_cross_origin: {
      impacts: ["Indexing", "Canonicalisation"],
      baselinePriority: "medium",
      consequence: "A cross-origin canonical can transfer preferred-page signals away from the current host when it is not intentional."
    },
    canonical_relationship: {
      impacts: ["Indexing", "Canonicalisation"],
      baselinePriority: "medium",
      consequence: "A same-origin canonical that points to a different URL may intentionally consolidate duplicate or parameterised variants, but it can also suppress the current URL when the target is not the intended equivalent page."
    },
    canonical_fragment: {
      impacts: ["Indexing", "Canonicalisation"],
      baselinePriority: "medium",
      consequence: "Canonical fragments are generally unsuitable for document-level canonicalisation and may create an unclear preferred URL."
    },
    canonical_protocol_downgrade: {
      impacts: ["Indexing", "Canonicalisation", "Crawl efficiency"],
      baselinePriority: "high",
      consequence: "Canonicalising an HTTPS page to HTTP can create conflicting preferred-URL and redirect signals."
    },
    canonical_relative_href: {
      impacts: ["Canonicalisation", "Implementation quality"],
      baselinePriority: "low",
      consequence: "Relative canonicals usually resolve correctly in browsers, but absolute canonicals are safer and less ambiguous across processing pipelines."
    },
    robots_noindex: {
      impacts: ["Indexing"],
      baselinePriority: "high",
      consequence: "Noindex directly prevents eligible pages from remaining indexed when the directive is discovered and honoured."
    },
    robots_conflict: {
      impacts: ["Indexing", "Crawling"],
      baselinePriority: "high",
      consequence: "Conflicting robots directives can make intended index/follow behaviour unclear across crawlers."
    },
    robots_googlebot_conflict: {
      impacts: ["Indexing", "Crawling"],
      baselinePriority: "high",
      consequence: "Conflicting generic robots and Googlebot-specific directives can produce crawler-specific index/follow behaviour."
    },
    heading_hierarchy: {
      impacts: ["Page understanding", "Accessibility"],
      baselinePriority: "low",
      consequence: "Heading hierarchy can affect document structure and accessibility, but skipped levels are not inherently a crawling or indexing problem."
    },
    html_lang_presence: {
      impacts: ["Accessibility", "Language understanding"],
      baselinePriority: "low",
      consequence: "A missing lang attribute can reduce accessibility and language identification but does not usually block indexing."
    },
    html_lang_format: {
      impacts: ["Accessibility", "Language understanding"],
      baselinePriority: "low",
      consequence: "An invalid lang value can weaken language identification and assistive-technology behaviour."
    },
    jsonld_parse_error: {
      impacts: ["Structured data", "Search appearance"],
      baselinePriority: "medium",
      consequence: "Invalid JSON-LD can prevent structured-data consumers from parsing the affected block and can remove eligibility for enhanced search features."
    },
    hreflang_duplicate_value: {
      impacts: ["International targeting", "Indexing"],
      baselinePriority: "medium",
      consequence: "Duplicate locale declarations are problematic when the same hreflang value points to competing destination URLs."
    },
    hreflang_unapproved_value: {
      impacts: ["International targeting", "Implementation consistency"],
      baselinePriority: "low",
      consequence: "A locale outside the configured project allow-list can indicate inconsistent international targeting or naming conventions."
    },
    hreflang_invalid_format: {
      impacts: ["International targeting"],
      baselinePriority: "medium",
      consequence: "Invalid hreflang language or region syntax can prevent that declaration from being interpreted as intended."
    },
    hreflang_empty_href: {
      impacts: ["International targeting"],
      baselinePriority: "medium",
      consequence: "A hreflang declaration without a usable target cannot provide a valid alternate-locale relationship."
    },
    open_graph_incomplete: {
      impacts: ["Social sharing", "CTR", "Brand credibility"],
      baselinePriority: "low",
      consequence: "Incomplete Open Graph metadata can produce poor or inconsistent social previews but does not affect crawling or indexing directly."
    },
    og_url_mismatch: {
      impacts: ["Social sharing", "Page identity"],
      baselinePriority: "low",
      consequence: "An unexpected og:url can make shared-page identity inconsistent even when core search canonicalisation is unaffected."
    },
    twitter_card_incomplete: {
      impacts: ["Social sharing", "CTR", "Brand credibility"],
      baselinePriority: "low",
      consequence: "Incomplete Twitter/X card metadata can degrade shared-link previews but does not affect crawling or indexing directly."
    },
    favicon_presence: {
      impacts: ["CTR", "Brand credibility", "UX"],
      baselinePriority: "low",
      consequence: "A missing favicon can reduce visual recognition and perceived polish in browser/search surfaces but does not affect crawling or indexing."
    },
    images_missing_alt: {
      impacts: ["Accessibility", "Image understanding"],
      baselinePriority: "medium",
      consequence: "Missing alt text matters when an image conveys information or functions as a control; decorative images can legitimately omit meaningful alt text."
    },
    iframe_embedded_content: {
      impacts: ["Page understanding", "Indexing context", "Content attribution"],
      baselinePriority: "context-dependent",
      consequence: "Content inside iframes can be indexed or attributed differently from normal parent-page DOM. Same-origin iframe contents are counted separately when readable; inaccessible frames remain an uncertainty. Google's noindex + indexifembedded directive can make embedded content eligible for indexing as part of the parent page, but that behaviour is Google-specific."
    },
    images_empty_alt: {
      impacts: ["Accessibility", "Image understanding"],
      baselinePriority: "low",
      consequence: "Empty alt text is correct for decorative images but problematic when meaningful or functional image content becomes inaccessible."
    },
    images_missing_dimensions: {
      impacts: ["UX", "Performance"],
      baselinePriority: "low",
      consequence: "Missing intrinsic dimensions can contribute to layout instability when space is not otherwise reserved."
    },
    links_empty_anchor: {
      impacts: ["Accessibility", "Link understanding", "Crawl context"],
      baselinePriority: "medium",
      consequence: "A genuinely unnamed link can reduce accessibility and weaken contextual understanding of the destination."
    },
    internal_http_links: {
      impacts: ["Crawl efficiency", "Page quality"],
      baselinePriority: "low",
      consequence: "HTTP links from an HTTPS page can introduce avoidable redirects and inconsistent secure URL references."
    },
    viewport_presence: {
      impacts: ["UX", "Mobile usability"],
      baselinePriority: "medium",
      consequence: "A missing viewport declaration can make pages difficult to use on mobile devices, though it does not directly prevent crawling or indexing."
    },
    pagination_page1_parameter: {
      impacts: ["Crawl efficiency", "Canonicalisation"],
      baselinePriority: "low",
      consequence: "Linking back to an explicit page=1 variant can create an unnecessary duplicate URL when the sequence root is the preferred first page."
    },
    duplicate_title_element: {
      impacts: ["Search appearance", "Page understanding"],
      baselinePriority: "medium",
      consequence: "Multiple HTML document title elements create ambiguous title metadata; non-HTML titles such as SVG titles should not count."
    },
    duplicate_meta_description: {
      impacts: ["Search appearance", "Implementation quality"],
      baselinePriority: "low",
      consequence: "Multiple meta-description elements create ambiguous snippet metadata even though search engines may simply choose or ignore one."
    },
    rendered_head_invalid_element: {
      impacts: ["Indexing", "Metadata parsing", "Structured data"],
      baselinePriority: "high",
      consequence: "Invalid elements in the document head can change parser state and displace later canonical, robots, metadata or structured-data declarations."
    }
  },

  falsePositiveGuidance: {
    h1_presence: `A missing H1 is not automatically a serious problem if the page's main topic is still clearly expressed through other prominent headings or page structure. It is more concerning when the page lacks any clear primary heading or topic signal.`,

    multiple_h1: `Multiple H1s are not automatically harmful. They are more likely to be harmless when additional H1s come from templates, components, modals, recommendations, cookie UI or clearly secondary page regions. They are more concerning when several visible, topically important H1s compete to represent the main page topic.`,

    title_presence: `A missing title is generally a meaningful issue on an indexable page intended for search. It may be less meaningful on utility, internal, transient, or intentionally non-indexable pages.`,

    title_length: `A long title is not automatically a problem. Treat it as likely harmless when the primary topic or target phrase is clear and front-loaded, especially if the extra length comes from useful modifiers or branding. Treat it as more problematic when the title is vague, repetitive, unfocused, keyword-stuffed, or buries or omits the main topic. A short title is more concerning when it fails to describe the page clearly, but can be acceptable when the page topic is inherently concise and unambiguous.`,

    meta_description_presence: `A missing meta description is more meaningful on important indexable landing pages where a concise search snippet would be useful. It may be less meaningful on utility pages, dynamically generated pages, or pages where search engines are likely to construct a better snippet from the content.`,

    meta_description_length: `A long meta description is not automatically a problem. Prioritise whether it clearly communicates the page topic and value proposition early. Extra relevant detail is usually harmless. Treat it as more problematic when it is repetitive, generic, unfocused, padded, or fails to communicate the page's purpose early.`,

    canonical_presence: `A missing canonical is not automatically harmful when the page is clearly unique and has no realistic duplicate or parameter variants, but it can create ambiguity on duplicate-prone, parameterised, syndicated, paginated, or templated URLs.`,

    multiple_canonical: `Multiple canonical declarations are more concerning when they disagree or point to different targets. Repeated identical canonicals may be redundant but are less likely to create a meaningful indexing problem.`,

    canonical_cross_origin: `A cross-domain canonical can be intentional for syndicated, duplicated, migrated, regional, or otherwise equivalent content. Judge whether the target plausibly represents the preferred equivalent page. It is more concerning when the canonical appears unrelated, mismatched, insecure, on an unexpected environment, or inconsistent with the visible page.`,

    canonical_relationship: `This finding means the canonical target is on the same origin but is not the current URL. Do not treat non-self canonicalisation as automatically wrong. Query removal can be appropriate for tracking/duplicate parameters; query addition or a path change needs more scrutiny. Use the supplied relation fields and page context to judge whether the target plausibly represents an equivalent preferred URL. Do not invent the reason the canonical was chosen.`,

    robots_noindex: `Noindex can be intentional for utility, search, filter, account, cart, duplicate, staging, temporary, or otherwise non-search-facing pages. It is more concerning when the page appears unique, useful, index-worthy, and clearly intended to attract organic search traffic.`,

    images_missing_alt: `Missing alt text is only problematic when an image conveys meaningful information that is not otherwise available. Decorative images do not need descriptive alt text. Linked or functional images require more scrutiny because they may need an accessible text alternative.`,

    heading_hierarchy: `Heading hierarchy issues are more meaningful in primary/main content than in navigation, footer, cookie/consent UI or utility components. A skipped heading level is not automatically harmful if the visual/semantic structure remains clear, but repeated or topically important hierarchy jumps can make page structure harder to interpret.`,

    html_lang_presence: `A missing HTML lang attribute is primarily an accessibility and language-identification issue. It is more important on multilingual/international sites and when other locale signals are present.`,

    html_lang_format: `The HTML lang value should be a plausible BCP-47-style language/locale value. Minor casing differences are usually harmless; malformed or unrelated values are more concerning.`,

    robots_conflict: `Conflicting robots meta directives are genuinely risky because different declarations can send contradictory index/follow instructions. Treat explicit index/noindex or follow/nofollow conflicts as important.`,

    canonical_fragment: `Canonical URLs normally identify a document URL rather than a fragment. A fragment on a canonical is usually suspicious unless there is a very unusual, deliberate implementation.`,

    canonical_protocol_downgrade: `An HTTPS page canonicalising to HTTP is usually suspicious and can create inconsistent preferred-URL signals. It may be intentional only in unusual legacy setups.`,

    jsonld_parse_error: `Invalid JSON-LD is meaningful when structured data is intended to be consumed. A syntax error can prevent part or all of the block being parsed.`,

    hreflang_duplicate_value: `Multiple hreflang declarations for the same language/locale are suspicious when they point to different URLs. Exact duplicate declarations are redundant but less serious.`,

    hreflang_unapproved_value: `This check is about project policy, not hreflang syntax. A syntactically valid locale should not be described as invalid or unsupported merely because it falls outside the configured project allow-list. Bare language entries in the allow-list permit valid language-family variants (for example es allows es-ES/es-MX; zh allows zh-Hans/zh-Hant). Specific locale entries remain specific. Treat an out-of-policy value as an implementation-consistency finding and use the supplied allow-list evidence rather than inventing a locale strategy.`,

    hreflang_invalid_format: `Malformed hreflang values can prevent language/region targeting from being interpreted as intended. x-default is valid; language and optional region/script subtags should otherwise be plausible.`,

    hreflang_empty_href: `A hreflang declaration without a usable target URL cannot serve its purpose and is likely a real implementation issue.`,

    open_graph_incomplete: `Open Graph metadata is not a direct ranking requirement, but partial implementations can create poor or inconsistent social previews. Treat it as lower SEO severity than indexation or canonical issues.`,

    og_url_mismatch: `An og:url value can legitimately differ in some sharing setups, but it should usually represent the same preferred page identity as the canonical/current URL. Unexpected hosts, protocols or environments are more concerning.`,

    twitter_card_incomplete: `Twitter/X card metadata is not a direct ranking requirement. A partial implementation is mainly a social-sharing quality issue rather than a core SEO defect.`,

    favicon_presence: `A missing favicon is primarily a UX/browser-branding issue rather than a material organic-search defect. Treat it as low severity unless the project explicitly requires it.`,

    images_empty_alt: `An empty alt attribute can be correct for decorative images. It is only problematic when the image conveys meaningful or functional information that is not otherwise represented.`,

    images_missing_dimensions: `Missing width/height attributes can contribute to layout instability when dimensions are not otherwise reserved by CSS or aspect-ratio. Do not assume the absence of attributes alone proves CLS impact.`,

    links_empty_anchor: `Judge each supplied empty-anchor example, not empty links in the abstract. For every example inspect its href/rawHref, selector, zone/component, visible_on_page, nearby_text, child_tags and image/SVG signals. Your evidence_used must mention at least one specific supplied href or selector when examples are present. Do not use the total internal-link count as evidence that an empty anchor is good or bad, and do not infer that a link is navigational merely because the page has many internal links. A visible link to a meaningful destination with no visible or accessible name is more likely to be a real issue. Hidden/template/placeholder anchors, empty hash targets, or non-user-facing implementation artefacts may be lower concern or false positives. An icon/image link is still concerning when it genuinely has no accessible text alternative. If an individual example cannot be understood from the supplied fields, mark that example manual_review rather than generalising.`,

    internal_http_links: `Internal HTTP links on an HTTPS page are usually undesirable when an HTTPS equivalent exists, because they can introduce redirects or inconsistent secure URL references.`,

    viewport_presence: `A missing viewport meta tag is more likely to be a meaningful issue on modern responsive/mobile pages. It may be less relevant in unusual embedded, legacy, or deliberately fixed-width contexts, though those cases are uncommon.`
  }
};

const TASK_SCHEMAS = {
  link_group: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            category: {
              type: "string",
              enum: [
                "primary_navigation",
                "secondary_navigation",
                "breadcrumb",
                "footer",
                "editorial_contextual",
                "related_content",
                "product_category",
                "cta",
                "pagination",
                "legal",
                "social",
                "utility",
                "other"
              ]
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            rationale: { type: "string" }
          },
          required: ["id", "category", "confidence", "rationale"],
          additionalProperties: false
        }
      }
    },
    required: ["results"],
    additionalProperties: false
  },

  page_type: {
    type: "object",
    properties: {
      page_type: {
        type: "string",
        enum: [
          "homepage",
          "product",
          "category_listing",
          "article_editorial",
          "location",
          "service",
          "comparison",
          "faq",
          "search_results",
          "other"
        ]
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      evidence: {
        type: "array",
        items: { type: "string" },
        maxItems: 5
      }
    },
    required: ["page_type", "confidence", "evidence"],
    additionalProperties: false
  },

  intent: {
    type: "object",
    properties: {
      primary_intent: {
        type: "string",
        enum: [
          "transactional",
          "commercial_investigation",
          "informational",
          "navigational",
          "local",
          "mixed",
          "unclear"
        ]
      },
      supporting_intents: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "transactional",
            "commercial_investigation",
            "informational",
            "navigational",
            "local"
          ]
        },
        maxItems: 4
      },
      secondary_intents: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "transactional",
            "commercial_investigation",
            "informational",
            "navigational",
            "local"
          ]
        },
        maxItems: 4
      },
      split_intent: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      evidence: {
        type: "array",
        items: { type: "string" },
        maxItems: 5
      }
    },
    required: [
      "primary_intent",
      "supporting_intents",
      "secondary_intents",
      "split_intent",
      "confidence",
      "evidence"
    ],
    additionalProperties: false
  },

  alignment: {
    type: "object",
    properties: {
      alignment: {
        type: "string",
        enum: ["strong", "partial", "weak", "unclear"]
      },
      split_intent: { type: "boolean" },
      mismatch_reason: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      notes: {
        type: "array",
        items: { type: "string" },
        maxItems: 5
      }
    },
    required: [
      "alignment",
      "split_intent",
      "mismatch_reason",
      "confidence",
      "notes"
    ],
    additionalProperties: false
  },

  false_positive: {
    type: "object",
    properties: {
      judgement: {
        type: "string",
        enum: [
          "likely_false_positive",
          "no_material_impact",
          "low_impact",
          "context_dependent",
          "meaningful_issue",
          "manual_review"
        ]
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1
      },
      rationale: {
        type: "string"
      },
      evidence_used: {
        type: "array",
        items: {
          type: "string"
        },
        maxItems: 6
      },
      item_assessments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item: {
              type: "string"
            },
            judgement: {
              type: "string",
              enum: [
                "likely_false_positive",
                "no_material_impact",
                "low_impact",
                "context_dependent",
                "meaningful_issue",
                "manual_review"
              ]
            },
            rationale: {
              type: "string"
            }
          },
          required: [
            "item",
            "judgement",
            "rationale"
          ],
          additionalProperties: false
        },
        maxItems: 100
      },
      useful_context: {
        type: "array",
        items: {
          type: "string"
        },
        maxItems: 5
      }
    },
    required: [
      "judgement",
      "confidence",
      "rationale",
      "evidence_used",
      "item_assessments",
      "useful_context"
    ],
    additionalProperties: false
  },

  dom_diff_summary: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            summary: { type: "string" }
          },
          required: [
            "id",
            "summary"
          ],
          additionalProperties: false
        }
      }
    },
    required: ["results"],
    additionalProperties: false
  },

  dom_diff_triage: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            judgement: {
              type: "string",
              enum: [
                "likely_important",
                "probably_harmless",
                "context_dependent",
                "manual_review"
              ]
            },
            change_area: {
              type: "string",
              enum: [
                "indexing_control",
                "page_understanding",
                "content_retrieval",
                "link_destination",
                "anchor_context",
                "url_consistency",
                "structured_data",
                "ui_only",
                "unknown"
              ]
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            rationale: { type: "string" }
          },
          required: [
            "id",
            "judgement",
            "change_area",
            "confidence",
            "rationale"
          ],
          additionalProperties: false
        }
      }
    },
    required: ["results"],
    additionalProperties: false
  },

  url_consistency: {
    type: "object",
    properties: {
      overall: {
        type: "string",
        enum: [
          "likely_consistent",
          "mostly_consistent",
          "needs_review",
          "likely_incorrect"
        ]
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            source: {
              type: "string",
              enum: [
                "current_url",
                "canonical",
                "hreflang",
                "schema_url",
                "mobile_annotation",
                "cross_signal"
              ]
            },
            judgement: {
              type: "string",
              enum: [
                "likely_correct",
                "likely_incorrect",
                "needs_review"
              ]
            },
            value: { type: "string" },
            suggested_value: { type: "string" },
            rationale: { type: "string" }
          },
          required: [
            "source",
            "judgement",
            "value",
            "suggested_value",
            "rationale"
          ],
          additionalProperties: false
        }
      },
      summary: { type: "string" }
    },
    required: [
      "overall",
      "confidence",
      "findings",
      "summary"
    ],
    additionalProperties: false
  },

  jira_ticket: {
    type: "object",
    properties: {
      summary: { type: "string" },
      current_behavior: { type: "string" },
      desired_behavior: { type: "string" },
      why_important: { type: "string" },
      example_url: { type: "string" },
      evidence: {
        type: "array",
        items: { type: "string" },
        maxItems: 8
      }
    },
    required: [
      "summary",
      "current_behavior",
      "desired_behavior",
      "why_important",
      "example_url",
      "evidence"
    ],
    additionalProperties: false
  }
};

function mergeSettings(saved = {}) {
  // Settings persistence contract:
  // - bundled defaults fill only values that are missing
  // - any value already saved by the user is authoritative
  // - updates must not silently rewrite existing saved configuration
  // - Restore defaults is the explicit opt-in path to adopt current defaults
  const mergeSavedOverDefaults = (
    defaults,
    savedValue
  ) => {
    if (
      savedValue ===
      undefined
    ) {
      return structuredClone(
        defaults
      );
    }

    if (
      Array.isArray(
        savedValue
      )
    ) {
      return structuredClone(
        savedValue
      );
    }

    if (
      savedValue &&
      typeof savedValue ===
        "object"
    ) {
      const base =
        defaults &&
        typeof defaults ===
          "object" &&
        !Array.isArray(
          defaults
        )
          ? structuredClone(
              defaults
            )
          : {};

      for (
        const [
          key,
          value
        ]
        of Object.entries(
          savedValue
        )
      ) {
        base[key] =
          mergeSavedOverDefaults(
            defaults?.[key],
            value
          );
      }

      return base;
    }

    return savedValue;
  };

  return mergeSavedOverDefaults(
    DEFAULT_SETTINGS,
    saved || {}
  );
}


function providerSecretsFromSettings(
  settings = {}
) {
  return {
    geminiApiKey:
      String(
        settings
          ?.providers
          ?.gemini
          ?.apiKey ||
        ""
      ),
    openaiApiKey:
      String(
        settings
          ?.providers
          ?.openai
          ?.apiKey ||
        ""
      )
  };
}

function persistentSettings(
  settings = {}
) {
  const copy =
    structuredClone(
      settings
    );

  if (
    copy.providers
      ?.gemini
  ) {
    delete copy
      .providers
      .gemini
      .apiKey;
  }

  if (
    copy.providers
      ?.openai
  ) {
    delete copy
      .providers
      .openai
      .apiKey;
  }

  return copy;
}

function applyProviderSecrets(
  settings = {},
  secrets = {}
) {
  const copy =
    structuredClone(
      settings
    );

  copy.providers ||= {};
  copy.providers.gemini ||= {};
  copy.providers.openai ||= {};

  copy.providers
    .gemini
    .apiKey =
      String(
        secrets
          ?.geminiApiKey ||
        ""
      );

  copy.providers
    .openai
    .apiKey =
      String(
        secrets
          ?.openaiApiKey ||
        ""
      );

  return copy;
}
