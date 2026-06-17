---
timestamp: 2026-06-14T15-05-56Z
slug: src-pages-dashboardpage-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Pipeline progress is solid; "Needs validation" as KPI headline is honest but visually jarring; disabled Export Memo gives no reason |
| 2 | Match System / Real World | 3 | Executive language mostly right; "Quality Gate", "Provenance", "Candidate Review Queue" are internal terms that leak to the exec surface |
| 3 | User Control and Freedom | 2 | No undo anywhere; Stop/Reset hidden behind Advanced toggle; no cancel on intelligence update once started |
| 4 | Consistency and Standards | 2 | 15+ distinct badge variants; dual CSS token systems (--gs-* + semantic tokens); duplicate class definitions in DashboardPage.css |
| 5 | Error Prevention | 2 | No confirmation before triggering intelligence update; disabled Export Memo has no explanation; alert() for database errors |
| 6 | Recognition Rather Than Recall | 3 | Sidebar anchors, "?" tooltips on KPIs, tab nav — good discoverability; secondary features still require exploration |
| 7 | Flexibility and Efficiency | 2 | No keyboard shortcuts; sidebar collapses but doesn't reduce page scroll; Advanced controls toggle visible even in exec mode |
| 8 | Aesthetic and Minimalist Design | 2 | 10+ sections on one scroll; 7 toolbar buttons visible at once; all detail visible without progressive disclosure |
| 9 | Error Recovery | 2 | alert() for DB errors (line 449); loading state is bare "Loading..." text; no graceful empty states for missing data |
| 10 | Help and Documentation | 2 | "?" tooltips per KPI are good; no onboarding; no explanation of Quality Gate / Provenance for new users |
| **Total** | | **23/40** | **Acceptable — significant improvements needed** |

## Anti-Patterns Verdict

**LLM assessment**: GroundSense largely avoids the obvious tells — no gradient text, no glassmorphism, no hero-metric SaaS template with glowing accents, no identical 3-column feature grid. The warm cognac/amber accent (#c2620a) is genuinely distinctive for an executive intelligence tool (fintech defaults to navy; this doesn't). The exposure chain visualization (External Signal → Company Exposure → Calculation → Business Impact) is the most original element and earns the product's thesis visually.

However, two patterns persist at a detail level that would be flagged by a design director:

1. **Eyebrow-above-every-section**: Every major section has a small all-caps orange tracked label above the h2 heading — "GROUNDSENSE", "LEADERSHIP MEMO", "EXPOSURE GRAPH", "EXECUTIVE ACTIONS", "SYSTEM OF RECORD", "COMMERCIAL UPSIDE". This is the anti-pattern in full force. Some eyebrows are informative (EXPOSURE GRAPH, COMMERCIAL UPSIDE as category tags); others duplicate the h2 exactly (SYSTEM OF RECORD / System of Record). Deployed uniformly on every section, it reads as AI grammar, not designed voice.

2. **Side-border accents in the exposure graph**: The four-step exposure chain cards use `border-left: 3px solid var(--)` for color-coding. The category is already communicated by the pill badges ("VERIFIED PUBLIC METRIC", "COMPANY-CALIBRATED", etc.) — the side border is redundant decoration.

**Deterministic scan**: 
- **overused-font**: 15+ `font-family: Inter` references across ActionRoiPanel.tsx, calibrationCenterStyles.ts, DecisionMemoryPanel.tsx, DriverPriorityMap.tsx, ForecastAccuracyPanel.tsx, exposureGraphStyles.ts. Low concern for a product UI where familiarity serves the task, but Inter is no longer distinctive.
- **side-tab**: 8 instances of `border-left: Npx solid var(--)` in `src/components/exposure/exposureGraphStyles.ts` lines 81–96, including a 7px thick variant. These are genuine anti-pattern hits.
- **layout-transition**: 1 instance of `transition: width` in `calibrationCenterStyles.ts:65`. Minor performance concern.

**Visual overlays**: Browser automation unavailable (existing session conflict). Assessment based on source inspection and existing screenshots.

## Overall Impression

GroundSense has real substance. The exposure chain, the evidence hierarchy (evidence-backed vs. scenario-modeled), and the leadership memo format are genuinely differentiated. The design vocabulary is correct. The problem isn't aesthetics — it's cognitive load. The dashboard tries to be both a "glance" surface (KPI cards in 30 seconds) and a "deep dive" surface (15+ sections of model internals) on the same page without a clear hierarchy between them. An executive who opens this wants to know "what do I need to decide today?" in 30 seconds. Getting there currently requires scrolling past 5+ sections of technical detail. The single biggest opportunity: tighten the above-the-fold executive signal so it answers the morning brief question without scroll.

## What's Working

1. **The Exposure Graph chain**: External Signal → Company Exposure → Calculation → Business Impact is the most genuinely original visualization on the product. It makes the abstract P&L chain legible and defensible. The pill badges ("VERIFIED PUBLIC METRIC", "COMPANY-CALIBRATED") earn their place.

2. **The warm amber/cognac accent**: Most executive dashboards default to navy or neutral gray. The cognac (#c2620a, #9c4e07) reads as authoritative and distinct without being loud. It's a deliberate identity choice that holds up.

3. **The Leadership Memo structure**: SUMMARY / ACT NOW / VALIDATE / MODEL BASIS / QUALITY GATE mirrors a real CFO briefing note format. The content is executive-grade, not just a data dump.

## Priority Issues

**[P1] "Needs validation" as a headline KPI value**

**What**: The Candidate Upside metric renders "Needs validation" in the same 22px bold font as "~$3.2M". On the 6-column KPI grid, this creates visual parity between a real number and a null state — the null state actually reads *louder* because the text is longer.

**Why it matters**: An executive scanning the KPI row sees "~$3.2M... Needs validation" and cannot quickly distinguish "a validated number" from "we don't have one." The null state should not compete visually with real estimates. It undermines confidence in the metric grid as a reliable signal.

**Fix**: Make the primary value in null-state metrics smaller and muted (e.g., "—" at 22px in --text-faint, with "Needs validation" as the subtitle in 13px --text-muted). Or: show the count of approved opportunities as the primary value (e.g., "0") and "Needs validation" as the subtitle only.

**Suggested command**: /impeccable polish

---

**[P1] Eyebrow repetition on every section**

**What**: Small all-caps orange tracked labels appear above the h2 on every single section: GROUNDSENSE, LEADERSHIP MEMO, EXPOSURE GRAPH, EXECUTIVE ACTIONS, SYSTEM OF RECORD, COMMERCIAL UPSIDE, AUTOMATION AUDIT, EVIDENCE QUALITY. Some duplicate the h2 text verbatim.

**Why it matters**: When an eyebrow appears on every section identically, it stops functioning as navigation and starts functioning as decoration. It's the loudest AI-grammar tell this interface has. A design director reviewing this would circle it immediately.

**Fix**: Reserve eyebrows for sections where the label adds categorical information not in the h2 (COMMERCIAL UPSIDE categorizes an "Opportunity Pipeline" section — keep it; SYSTEM OF RECORD above an h2 that also reads "System of Record" — remove one). Alternatively, replace eyebrows with a consistent section-type color accent on the card itself (left-accent strip is banned, but a top-border or background tint per category is not).

**Suggested command**: /impeccable polish

---

**[P2] Dashboard cognitive load — no above-the-fold executive summary**

**What**: All 10+ sections (KPIs, memo, actions, exposure graph, driver map, register preview, opportunity pipeline, calibration card, source card, forecast accuracy, company model, scheduler) render in a single scroll with equal visual weight.

**Why it matters**: The executive user opens this tool with one question: "What do I need to act on today?" The answer is in the KPI grid + leadership memo + action cards (maybe 30% of the page). The remaining 70% is supporting evidence. Currently, the supporting evidence has no visual subordination to the executive signal — everything looks like a `card` with `margin-bottom: 18px`. The section ordering is correct (exec signal first) but the visual weight is uniform throughout.

**Fix**: Introduce two visual tiers. Tier 1 (executive signal): KPI grid + leadership memo + action cards — render these in the primary content width, perhaps with slightly elevated surface color or a subtle top-area treatment. Tier 2 (model detail): exposure graph, driver map, register preview, opportunity pipeline — render these as "supporting detail" with a visual step down (slightly muted header, or grouped under a single "Supporting Detail" collapsible). The sidebar navigation already implies this hierarchy but the main content doesn't.

**Suggested command**: /impeccable layout

---

**[P2] Badge/label vocabulary proliferation**

**What**: The design system has at minimum 15 distinct badge/label variants: `badge`, `orange-badge`, `green-badge`, `blue-badge`, `gray-badge`, `amber-badge`, `triage-badge`, `model-status-evidence`, `model-status-scenario`, `model-status-missing`, `model-status-unknown`, `model-status-watchlist`, `ev-tier-primary`, `ev-tier-official`, `ev-tier-industry`, `ev-tier-news`, `ev-tier-low`, `ev-tier-market`. Plus the exposure graph adds 7 border-left color variants.

**Why it matters**: Badge proliferation forces users to build a mental model of 15+ distinct visual states — every new badge variant adds cognitive load. Many variants are visually similar (blue-badge vs gray-badge both appear to use `--border-default` as background). The system is inconsistent: some states use pill shapes, some use square corners, some have borders, some don't.

**Fix**: Collapse to 5 semantic states — positive (success), negative (danger), warning/pending, neutral/muted, and highlighted (accent). Every badge in the system maps to one of these. Retire `blue-badge`, `gray-badge`, `triage-badge`, and the 6 ev-tier variants in favor of consistent semantic chips.

**Suggested command**: /impeccable distill

---

**[P3] `alert()` for database errors + bare loading state**

**What**: Database errors use browser `alert(error.message)` (DashboardPage.tsx:449). The loading state renders `<div className="dashboard-container">Loading...</div>` in bare text (line 1236–1239).

**Why it matters**: `alert()` is universally recognized as a developer shortcut, not a product choice. It breaks the UI context, blocks interaction, and is inaccessible. The bare "Loading..." text gives no indication of what is loading, how long it will take, or what to do if it fails.

**Fix**: Replace `alert()` with an inline error banner or toast that doesn't block the page. Replace "Loading..." with a skeleton layout matching the page structure (6 metric skeletons + card placeholder), which reduces perceived load time and sets expectations.

**Suggested command**: /impeccable harden

## Persona Red Flags

**Alex (Power User / CFO's Chief of Staff)**: Opens dashboard expecting to scan 30 seconds and leave. Immediately sees 7 toolbar buttons (Run Intelligence Update, Generate Executive Brief, Calibrate Model, Source Hub, Export Memo, Advanced controls toggle, Stop/Reset). Two primary orange buttons of equal visual weight force a decision: which one first? The "Advanced / admin controls" toggle is visible even in executive mode, implying internal controls that shouldn't be surfaced to this user. No keyboard navigation for any primary action. The "Export Memo" button is disabled but gives no indication when it will become available — Alex clicks it, nothing happens, no feedback.

**Sam (Accessibility-Dependent)**: The "?" tooltip buttons appear to be unlabeled (no aria-label visible in the inline component markup). The tooltip uses `z-index: 2147483647` — the maximum 32-bit integer, which is a code smell. The pipeline spinner (`@keyframes gs-spin`) has no `@media (prefers-reduced-motion)` alternative. The sidebar collapse "«" button has no accessible label. The `alert()` for errors fires outside the normal DOM tree and may not trigger screen reader announcements in the expected way.

**Jordan (First-Timer)**: Lands on the dashboard and sees "0% Calibration Coverage — 0 of 46 required inputs calibrated." No guidance on what calibration means or why it matters. The "Needs validation" on Candidate Upside looks like something is broken. The "Quality Gate" concept (referenced in the leadership memo) has no tooltip or explanation. The two large orange buttons — "Run Intelligence Update" vs "Generate Executive Brief" — have no description of what either does or what the difference is.

## Minor Observations

- The sidebar "SECTIONS" label above the nav items is a micro-eyebrow — an all-caps tracked label pattern on a 5-item nav. Either make it a visible section header or remove it.
- `method-summary-box` is defined twice in DashboardPage.css with different properties (lines 1093 and 1133). The second definition wins, but both exist, creating maintenance confusion.
- The metrics grid `repeat(6, 1fr)` collapses to 1-column at 640px but has no breakpoint at 768px–1220px where 6 columns at medium-width viewports produces very narrow metrics (each column ≈ 150px).
- The `transition: width` in calibrationCenterStyles.ts will cause layout thrash. Use `transform: scaleX()` or `max-width` transitions instead.
- The "Export Memo" button is consistently disabled across screenshots with no explanation — it should either show why (tooltip "Coming soon" or "Generate brief first") or be removed until the feature is ready.
- The sidebar collapse "«" button has no tooltip or aria-label — a screen reader user cannot discover its function.

## Questions to Consider

- "What would the first 30 seconds of an executive's morning look like with this dashboard — can they answer 'what do I act on today?' without scrolling?"
- "If calibration coverage is 0%, what does that mean for the credibility of the ~$3.2M estimate shown in the header? Is the tension between '~$3.2M value at stake' and '0% calibration' resolved anywhere above the fold?"
- "Does every section need to be on the dashboard, or should model detail (driver map, exposure paths, candidate review queue) live behind a 'Supporting Detail' disclosure?"
- "The exposure graph is the most original feature — should it be higher on the page, not below the actions?"
