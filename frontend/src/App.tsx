import { useEffect, useState } from "react";
import { Card, Badge } from "./components/ui";
import { API_BASE } from "./api";
import StartStudying from "./pages/StartStudying";
import Dashboard from "./pages/Dashboard";
import useQuizResults from "./results/useQuizResults";

type Page = "Dashboard" | "Study Materials" | "Start Studying";
const pages: { name: Page; icon: string }[] = [
  { name: "Dashboard", icon: "◫" },
  { name: "Study Materials", icon: "▤" },
  { name: "Start Studying", icon: "✧" },
];
function initialTheme(): boolean {
  try {
    const theme = localStorage.getItem("studyai-theme");
    return theme
      ? theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}
export default function App() {
  const results = useQuizResults();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [page, setPage] = useState<Page>("Dashboard");
  const [dark, setDark] = useState(initialTheme);
  const [health, setHealth] = useState<"checking" | "online" | "offline">(
    "checking",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("studyai-theme", dark ? "dark" : "light");
    } catch {
      /* Theme still works without browser storage. */
    }
  }, [dark]);
  useEffect(() => {
    let disposed = false;
    let current: AbortController | null = null;
    async function checkBackend() {
      current?.abort();
      const request = new AbortController();
      current = request;
      const timeout = setTimeout(() => request.abort(), 4000);
      try {
        const response = await fetch(API_BASE + "/health", { signal: request.signal });
        if (!response.ok || (await response.json()).status !== "ok") throw new Error("Unhealthy");
        if (!disposed) setHealth("online");
      } catch {
        if (!disposed) setHealth("offline");
      } finally {
        clearTimeout(timeout);
      }
    }
    void checkBackend();
    const interval = setInterval(() => void checkBackend(), 15000);
    return () => {
      disposed = true;
      current?.abort();
      clearInterval(interval);
    };
  }, []);
  return (
    <>
      <div className="desktop-notice">
        studyAI is designed for desktop. Open this page in a window at least
        1024px wide.
      </div>
      <div className="app-shell">
        <aside className="sidebar">
          <a
            className="brand"
            href="#main"
            onClick={() => setPage("Dashboard")}
          >
            <span className="brand-mark" aria-hidden="true">
              ✧
            </span>
            study<span>AI</span>
          </a>
          <div className="workspace-label">YOUR WORKSPACE</div>
          <nav aria-label="Main navigation">
            {pages.map((item) => (
              <button
                key={item.name}
                aria-current={page === item.name ? "page" : undefined}
                className={"nav-item " + (page === item.name ? "active" : "")}
                onClick={() => setPage(item.name)}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.name}
                {item.name === "Start Studying" && (
                  <span className="nav-arrow" aria-hidden="true">
                    ↗
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="local-note">
              <span aria-hidden="true">◎</span>
              <strong>Your space. Your pace.</strong>
              <p>Free to use. Built to run locally.</p>
            </div>
            <button
              className="theme-button"
              onClick={() => setDark(!dark)}
              aria-pressed={dark}
            >
              <span aria-hidden="true">{dark ? "☀" : "◐"}</span>
              {dark ? "Switch to light mode" : "Switch to dark mode"}
            </button>
            <div className="stage-label">LOCAL AI · PORTFOLIO MVP</div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <span>
              Workspace <span className="breadcrumb">/</span>{" "}
              <strong>{page}</strong>
            </span>
            <span className="service-status" role="status">
              <i className={health} />
              {health === "online"
                ? "Backend online"
                : health === "checking"
                  ? "Checking backend…"
                  : "Backend offline"}
            </span>
          </header>
          <main id="main">
            <div className="page-heading">
              <div>
                <div className="eyebrow">A LITTLE PROGRESS, EVERY DAY</div>
                <h1>
                  {page === "Dashboard"
                    ? "See where to focus next."
                    : page === "Study Materials"
                      ? "Your knowledge starts here."
                      : "Turn your notes into understanding."}
                </h1>
                <p>
                  {page === "Dashboard"
                    ? "Review your quiz scores, reasoning feedback, and next study topics."
                    : page === "Study Materials"
                      ? "Bring your lecture notes together, one topic at a time."
                      : "Add your lecture notes and set up your next practice session."}
                </p>
              </div>
              <Badge>Local study workspace</Badge>
            </div>
            <div hidden={page !== "Start Studying"}>
              <StartStudying
                onPracticeUpdate={results.onPracticeUpdate}
                onSessionChange={setActiveSessionId}
              />
            </div>
            {page === "Dashboard" && (
              <Dashboard
                attempts={results.attempts}
                notice={results.notice}
                onClear={results.clearResults}
                onStart={() => setPage("Start Studying")}
                activeSessionId={activeSessionId}
              />
            )}
            {page === "Study Materials" && (
              <Card className="empty-state">
                <span className="empty-icon" aria-hidden="true">
                  ▤
                </span>
                <h2>A fresh page for your notes.</h2>
                <p>
                  The saved-materials library is not implemented yet.
                  <br />
                  You can paste notes or select a PDF in Start Studying.
                </p>
                <button
                  className="primary"
                  onClick={() => setPage("Start Studying")}
                >
                  Add study input <span aria-hidden="true">→</span>
                </button>
                <small>
                  Notes and selected files stay in memory for this visit.
                </small>
              </Card>
            )}
            <footer>
              Made for focused minds.{" "}
              <span>Local first · No account needed</span>
            </footer>
          </main>
        </div>
      </div>
    </>
  );
}
