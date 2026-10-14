import { useEffect, useRef, useState } from "react";
import { api, type Passage } from "../api";
import type { Recommendation } from "../results/model";

export default function ReviewPassages({
  recommendation,
  activeSessionId,
}: {
  recommendation: Recommendation;
  activeSessionId: string | null;
}) {
  const [passages, setPassages] = useState<Passage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setPassages(null);
    setMessage("");
    setBusy(false);
    return () => { controller.current?.abort(); controller.current = null; };
  }, [activeSessionId, recommendation]);
  async function review() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const timeout = setTimeout(() => request.abort(), 30000);
    setBusy(true);
    setMessage("");
    setPassages(null);
    const ids = [
      ...new Set([
        ...recommendation.sessionIds,
        ...(activeSessionId ? [activeSessionId] : []),
      ]),
    ];
    let matchedSession = false;
    try {
      for (const sessionId of ids) {
        try {
          const result = await api<{ passages: Passage[] }>(
            "/sessions/" + encodeURIComponent(sessionId) + "/retrieve",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: request.signal,
              body: JSON.stringify({
                query: recommendation.reviewTopic + " " + recommendation.topic,
                top_k: 3,
              }),
            },
          );
          if (request.signal.aborted || controller.current !== request) return;
          matchedSession = true;
          if (result.passages.length) {
            setPassages(result.passages);
            return;
          }
        } catch {
          if (request.signal.aborted) break;
        }
      }
      if (controller.current !== request || request.signal.aborted) return;
      setMessage(
        matchedSession
          ? "No matching passages found. Process notes covering this review topic and try again."
          : "The lecture-note index is unavailable or expired. Your saved results remain available. Start the backend and process matching lecture notes again to retrieve passages.",
      );
    } finally {
      clearTimeout(timeout);
      if (controller.current === request) {
        setBusy(false);
        if (request.signal.aborted)
          setMessage(
            "Passage retrieval was interrupted. Start the backend, process matching notes, and try again. Saved scores are unaffected.",
          );
      }
    }
  }
  return (
    <div className="review-passages">
      <button
        type="button"
        className="text-button"
        disabled={busy}
        onClick={() => void review()}
      >
        {busy ? "Finding passages…" : "Find passages in my notes"}
      </button>
      {message && (
        <p className="retrieval-summary" role="status">
          {message}
        </p>
      )}
      {passages && (
        <div aria-live="polite">
          {passages.map((passage) => (
            <article className="passage" key={passage.chunk_id}>
              <div className="passage-heading">
                <strong>
                  {passage.filename || "Pasted lecture notes"}
                  {passage.page_number ? " · Page " + passage.page_number : ""}
                </strong>
                <span>Text similarity: {passage.score.toFixed(3)}</span>
              </div>
              <p>{passage.text}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
