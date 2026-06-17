---
target: the dashboard
total_score: 25
p0_count: 0
p1_count: 3
timestamp: 2026-06-13T18-43-29Z
slug: src-pages-dashboardpage-tsx
---
# Critique — Executive Intelligence Dashboard (`src/pages/DashboardPage.tsx`)

Register: product · Viewports inspected: 1440px, 390px · Date: 2026-06-13

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Full-section bare "Loading…" text; four silent 404s pollute console, feature degrades invisibly |
| 2 | Match System / Real World | 3 | Strong executive vocabulary (value at stake, exposure, calibration); audience-appropriate |
| 3 | User Control and Freedom | 3 | Filter tabs, collapsible advanced controls, status dropdowns; no undo on status change |
| 4 | Consistency and Standards | 3 | Tokens are genuinely consistent; exposure-graph styling diverges from clean card system |
| 5 | Error Prevention | 2 | Status changes commit with no confirm; 404 paths fail open |
| 6 | Recognition Rather Than Recall | 3 | "?" tooltips, labeled nav, section jump-list; good |
| 7 | Flexibility and Efficiency | 2 | No keyboard shortcuts/command palette for a power exec audience |
| 8 | Aesthetic and Minimalist Design | 2 | 6-KPI hero row, horizontal overflow, crushed table column |
| 9 | Error Recovery | 2 | Silent 404s, no visible error/empty messaging on data failure |
| 10 | Help and Documentation | 3 | Inline "?" tooltips + model-basis explanations are strong contextual help |
| **Total** | | **25/40** | **Acceptable — solid foundation, several structural fixes needed** |

## Anti-Patterns Verdict

**LLM assessment:** Does NOT read as obvious AI slop at the system level — the burnt-orange accent (#c2620a) deliberately avoids the fintech navy-and-gold cliché, the semantic token system is real, and the information design (event → exposure → calculation → impact → action) is genuinely differentiated. The tells are localized: side-stripe borders on every exposure-graph node, a tiny uppercase tracked eyebrow above nearly every section (GROUNDSENSE / SECTIONS / LEADERSHIP MEMO / EXPOSURE GRAPH / SYSTEM OF RECORD / COMMERCIAL UPSIDE), and a 6-across hero-metric KPI row.

**Deterministic scan:** 21 findings — 8× side-tab accent border (`exposureGraphStyles.ts:81-88,96`, incl. a 7px one), 12× overused-font (Inter, acceptable for product UI), 1× layout-transition. The 5 additional `border-left: 3px solid` in `DashboardPage.css` (2079/2083/2087/2440/3134) are the same pattern the scanner flagged in the graph.

**Visual overlays:** Not injected — Playwright profile was locked and the page closed mid-session twice; evidence is screenshot-based across 1440px and 390px.

## Overall Impression

This is a serious, defensible product with real information architecture — it is NOT a news summarizer, and that shows. The single biggest problem is structural, not aesthetic: **the page overflows its own width at every breakpoint** (73px at 1440, worse on mobile), driven by fixed-width exposure-graph nodes and over-wide tables. That horizontal scrollbar is the first thing an executive sees, and it undercuts the credibility the content works hard to earn.

## What's Working

1. **The exposure-graph concept** (External Signal → Company Exposure → Calculation → Business Impact) is the product's moat made visible. The left-to-right causal flow with verified/calibrated/assumption status is exactly the "defensible" story the product promises.
2. **The token system + accent choice.** Semantic light/dark tokens, thin borders, no gradients/glass, and a distinctive warm accent — a confident, restrained product palette.
3. **Contextual help density.** Inline "?" tooltips, explicit MODEL BASIS rows, and the QUALITY GATE disclosure teach the interface and reinforce trust without a separate docs detour.

## Priority Issues

### [P1] Horizontal overflow at every viewport
**Why it matters:** The exposure graph uses fixed 168px nodes × 4 columns + arrows + 150px labels, so the row is wider than the viewport — the whole page gets a horizontal scrollbar (73px at 1440px, larger at 390px). It reads as broken before any content is read.
**Fix:** Make the graph horizontally scrollable *within its own container* (`overflow-x: auto` on the flow row, not the page), or collapse to stacked vertical steps below ~900px. Audit the wide Relationship/Opportunities table the same way.
**Suggested command:** `/impeccable adapt`

### [P1] Side-stripe accent borders on every graph node
**Why it matters:** `border-left: 3px solid` (and one 7px) on cards is the single most recognizable AI-UI tell, and it's the one place this otherwise-credible product looks generated. 8 in the graph + 5 in the dashboard CSS.
**Fix:** Encode node status with the existing badge (already present) plus a full 1px border in the status hue or a faint status-tinted background. Drop the side stripe entirely.
**Suggested command:** `/impeccable quieter`

### [P1] Two competing equal-weight primary buttons
**Why it matters:** "Run Intelligence Update" and "Generate Executive Brief" are both full burnt-orange primaries side by side. With two primaries there is no primary — the exec can't tell what the intended next action is.
**Fix:** One primary (the most common/important action), the other demoted to secondary/outline. The four-button row below already shows you have a secondary style.
**Suggested command:** `/impeccable layout`

### [P2] Six-across KPI hero row exceeds working memory
**Why it matters:** Executive Issues / Quantified Value / Candidate Upside / Evidence Sources / Open Actions / Calibration Coverage = 6 metrics demanding simultaneous attention (Miller/Cowan limit is ~4). It's also the "hero-metric template" composition.
**Fix:** Promote the 2 that drive decisions (Value at Stake, Open Actions) to a larger lead pair; group the rest as a compact secondary strip, or fold Calibration Coverage / Evidence Sources into their own sections (they already exist lower).
**Suggested command:** `/impeccable layout`

### [P2] Eyebrow above nearly every section
**Why it matters:** Tiny uppercase tracked kickers on almost every section (GROUNDSENSE, SECTIONS, LEADERSHIP MEMO, EXPOSURE GRAPH, SYSTEM OF RECORD, COMMERCIAL UPSIDE) is AI grammar — it stops being voice when it's everywhere.
**Fix:** Keep the section title; drop the kicker except where it carries real categorization the title doesn't. Let the left section-nav do the labeling job instead.
**Suggested command:** `/impeccable typeset`

### [P2] Silent data failure + bare loading state
**Why it matters:** Four 404s (`intelligence_run_summaries`, `intelligence_scheduler_config`) fail with no user-visible message, and sections render a plain "Loading…" string. A degraded data path that says nothing is a trust risk in a tool whose entire value is trustworthiness.
**Fix:** Skeleton states instead of "Loading…"; a quiet inline "couldn't load run history" affordance instead of a swallowed 404.
**Suggested command:** `/impeccable harden`

## Persona Red Flags

**Alex (Power User / time-poor exec):** No keyboard shortcuts or command palette to jump to "Actions" or trigger an Intelligence Update; the left section-nav requires a mouse. Two identical orange buttons force a read before the first click.

**Sam (Accessibility):** Node status is encoded by a 3px colored left border — meaning conveyed largely by color/position; needs the text badge to carry it (it's present, verify it's the source of truth for SR users). Verify focus-visible rings on the graph nodes (they're `<button>`s — good) and the status dropdowns. Horizontal overflow forces two-axis scrolling at 200% zoom.

**Morgan (CFO, project persona):** Lands wanting one number and one action. Gets six KPIs, a horizontal scrollbar, and two equally-loud buttons. The content that would reassure them (value at stake, the ranked actions) is excellent once found — but the first 3 seconds read as "busy," not "in control."

## Minor Observations

- Inter is flagged as overused, but it's a legitimate product-UI default — not worth changing.
- The crushed rightmost table column (one word per line: "Evidence-backed exposure…") is part of the same width problem; fixing the table layout resolves both.
- The numbered markers in the Leadership Memo (1. ACT NOW, 2. VALIDATE) are legitimate — they're a real ranked action sequence, not decorative numbering.
- Empty states are handled with copy ("0 opportunities", "No issues currently modeled for this driver") — decent, could teach more.

## Questions to Consider

- What if there were exactly one primary action on this screen — what would it be?
- Does the exposure graph need to show all four columns at once, or could it reveal calculation/impact on node-select to fit any width?
- What would the "first 3 seconds" look like if it showed one headline number and the single most urgent action, with everything else one scroll down?
