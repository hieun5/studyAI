import { useRef, useState, useEffect, type FormEvent } from "react";
import { api, type Passage } from "../api";
import { Card, Badge } from "./ui";

export default function MaterialSearch({ sessionId }: { sessionId: string }) {
  const [query, setQuery] = useState("");
  const [passages, setPassages] = useState<Passage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const timeout = setTimeout(() => request.abort(), 15000);
    setBusy(true);
    setError("");
    setPassages(null);
    try {
      const result = await api<{ passages: Passage[] }>(
        "/sessions/" + sessionId + "/retrieve",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, top_k: 5 }),
          signal: request.signal,
        },
      );
      if (!request.signal.aborted) setPassages(result.passages);
    } catch (error) {
      if (controller.current === request)
        setError(request.signal.aborted ? "Passage search timed out. Check FastAPI and try again." : error instanceof Error ? error.message : "Search failed.");
    } finally {
      clearTimeout(timeout);
      if (controller.current === request) setBusy(false);
    }
  }
  return (
    <Card className="session-card">
      <div className="section-heading">
        <div>
          <h2>Find a passage in your material</h2>
          <p>
            TF-IDF and cosine similarity match the words in your query. This is
            retrieval, not an AI answer.
          </p>
        </div>
        <Badge>Real TF-IDF retrieval</Badge>
      </div>
      <form onSubmit={search}>
        <label htmlFor="query">Topic or question</label>
        <div className="retrieval-controls">
          <input
            id="query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={2000}
            required
            placeholder="e.g. How do mitochondria produce ATP?"
          />
          <button className="primary" disabled={busy || !query.trim()}>
            {busy ? "Searching…" : "Find passages"}
          </button>
        </div>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div aria-live="polite" aria-busy={busy}>
        {passages?.length === 0 && (
          <p className="form-message">
            No matching terms found. Try terminology from your notes.
          </p>
        )}
        {passages && passages.length > 0 && (
          <p className="retrieval-summary">
            {passages.length} relevant passage(s). Scores measure word overlap,
            not confidence or correctness.
          </p>
        )}
        {passages?.map((passage) => (
          <article className="passage" key={passage.chunk_id}>
            <div className="passage-heading">
              <strong>
                {passage.filename || "Pasted lecture notes"}
                {passage.page_number !== null
                  ? " · Page " + passage.page_number
                  : ""}
              </strong>
              <span>Similarity: {passage.score.toFixed(3)}</span>
            </div>
            <p>{passage.text}</p>
          </article>
        ))}
      </div>
    </Card>
  );
}
