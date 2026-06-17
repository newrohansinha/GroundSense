---
target: landing page
total_score: 28
p0_count: 0
p1_count: 1
timestamp: 2026-06-14T23-49-07Z
slug: src-pages-landingpage-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Tab switching gives clear feedback; no loading state on the "Request Demo" CTA (dead end) |
| 2 | Match System / Real World | 3 | "Evidence-backed vs. scenario-modeled" is domain-correct for CFOs; "Quality gate" needs one word of context for outsiders |
| 3 | User Control and Freedom | 3 | Nav is sticky, links work. No back/undo because it's a marketing page — appropriate |
| 4 | Consistency and Standards | 3 | Token system is coherent. Minor: persona dot bullet vs benefit circle-check — two different list accent systems |
| 5 | Error Prevention | 3 | No forms to break. "Request Demo" links to /onboarding which may 404 |
| 6 | Recognition Rather Than Recall | 4 | Every section self-contained. Tab labels clear. Source badges legible |
| 7 | Flexibility and Efficiency | 2 | Mobile nav collapses entirely with no hamburger; no keyboard-jump to sections |
| 8 | Aesthetic and Minimalist Design | 3 | Clean overall. Five consecutive light sections mid-page lose visual rhythm |
| 9 | Error Recovery | 2 | No error states. /onboarding route dead end |
| 10 | Help and Documentation | 2 | No inline definitions for "quality gate," "calibration state," "residual operating exposure" |
| **Total** | | **28/40** | **Good — solid foundation, several targeted improvements needed** |

## Anti-Patterns Verdict

LLM assessment: Does not read as AI-generated at first glance. Bold hero, 900-weight headline with amber accent, ghost numbers on How It Works, dark bookend structure are committed choices. AI slop traps removed: eyebrow kickers, 01/02 numbered scaffolding, gradient text, side-stripe card accents.

What still reads slightly generic: five consecutive light-background sections (Why → How → Product → Benefits → Personas) using identical padding and heading scale. No visual landmark differentiates them mid-page.

The 4-column Why grid is weakest. Four equal-weight columns divided by hairlines — no visual pull, no resting-state hierarchy.

Deterministic scan: 1 finding — LandingPage.css:566 border-left: 5px solid on .lp-gph-arr::after. FALSE POSITIVE — this is the CSS triangle arrowhead for graph flow connectors, not a card accent.

## Overall Impression

Hero and CTA are strong — dark, committed, well-weighted. Product showcase does real work. Problem: 500px stretch in the middle where five sections all look the same. Visitors lose place because there are no visual landmarks between hero and CTA. Biggest opportunity: break mid-page monotony with deliberate section contrast.

## What's Working

1. Hero composition — 5fr/7fr asymmetric split, product window dominating right, dark bg + amber accent + 900-weight headline. Strong first impression.
2. Product showcase tabs — four real product views with panel fade. Real live components, no mockup pretense.
3. Trust/methodology layout — two-column with source verification card. Only section with genuinely differentiated layout rhythm.

## Priority Issues

[P1] Mid-page section monotony — five consecutive identical surfaces. Why → How → Product → Benefits → Personas share same bg, 100px padding, same heading scale. Visitors lose context mid-page. Fix: Give Benefits section dramatically different treatment — dark-tinted surface, larger list items, tighter layout.

[P2] Why Different section — four equal-weight columns with no pull. Nothing tells scanning eye where to start. Fix: Give 1-2 items visual primacy with larger type or asymmetric layout.

[P2] /onboarding route dead end — all CTAs link to non-existent route. Fix: Change to /dashboard until onboarding is built.

[P2] Mobile nav collapses to nothing — display: none with no hamburger replacement. Casey has no way to jump to sections on mobile. Fix: Port hamburger pattern from TopNav.tsx.

[P3] Section heading size doesn't vary — every secondary section heading is clamp(28px, 3.2vw, 46px). Fix: Assign two sizes — larger for anchor sections, smaller for supporting sections.

## Persona Red Flags

Jordan (CFO first-timer): Hits "evidence-backed exposure," "quality gate," "calibration state" without definition. Four equal-weight Why columns skip. Product showcase has unexplained badges. Abandonment risk at product showcase.

Casey (mobile): Nav links gone, no hamburger. 80px ghost numbers may still render too large on small screens. Two CTA buttons side-by-side may be cramped at mobile width.

Riley (stress tester): Rapid tab switching queues 4 animations simultaneously. Exposure Graph clips entirely on 360px viewport (overflow: hidden).

## Minor Observations

- Brand dot pulse continuous 2.6s — may not be needed in app shell where it's ambient chrome.
- "Built for operators, not spectators" is a setup line, not a value statement. Weaker than other section heads.
- Footer tagline "Executive intelligence for industrial companies" doesn't match hero "operating intelligence layer for external shocks" — inconsistent positioning.
- .lp-cta-inner animation fires on page load, not scroll-triggered. CTA is below the fold so animation completes before user arrives.
- The /onboarding dead end affects all primary CTAs on the page.

## Questions to Consider

1. What if Benefits and Personas were merged into one tighter "Who asks what" layout?
2. Does How It Works need 5 steps or could 3 anchor steps carry the message with more space?
3. What would the page feel like with one full-width dark data moment mid-page instead of the benefits checklist?
