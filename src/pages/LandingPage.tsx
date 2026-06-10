import { Link } from "react-router-dom";

export default function LandingPage() {
  return (
    <main className="page">
      <div className="container">
        <h1>GroundSense</h1>

        <p>
          External intelligence for companies that do not have an intelligence team.
        </p>

        <div className="card">
          <h2>What GroundSense does</h2>
          <p>
            It monitors external signals, maps them to a company model, scores impact,
            and generates weekly intelligence briefs.
          </p>
        </div>

        <div className="card">
          <h2>MVP Flow</h2>
          <p>1. Build company model</p>
          <p>2. Generate tracking queries</p>
          <p>3. Collect external events</p>
          <p>4. Score event relevance</p>
          <p>5. Generate weekly brief</p>
        </div>

        <Link to="/onboarding">
          <button className="button">Start Onboarding</button>
        </Link>

        <Link to="/dashboard" style={{ marginLeft: 12 }}>
          <button className="button">Dashboard</button>
        </Link>
      </div>
    </main>
  );
}