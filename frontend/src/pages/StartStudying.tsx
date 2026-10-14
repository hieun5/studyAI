import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  deleteSession,
  type Limits,
  type MaterialSession,
  type PracticeSet,
} from "../api";
import { Badge, Card } from "../components/ui";
import MaterialSearch from "../components/MaterialSearch";
import PracticePanel from "../components/PracticePanel";
import demoNotes from "../data/demo-lecture.txt?raw";

export default function StartStudying({
  onPracticeUpdate,
  onSessionChange,
}: {
  onPracticeUpdate?: (sessionId: string, practice: PracticeSet) => void;
  onSessionChange?: (sessionId: string | null) => void;
}) {
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [session, setSession] = useState<MaterialSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const materialBusy = busy || practiceBusy;
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<MaterialSession | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const request = new AbortController();
    api<Limits>("/limits", { signal: request.signal })
      .then(setLimits)
      .catch(() => {});
    return () => {
      request.abort();
      controller.current?.abort();
      if (sessionRef.current)
        void deleteSession(sessionRef.current.session_id).catch(() => {});
    };
  }, []);

  useEffect(() => {
    onSessionChange?.(session?.session_id ?? null);
  }, [session, onSessionChange]);

  useEffect(() => {
    if (!session) return;
    const timeout = setTimeout(
      () => {
        sessionRef.current = null;
        setSession(null);
        setMessage(
          "The temporary session expired. Process your material again to search it.",
        );
      },
      Math.max(0, session.expires_at * 1000 - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [session]);

  async function clearSession() {
    if (!sessionRef.current) return;
    setBusy(true);
    setError("");
    try {
      await deleteSession(sessionRef.current.session_id);
      sessionRef.current = null;
      setSession(null);
      setMessage(
        "Temporary server session cleared. Your form input is still available.",
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not clear session.",
      );
    } finally {
      setBusy(false);
    }
  }

  function inputChanged() {
    // Changes invalidate the index; deletion is best-effort if the server is offline.
    if (sessionRef.current)
      void deleteSession(sessionRef.current.session_id).catch(() => {});
    sessionRef.current = null;
    setSession(null);
    setMessage("");
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (materialBusy) return;
    setMessage("");
    setError("");
    if (!notes.trim() && !file) {
      setError(
        "Paste lecture notes or select a text-based PDF before processing.",
      );
      return;
    }
    setBusy(true);
    const request = new AbortController();
    controller.current = request;
    const timeout = setTimeout(() => request.abort(), 60000);
    try {
      if (sessionRef.current) {
        await deleteSession(sessionRef.current.session_id);
        sessionRef.current = null;
        setSession(null);
      }
      const data = new FormData();
      data.append("notes", notes);
      // Browsers can leave File.type empty; the backend still validates PDF bytes.
      if (file) data.append("pdf", new Blob([file], { type: file.type || "application/pdf" }), file.name);
      const result = await api<MaterialSession>("/sessions", {
        method: "POST",
        body: data,
        signal: request.signal,
      });
      sessionRef.current = result;
      setSession(result);
      setMessage(
        "Material processed successfully: " +
          result.chunk_count +
          " searchable passages" +
          (result.page_count
            ? " from " + result.page_count + " PDF pages"
            : "") +
          ". Ready for retrieval and local question generation.",
      );
    } catch (error) {
      setError(
        request.signal.aborted
          ? "Processing timed out. Try a smaller document. Any unfinished server session will expire automatically."
          : error instanceof Error
            ? error.message
            : "Processing failed.",
      );
    } finally {
      clearTimeout(timeout);
      setBusy(false);
    }
  }

  const sizeMB = limits
    ? (limits.max_pdf_bytes / 1024 / 1024).toFixed(0)
    : null;
  return (
    <div className="study-grid">
      <div>
        <form onSubmit={submit} aria-busy={materialBusy}>
          <Card>
            <div className="section-heading">
              <div>
                <h2>
                  <span className="step-number">01</span> Add your study
                  material
                </h2>
                <p>Paste your notes, choose a text-based PDF, or add both.</p>
              </div>
              <Badge>Local processing</Badge>
            </div>
            <div className="demo-notes">
              <div><Badge>DEMO DATA</Badge><span>Try original sample notes about information retrieval.</span></div>
              <button type="button" className="primary" disabled={materialBusy}
                onClick={() => {
                  inputChanged();
                  setFile(null);
                  if (fileInput.current) fileInput.current.value = "";
                  setNotes(demoNotes);
                  setMessage("Demo notes loaded. This original sample contains no private lecture material. Select Process Material to build its real text index.");
                }}>Load sample notes</button>
            </div>
            <label htmlFor="notes">Lecture notes</label>
            <textarea
              id="notes"
              value={notes}
              disabled={materialBusy}
              onChange={(event) => {
                inputChanged();
                setNotes(event.target.value);
              }}
              placeholder={
                "Paste your lecture notes here…\n\nKey concepts, definitions, and examples are a great place to start."
              }
              rows={9}
              maxLength={limits?.max_notes_chars ?? 100000}
              aria-describedby="notes-help"
            />
            <div className="input-meta" id="notes-help">
              <span>Processed on your local backend when submitted</span>
              <span>{notes.length.toLocaleString()} characters</span>
            </div>
            <div className="divider">
              <span>OR ADD A PDF</span>
            </div>
            <div className="upload-box">
              <span className="upload-icon" aria-hidden="true">
                ↑
              </span>
              <label htmlFor="pdf">Choose your lecture PDF</label>
              <p>
                {limits
                  ? "PDF files up to " +
                    sizeMB +
                    " MB and " +
                    limits.max_pdf_pages +
                    " pages"
                  : "Limits will be validated by the backend"}
              </p>
              <input
                id="pdf"
                ref={fileInput}
                disabled={materialBusy}
                type="file"
                accept=".pdf,application/pdf"
                aria-describedby="pdf-help"
                onChange={(event) => {
                  inputChanged();
                  const selected = event.target.files?.[0];
                  if (!selected) {
                    setFile(null);
                    return;
                  }
                  if (
                    !selected.name.toLowerCase().endsWith(".pdf") ||
                    selected.size === 0 ||
                    (limits && selected.size > limits.max_pdf_bytes)
                  ) {
                    setError(
                      "Choose a non-empty PDF" +
                        (sizeMB ? " no larger than " + sizeMB + " MB." : "."),
                    );
                    setFile(null);
                    event.target.value = "";
                    return;
                  }
                  setFile(selected);
                }}
              />
              {file && (
                <div className="selected-file">
                  {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB{" "}
                  <button
                    type="button"
                    disabled={materialBusy}
                    onClick={() => {
                      inputChanged();
                      setFile(null);
                      if (fileInput.current) fileInput.current.value = "";
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
              <small id="pdf-help">
                Text-based PDFs only. Scanned PDFs require OCR, which this MVP
                does not support. Documents are not permanently saved.
              </small>
            </div>
            <div className="generate-row">
              <p>{practiceBusy ? "Wait for the current AI request before replacing or clearing material." : "Build a temporary text index on your local backend."}</p>
              <button className="primary" type="submit" disabled={materialBusy}>
                {busy ? "Processing…" : "Process Material"}{" "}
                <span aria-hidden="true">↑</span>
              </button>
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="form-message" role="status">
                {message}
              </p>
            )}
            {session && (
              <div className="processed-session">
                <span>
                  Expires at{" "}
                  {new Date(session.expires_at * 1000).toLocaleTimeString()}.{" "}
                  {session.skipped_pages.length > 0 &&
                    "No text on page(s): " +
                      session.skipped_pages.join(", ") +
                      ". Those pages were skipped; OCR is unavailable."}
                </span>
                <button
                  className="text-button"
                  type="button"
                  disabled={materialBusy}
                  onClick={clearSession}
                >
                  Clear session
                </button>
              </div>
            )}
          </Card>
        </form>
        <PracticePanel
          key={"practice:" + (session?.session_id ?? "no-session")}
          sessionId={session?.session_id ?? null}
          timeoutSeconds={limits?.llm_request_timeout_seconds}
          onBusyChange={setPracticeBusy}
          onPracticeUpdate={onPracticeUpdate}
        />
        {session && (
          <MaterialSearch
            key={"search:" + session.session_id}
            sessionId={session.session_id}
          />
        )}
      </div>
      <aside className="study-aside">
        <Card>
          <span className="tile-icon" aria-hidden="true">
            ✧
          </span>
          <h3>Good notes. Better practice.</h3>
          <p>Give your study index a useful starting point.</p>
          <ul>
            <li>Include a complete topic or lecture.</li>
            <li>Keep definitions and worked examples.</li>
            <li>Search using terms from your notes.</li>
          </ul>
        </Card>
      </aside>
    </div>
  );
}
