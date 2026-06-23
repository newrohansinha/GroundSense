import { Fragment, type ReactNode, type CSSProperties, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { enterDemoMode } from "../services/companyService";
import "./LandingPage.css";

// ─── Type definitions ───────────────────────────────────────────────────────

type GphNodeData = {
  status: string;
  badge: string;
  title: string;
  sub?: string;
  value?: string;
};

// ─── Micro-component: Badge ──────────────────────────────────────────────────

function LpBadge({ children, variant }: { children: ReactNode; variant: string }) {
  return <span className={`lp-badge lp-badge--${variant}`}>{children}</span>;
}

// ─── Product preview: KPI stat row ──────────────────────────────────────────

function LpKpiRow() {
  return (
    <div className="lp-kpi-row">
      <div className="lp-kpi-card">
        <div className="lp-kpi-lbl">Exposures</div>
        <div className="lp-kpi-val">2</div>
        <div className="lp-kpi-sub">1 risk · 1 validation</div>
      </div>

      <div className="lp-kpi-card lp-kpi-card--accent">
        <div className="lp-kpi-lbl">Value at stake</div>
        <div className="lp-kpi-val">~$900K</div>
        <div className="lp-kpi-sub">source + formula shown</div>
      </div>

      <div className="lp-kpi-card">
        <div className="lp-kpi-lbl">Actions</div>
        <div className="lp-kpi-val">2</div>
        <div className="lp-kpi-sub">owners assigned</div>
      </div>

      <div className="lp-kpi-card">
        <div className="lp-kpi-lbl">Coverage</div>
        <div className="lp-kpi-val">88%</div>
        <div className="lp-kpi-sub">model calibrated</div>
      </div>
    </div>
  );
}

// ─── Product preview: Executive Brief card ───────────────────────────────────

function LpBriefPreview() {
  return (
    <div className="lp-brief">
      <div className="lp-brief-hdr">
        <span className="lp-brief-title">Exposure Brief</span>
        <span className="lp-brief-date">Jun 12</span>
      </div>

      <p className="lp-brief-body">
        Freight pressure is hitting spot-exposed lanes. Tariff relief is possible,
        but supplier landed-cost updates are still unconfirmed.
      </p>

      <div className="lp-brief-issues">
        <div className="lp-brief-issue">
          <LpBadge variant="risk">Risk</LpBadge>
          <div className="lp-brief-issue-body">
            <span className="lp-brief-issue-name">Spot freight exposure</span>
            <span className="lp-brief-issue-val">~$150K</span>
          </div>
        </div>

        <div className="lp-brief-issue">
          <LpBadge variant="change">Validate</LpBadge>
          <div className="lp-brief-issue-body">
            <span className="lp-brief-issue-name">Tariff relief not captured</span>
            <span className="lp-brief-issue-val">~$750K</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Product preview: Exposure Graph ────────────────────────────────────────

function GphNode({ node }: { node: GphNodeData }) {
  return (
    <div className={`lp-gph-node lp-gph-node--${node.status}`}>
      <span className={`lp-gph-badge lp-gph-badge--${node.status}`}>
        {node.badge}
      </span>

      <span className="lp-gph-node-title">{node.title}</span>

      {node.sub && <span className="lp-gph-node-sub">{node.sub}</span>}
      {node.value && <span className="lp-gph-node-value">{node.value}</span>}
    </div>
  );
}

const GRAPH_PATHS: {
  id: string;
  label: string;
  type: string;
  impact: string;
  nodes: GphNodeData[];
}[] = [
  {
    id: "freight",
    label: "Spot freight exposure",
    type: "Risk",
    impact: "~$150K",
    nodes: [
      {
        status: "verified",
        badge: "Metric",
        title: "Freight PPI",
        sub: "+0.8%",
      },
      {
        status: "company_calibrated",
        badge: "Exposure",
        title: "$27M freight spend",
        sub: "67% spot exposed",
      },
      {
        status: "estimate",
        badge: "Formula",
        title: "$27M × 67% × 0.8%",
        sub: "No article math",
      },
      {
        status: "estimate",
        badge: "Impact",
        title: "~$150K cost pressure",
        value: "Lane validation pending",
      },
      {
        status: "action",
        badge: "Action",
        title: "Validate spot lanes",
        sub: "Supply Chain · Jun 30",
      },
    ],
  },
  {
    id: "tariff",
    label: "Tariff relief not captured",
    type: "Operating Change",
    impact: "~$750K",
    nodes: [
      {
        status: "verified",
        badge: "Metric",
        title: "Tariff rate change",
        sub: "25% → 15%",
      },
      {
        status: "company_calibrated",
        badge: "Exposure",
        title: "$37.6M steel imports",
        sub: "80% pass-through",
      },
      {
        status: "estimate",
        badge: "Formula",
        title: "$37.6M × 20% × 10 pts",
        sub: "Supplier validation needed",
      },
      {
        status: "estimate",
        badge: "Impact",
        title: "~$750K relief at stake",
        value: "Not booked until confirmed",
      },
      {
        status: "action",
        badge: "Action",
        title: "Check landed cost",
        sub: "Procurement · Jul 15",
      },
    ],
  },
];

const COL_LABELS = [
  "Outside change",
  "Company exposure",
  "Formula",
  "Dollar impact",
  "Owner action",
];

function LpGraphPreview({
  compact = false,
  singlePath = false,
}: {
  compact?: boolean;
  singlePath?: boolean;
}) {
  const paths = singlePath ? [GRAPH_PATHS[0]] : GRAPH_PATHS;

  return (
    <div className={`lp-gph${compact ? " lp-gph--compact" : ""}`}>
      {!compact && (
        <div className="lp-gph-legend" aria-hidden="true">
          {COL_LABELS.map((label) => (
            <span key={label} className="lp-gph-legend-col">
              {label}
            </span>
          ))}
        </div>
      )}

      <div className="lp-gph-paths">
        {paths.map((path) => (
          <div key={path.id} className="lp-gph-path">
            <div className="lp-gph-path-head">
              <span className="lp-gph-path-label">{path.label}</span>

              <span
                className={`lp-gph-path-type lp-gph-path-type--${
                  path.type === "Risk" ? "risk" : "change"
                }`}
              >
                {path.type}
              </span>

              <span className="lp-gph-path-impact">{path.impact} at stake</span>
            </div>

            <div className="lp-gph-flow">
              {path.nodes.map((node, index) => (
                <Fragment key={index}>
                  <GphNode node={node} />
                  {index < path.nodes.length - 1 && (
                    <div className="lp-gph-arr" aria-hidden="true" />
                  )}
                </Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Product preview: Actions card ──────────────────────────────────────────

const PREVIEW_ACTIONS = [
  {
    title: "Validate spot-exposed freight lanes and surcharge terms",
    issue: "Spot freight exposure",
    owner: "Supply Chain",
    due: "Jun 30",
    value: "~$150K at stake",
    status: "open",
  },
  {
    title: "Confirm supplier landed-cost updates on steel-linked imports",
    issue: "Tariff relief not captured",
    owner: "Procurement",
    due: "Jul 15",
    value: "~$750K to validate",
    status: "open",
  },
  {
    title: "Check copper-linked spend before promoting the price signal",
    issue: "Copper price move",
    owner: "Procurement",
    due: "Review",
    value: "No estimate yet",
    status: "review",
  },
];

function LpActionsPreview() {
  return (
    <div className="lp-act">
      <div className="lp-act-hdr">
        <span className="lp-act-title">Owner actions</span>
        <span className="lp-act-count">2 open · 1 review</span>
      </div>

      <div className="lp-act-list">
        {PREVIEW_ACTIONS.map((action, index) => (
          <div key={index} className="lp-act-row">
            <div className="lp-act-row-body">
              <span className="lp-act-row-name">{action.title}</span>

              <div className="lp-act-row-meta">
                <span>{action.owner}</span>
                <span className="lp-act-dot" aria-hidden="true" />
                <span>
                  {action.due === "Review" ? "Needs data" : `Due ${action.due}`}
                </span>
                <span className="lp-act-dot" aria-hidden="true" />
                <span className="lp-act-row-val">{action.value}</span>
              </div>
            </div>

            <span className={`lp-act-status lp-act-status--${action.status}`}>
              {action.status === "open" ? "Open" : "Review"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Product preview: Source verification card ───────────────────────────────

const PREVIEW_SOURCES = [
  {
    signal: "Freight PPI +0.8%",
    source: "BLS transportation PPI",
    date: "Apr 2026",
    kind: "verified",
  },
  {
    signal: "Steel / metals PPI",
    source: "BLS Producer Price Index",
    date: "May 2026",
    kind: "verified",
  },
  {
    signal: "Tariff metric upload",
    source: "Company-provided tariff file",
    date: "Current run",
    kind: "verified",
  },
  {
    signal: "Supplier country-of-origin",
    source: "Company calibration",
    date: "Current model",
    kind: "verified",
  },
  {
    signal: "SEC filing context",
    source: "SEC EDGAR",
    date: "Latest filing",
    kind: "context",
  },
  {
    signal: "Article feed context",
    source: "GDELT / news source",
    date: "Current run",
    kind: "context",
  },
  {
    signal: "Macro backdrop",
    source: "World Bank public data",
    date: "Latest available",
    kind: "context",
  },
];

function LpSourcePreview() {
  return (
    <div className="lp-src">
      <div className="lp-src-hdr">
        <span className="lp-src-title">Evidence and context</span>
        <span className="lp-src-note">Only structured inputs drive estimates</span>
      </div>

      <div className="lp-src-list">
        {PREVIEW_SOURCES.map((source, index) => (
          <div key={index} className="lp-src-row">
            <div className="lp-src-row-main">
              <span className="lp-src-signal">{source.signal}</span>
              <span className="lp-src-meta">
                {source.source} · {source.date}
              </span>
            </div>

            <span className={`lp-src-badge lp-src-badge--${source.kind}`}>
              {source.kind === "verified" ? "Calculation input" : "Context only"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Hero product window ─────────────────────────────────────────────────────

function LpHeroWindow() {
  return (
    <div className="lp-hw">
      <div className="lp-hw-bar">
        <div className="lp-hw-dots">
          <span className="lp-hw-dot" />
          <span className="lp-hw-dot" />
          <span className="lp-hw-dot" />
        </div>

        <span className="lp-hw-label">Exposure Register</span>
      </div>

      <div className="lp-hw-body">
        <LpKpiRow />
        <LpBriefPreview />
        <LpGraphPreview compact singlePath />
      </div>
    </div>
  );
}

// ─── Page copy ───────────────────────────────────────────────────────────────

const WHY_ITEMS = [
  {
    n: "01",
    title: "Maps to your business",
    body: "A freight move only matters if it touches your lanes, suppliers, customers, or spend.",
  },
  {
    n: "02",
    title: "Shows the math",
    body: "Each estimate includes the inputs, formula, and confidence label.",
  },
  {
    n: "03",
    title: "Blocks weak matches",
    body: "No exposure, no formula, no owner action — no executive issue.",
  },
  {
    n: "04",
    title: "Assigns the next step",
    body: "Every promoted issue has an owner, due date, and validation action.",
  },
];

const HOW_STEPS = [
  {
    n: "1",
    title: "Start with an outside change",
    body: "Freight indexes, tariff filings, commodity moves, filings, and article context enter the source layer.",
  },
  {
    n: "2",
    title: "Match it to the company",
    body: "GroundSense checks suppliers, lanes, product categories, customer segments, spend, and margins.",
  },
  {
    n: "3",
    title: "Show the formula",
    body: "The estimate is built from calibrated inputs. If it is a scenario, it says so.",
  },
  {
    n: "4",
    title: "Keep weak matches out",
    body: "Missing evidence becomes a validation request, not a fake executive risk.",
  },
  {
    n: "5",
    title: "Assign the owner",
    body: "Promoted issues get an owner, due date, escalation trigger, and done condition.",
  },
];

const BENEFITS = [
  "What changed?",
  "Does it touch our suppliers, lanes, customers, or spend?",
  "Which line item does it hit?",
  "What is the dollar range?",
  "Is the number verified or scenario-modeled?",
  "Which assumption is weakest?",
  "Who owns the next action?",
  "What data would improve the estimate?",
];

const PERSONAS = [
  {
    role: "CFO / Finance",
    questions: [
      "Which outside changes could move margin this quarter?",
      "Which estimates are verified, and which are scenarios?",
      "What assumption would change the number most?",
    ],
  },
  {
    role: "Procurement",
    questions: [
      "Which suppliers are exposed to tariff or commodity movement?",
      "Which landed-cost updates have not been validated?",
      "Which open POs or SKUs should we check first?",
    ],
  },
  {
    role: "COO / Operations",
    questions: [
      "Which lanes or service levels are exposed?",
      "Which action is due before the next planning cycle?",
      "Which risks are blocked because we lack lane or supplier data?",
    ],
  },
];

const TRUST_ITEMS = [
  {
    title: "Numbers come from structured inputs",
    body: "Indexes, filings, tariff metrics, and company calibration drive dollar estimates. Articles provide context only.",
  },
  {
    title: "Weak matches stay in review",
    body: "No company exposure, no formula, or no owner action means the item does not reach the register.",
  },
  {
    title: "Every issue has a trail",
    body: "Source, company input, formula, confidence label, and action history stay attached.",
  },
];

const SHOWCASE_TABS = ["Brief", "Exposure path", "Actions", "Evidence"] as const;
type ShowcaseTab = (typeof SHOWCASE_TABS)[number];

// ─── Product showcase ───────────────────────────────────────────────────────

function ProductShowcase() {
  const [tab, setTab] = useState<ShowcaseTab>("Brief");

  return (
    <div className="lp-showcase-tabs">
      <div className="lp-sc-tabbar" role="tablist">
        {SHOWCASE_TABS.map((tabName) => (
          <button
            key={tabName}
            role="tab"
            aria-selected={tab === tabName}
            className={`lp-sc-tab${tab === tabName ? " lp-sc-tab--on" : ""}`}
            onClick={() => setTab(tabName)}
          >
            {tabName}
          </button>
        ))}
      </div>

      <div className="lp-sc-panel" role="tabpanel" key={tab}>
        {tab === "Brief" && (
          <div className="lp-sc-brief-layout">
            <LpKpiRow />
            <LpBriefPreview />
          </div>
        )}

        {tab === "Exposure path" && (
          <div className="lp-sc-graph-layout">
            <LpGraphPreview />
          </div>
        )}

        {tab === "Actions" && (
          <div className="lp-sc-actions-layout">
            <LpActionsPreview />
          </div>
        )}

        {tab === "Evidence" && (
          <div className="lp-sc-sources-layout">
            <LpSourcePreview />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Default export ──────────────────────────────────────────────────────────

export default function LandingPage() {
  function viewDemo() {
    enterDemoMode();
    window.location.assign("/demo");
  }

  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".lp-will-reveal");
    if (!els.length) return;

    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add("lp-revealed");
            io.unobserve(entry.target);
          }
        }),
      { threshold: 0.1, rootMargin: "0px 0px -48px 0px" }
    );

    els.forEach((el) => io.observe(el));

    return () => io.disconnect();
  }, []);

  return (
    <div className="lp-root">
      {/* ── Navigation ── */}
      <header className="lp-header">
        <nav className="lp-nav" aria-label="Main navigation">
          <Link to="/" className="lp-brand" aria-label="GroundSense home">
            <span className="lp-brand-dot" aria-hidden="true" />
            GroundSense
          </Link>

          <ul className="lp-nav-links" role="list">
            <li>
              <a href="#how-it-works" className="lp-nav-link">
                How it works
              </a>
            </li>
            <li>
              <a href="#product" className="lp-nav-link">
                Product
              </a>
            </li>
            <li>
              <a href="#methodology" className="lp-nav-link">
                Methodology
              </a>
            </li>
            <li>
              <a href="#for-whom" className="lp-nav-link">
                Use cases
              </a>
            </li>
          </ul>

          <div className="lp-nav-end">
            <button type="button" className="lp-nav-ghost" onClick={viewDemo}>
              View demo
            </button>
            <Link to="/sign-in" className="lp-nav-ghost">
              Sign in
            </Link>
            <Link to="/sign-up" className="lp-nav-cta">
              Get started
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* ── Hero ── */}
        <section className="lp-hero" aria-labelledby="lp-headline">
          <div className="lp-hero-inner">
            <div className="lp-hero-content">
              <h1 className="lp-headline" id="lp-headline">
                See what market shocks

                <br />
                <span className="lp-headline-accent">cost you.</span>
              </h1>

              <p className="lp-subtext">
                GroundSense shows where outside changes hit your business,
                what they cost, who needs to act, and how.
              </p>

              <div className="lp-hero-actions">
                <Link to="/sign-up" className="lp-btn-primary">
                  Get started
                </Link>
                <button type="button" className="lp-btn-outline" onClick={viewDemo}>
                  View demo
                </button>
              </div>
            </div>

            <div className="lp-hero-visual" aria-label="GroundSense product preview">
              <LpHeroWindow />
            </div>
          </div>
        </section>

        {/* ── Why Different ── */}
        <section className="lp-why" aria-labelledby="lp-why-hed">
          <div className="lp-section-inner">
            <h2 className="lp-section-hed" id="lp-why-hed">
              Alerts tell you what happened. GroundSense shows what it costs.
            </h2>

            <div className="lp-why-grid">
              {WHY_ITEMS.map((item, index) => (
                <div
                  key={item.n}
                  className="lp-why-item lp-will-reveal"
                  style={{ "--i": index } as CSSProperties}
                >
                  <h3 className="lp-why-title">{item.title}</h3>
                  <p className="lp-why-body">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How It Works ── */}
        <section className="lp-how" id="how-it-works" aria-labelledby="lp-how-hed">
          <div className="lp-section-inner">
            <h2 className="lp-section-hed" id="lp-how-hed">
              How a headline becomes an operating issue
            </h2>

            <ol className="lp-how-steps">
              {HOW_STEPS.map((step, index) => (
                <li
                  key={step.n}
                  className="lp-how-step lp-will-reveal"
                  style={{ "--i": index } as CSSProperties}
                >
                  <span className="lp-how-n" aria-hidden="true">
                    {step.n}
                  </span>
                  <h3 className="lp-how-title">{step.title}</h3>
                  <p className="lp-how-body">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Product Showcase ── */}
        <section className="lp-product" id="product" aria-labelledby="lp-product-hed">
          <div className="lp-section-inner">
            <h2 className="lp-section-hed" id="lp-product-hed">
              Source. Formula. Owner.
            </h2>

            <p className="lp-product-sub">
              One chain: outside change → company exposure → dollar impact → action.
            </p>

            <ProductShowcase />
          </div>
        </section>

        {/* ── What You Can See ── */}
        <section className="lp-benefits" aria-labelledby="lp-benefits-hed">
          <div className="lp-section-inner">
            <h2 className="lp-section-hed" id="lp-benefits-hed">
              Questions the dashboard answers
            </h2>

            <ul className="lp-benefits-grid" role="list">
              {BENEFITS.map((benefit, index) => (
                <li
                  key={benefit}
                  className="lp-benefit-item lp-will-reveal"
                  style={{ "--i": index } as CSSProperties}
                >
                  <span className="lp-benefit-check" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <circle cx="7" cy="7" r="6.5" stroke="currentColor" strokeOpacity="0.3" />
                      <path
                        d="M4 7.2L6.2 9.4L10 5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── Personas ── */}
        <section className="lp-personas" id="for-whom" aria-labelledby="lp-personas-hed">
          <div className="lp-section-inner">
            <h2 className="lp-section-hed" id="lp-personas-hed">
              Who uses GroundSense
            </h2>

            <div className="lp-personas-grid">
              {PERSONAS.map((persona, index) => (
                <div
                  key={persona.role}
                  className="lp-persona lp-will-reveal"
                  style={{ "--i": index } as CSSProperties}
                >
                  <h3 className="lp-persona-role">{persona.role}</h3>

                  <ul className="lp-persona-qs" role="list">
                    {persona.questions.map((question, qIndex) => (
                      <li key={qIndex} className="lp-persona-q">
                        {question}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Methodology ── */}
        <section className="lp-trust" id="methodology" aria-labelledby="lp-trust-hed">
          <div className="lp-section-inner">
            <div className="lp-trust-layout">
              <div className="lp-trust-left">
                <h2 className="lp-trust-hed" id="lp-trust-hed">
                  Every dollar shows its work.
                </h2>

                <p className="lp-trust-copy">
                  Each estimate keeps the source, formula, company inputs,
                  confidence label, and missing data.
                </p>

                <div className="lp-trust-items">
                  {TRUST_ITEMS.map((item, index) => (
                    <div
                      key={item.title}
                      className="lp-trust-item lp-will-reveal"
                      style={{ "--i": index } as CSSProperties}
                    >
                      <h3 className="lp-trust-item-title">{item.title}</h3>
                      <p className="lp-trust-item-body">{item.body}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lp-trust-right">
                <LpSourcePreview />
              </div>
            </div>
          </div>
        </section>

        {/* ── Closing CTA ── */}
        <section className="lp-cta" aria-labelledby="lp-cta-hed">
          <div className="lp-section-inner lp-cta-inner">
            <h2 className="lp-cta-hed" id="lp-cta-hed">
              Stop asking what happened.
              <br />
              Ask what it costs.
            </h2>

            <p className="lp-cta-sub">
              Upload suppliers, freight lanes, financial anchors, and customer signals.
              See which outside changes actually matter.
            </p>

            <div className="lp-cta-actions">
              <Link to="/sign-up" className="lp-btn-primary lp-btn--lg">
                Get started
              </Link>
              <button type="button" className="lp-btn-outline lp-btn--lg" onClick={viewDemo}>
                View demo
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <div className="lp-brand">
              <span className="lp-brand-dot" aria-hidden="true" />
              GroundSense
            </div>

            <p className="lp-footer-tagline">
              Maps outside changes to company exposure.
            </p>
          </div>

          <nav className="lp-footer-nav" aria-label="Footer navigation">
            <div className="lp-footer-col">
              <span className="lp-footer-col-head">Product</span>
              <Link to="/dashboard" className="lp-footer-link">
                Dashboard
              </Link>
              <Link to="/calibration" className="lp-footer-link">
                Calibration
              </Link>
              <Link to="/sources" className="lp-footer-link">
                Sources
              </Link>
              <Link to="/risks" className="lp-footer-link">
                Risk Register
              </Link>
            </div>

            <div className="lp-footer-col">
              <span className="lp-footer-col-head">Company</span>
              <a href="#methodology" className="lp-footer-link">
                Methodology
              </a>
              <a href="mailto:rohansinha2312@gmail.com" className="lp-footer-link">
                Contact
              </a>
              <Link to="/sign-up" className="lp-footer-link">
                Get started
              </Link>
            </div>
          </nav>
        </div>

        <div className="lp-footer-bottom">
          <span className="lp-footer-copy">GroundSense 2026</span>
        </div>
      </footer>
    </div>
  );
}