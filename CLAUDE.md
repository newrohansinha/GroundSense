# GroundSense Autonomous Build Instructions

You are working on GroundSense, a React + Supabase executive intelligence product.

## Mission

Make GroundSense more useful, executive-ready, and defensible.

GroundSense is not a news summarizer. It maps external events into:
event → operating path → financial driver → dollar exposure → action.

## You are allowed to work autonomously

You may inspect, edit, refactor, test, and run the app without asking me for every small decision.

You may touch multiple files when needed.

You may:
- edit frontend files
- edit service files
- edit Supabase edge functions
- create migration files
- run npm commands
- run build checks
- run local dev server
- use Playwright MCP to inspect the site
- use Supabase MCP to inspect schema, rows, functions, logs, and types
- use Supabase CLI for safe inspection

## Hard safety rules

- Do not read, print, edit, or expose `.env` or secrets.
- Do not run `supabase secrets list`.
- Do not run `supabase secrets set`.
- Do not run `supabase db reset`.
- Do not run `supabase migration repair`.
- Do not force push.
- Do not delete production rows unless explicitly told in the current prompt.
- Do not remove the evidence-backed vs scenario-modeled distinction.
- Do not present stale/cumulative percentages as new shocks.

## Required workflow

For large work:
1. Inspect the codebase.
2. Create a short plan.
3. Implement across files.
4. Run `npm run build`.
5. Run `npm run dev`.
6. Use Playwright MCP to inspect the dashboard.
7. Fix visible layout or console errors.
8. Use Supabase MCP to inspect DB/functions only when needed.
9. Summarize files changed, tests run, and remaining issues.

## Product priorities

1. Clean executive dashboard UI.
2. Better Operating Changes explanations.
3. Better Watchlist explanations.
4. Stronger Opportunity cards.
5. Group Relationship Preview by exposure type.
6. Better evidence audit.
7. Better leadership brief.
8. Calibration completeness score.
9. Action tracking improvements.
10. Google auth and workspace/company separation.

## Trust rules

Every issue must clearly show one model basis:
- Evidence-backed exposure
- Scenario-modeled exposure
- Residual operating exposure
- Watchlist-only
- Needs calibration

If evidence contains a number but it is cumulative, stale, contextual, or not clearly incremental, reject it and explain why once.

If no clean source-backed shock exists, use scenario assumptions and label them clearly.

## Current important files

Frontend:
- src/pages/DashboardPage.tsx
- src/pages/DashboardPage.css

Services:
- src/services/dynamicRiskGenerator.ts
- src/services/opportunityGenerator.ts
- src/services/exposureGraphService.ts
- src/services/freshIntelligenceService.ts
- src/services/specificExplanationService.ts

Supabase:
- supabase/functions/generate-dynamic-risks/index.ts
- supabase/migrations/
