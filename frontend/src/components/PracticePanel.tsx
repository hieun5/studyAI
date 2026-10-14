import { useEffect, useRef, useState } from "react";
import {
  api,
  type OllamaHealth,
  type PracticeSet,
  type Submission,
} from "../api";
import { Badge, Card } from "./ui";
import OllamaStatus from "./OllamaStatus";
import QuestionCard from "./QuestionCard";

export default function PracticePanel({
  sessionId,
  timeoutSeconds = 390,
  onPracticeUpdate,
  onBusyChange,
}: {
  sessionId: string | null;
  timeoutSeconds?: number;
  onPracticeUpdate?: (sessionId: string, practice: PracticeSet) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [count, setCount] = useState<5 | 10>(5);
  const [health, setHealth] = useState<OllamaHealth | null>(null);
  const [healthError, setHealthError] = useState("");
  const [checking, setChecking] = useState(true);
  const [practice, setPractice] = useState<PracticeSet | null>(null);
  const [position, setPosition] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const healthController = useRef<AbortController | null>(null);

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  function publish(
    value:
      | PracticeSet
      | null
      | ((current: PracticeSet | null) => PracticeSet | null),
  ) {
    const next = typeof value === "function" ? value(practice) : value;
    setPractice(next);
    if (next && sessionId) onPracticeUpdate?.(sessionId, next);
  }

  async function checkHealth() {
    healthController.current?.abort();
    const request = new AbortController();
    healthController.current = request;
    setChecking(true);
    setHealthError("");
    const timeout = setTimeout(() => request.abort(), 8000);
    try {
      const result = await api<OllamaHealth>("/health/ollama", { signal: request.signal });
      if (healthController.current === request && !request.signal.aborted) setHealth(result);
    } catch (error) {
      if (healthController.current === request) {
        setHealth(null);
        setHealthError(
          request.signal.aborted
            ? "The backend or Ollama health check timed out. Start the local services and check again."
            : error instanceof Error
              ? error.message
              : "Could not check Ollama.",
        );
      }
    } finally {
      clearTimeout(timeout);
      if (healthController.current === request) setChecking(false);
    }
  }
  useEffect(() => {
    void checkHealth();
    return () => {
      controller.current?.abort();
      healthController.current?.abort();
    };
  }, []);

  async function perform<T>(
    path: string,
    body?: object,
    method = "POST",
  ): Promise<T> {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const timeout = setTimeout(() => request.abort(), timeoutSeconds * 1000);
    try {
      return await api<T>(path, {
        method,
        signal: request.signal,
        ...(body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
    } catch (error) {
      if (request.signal.aborted)
        throw new Error(
          "The local AI request timed out. The backend may still be finishing it; recover the current practice before trying again.",
        );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  async function generate() {
    if (!sessionId || busy) return;
    setBusy(true);
    setError("");
    try {
      publish(
        await perform<PracticeSet>("/sessions/" + sessionId + "/questions", {
          count,
        }),
      );
      setPosition(0);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Question generation failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    if (!sessionId || busy) return;
    setBusy(true);
    setError("");
    try {
      const snapshot = await perform<PracticeSet>(
        "/sessions/" + sessionId + "/practice",
        undefined,
        "GET",
      );
      publish(snapshot);
      if (!practice) {
        const next = snapshot.questions.findIndex(
          (question) => !question.submission,
        );
        setPosition(next < 0 ? snapshot.questions.length - 1 : next);
      }
      setUncertain(false);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not recover practice.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(choice: number, reasoning: string) {
    if (!sessionId || !practice || busy) return;
    setBusy(true);
    setUncertain(true);
    setError("");
    const question = practice.questions[position];
    try {
      const result = await perform<Submission>(
        "/sessions/" +
          sessionId +
          "/questions/" +
          question.question_id +
          "/submit",
        { selected_index: choice, explanation: reasoning },
      );
      publish((current) =>
        current
          ? {
              ...current,
              questions: current.questions.map((item) =>
                item.question_id === question.question_id
                  ? { ...item, submission: result }
                  : item,
              ),
            }
          : null,
      );
      setUncertain(false);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not confirm submission. Recover your practice before continuing.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function retryFeedback() {
    if (!sessionId || !practice || busy) return;
    setBusy(true);
    setError("");
    const question = practice.questions[position];
    try {
      const result = await perform<Submission>(
        "/sessions/" +
          sessionId +
          "/questions/" +
          question.question_id +
          "/feedback",
      );
      publish((current) =>
        current
          ? {
              ...current,
              questions: current.questions.map((item) =>
                item.question_id === question.question_id
                  ? { ...item, submission: result }
                  : item,
              ),
            }
          : null,
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Feedback retry failed. Your answer remains locked.",
      );
    } finally {
      setBusy(false);
    }
  }
  const answered =
    practice?.questions.filter((question) => question.submission).length ?? 0;
  return (
    <Card className="session-card practice-panel">
      <div className="section-heading">
        <div>
          <h2>
            <span className="step-number">02</span> Practice your understanding
          </h2>
          <p>
            Questions and explanation feedback powered by your local Ollama
            model.
          </p>
        </div>
        <Badge>Local AI</Badge>
      </div>
      <OllamaStatus
        health={health}
        error={healthError}
        checking={checking}
        onCheck={() => void checkHealth()}
      />
      {!practice && (
        <>
          <fieldset disabled={busy}>
            <legend>Number of questions</legend>
            <div className="question-options">
              {([5, 10] as const).map((value) => (
                <label
                  key={value}
                  className={count === value ? "selected" : ""}
                >
                  <input
                    type="radio"
                    name="question-count"
                    checked={count === value}
                    onChange={() => setCount(value)}
                  />
                  <strong>{value} questions</strong>
                  <span>
                    {value === 5
                      ? "A focused quick check"
                      : "A deeper practice session"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="generate-row">
            <p>
              {sessionId
                ? "Generate questions from retrieved source passages."
                : "Process your notes or PDF first."}
              <br />
              Generation may take a few minutes on a local model.
            </p>
            <button
              type="button"
              className="primary"
              disabled={!sessionId || !health?.available || busy || checking}
              onClick={generate}
            >
              {busy ? "Generating…" : "Generate Questions"} ✧
            </button>
          </div>
        </>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
          {sessionId && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={recover}
            >
              Recover current practice
            </button>
          )}
        </div>
      )}
      {practice?.notice && (
        <p className="form-message" role="status">
          {practice.notice}
        </p>
      )}
      {practice && (
        <>
          <p className="practice-progress">
            {answered} of {practice.returned_count} submitted · Model:{" "}
            {practice.model}
          </p>
          <QuestionCard
            key={practice.questions[position].question_id}
            question={practice.questions[position]}
            position={position}
            total={practice.questions.length}
            busy={busy}
            uncertain={uncertain}
            onSubmit={(choice, reasoning) => void submit(choice, reasoning)}
            onRetry={() => void retryFeedback()}
            onRecover={() => void recover()}
            onNext={() => {
              setPosition(position + 1);
              setError("");
              setUncertain(false);
            }}
          />
          {answered === practice.returned_count && (
            <p className="practice-summary">
              {
                practice.questions.filter(
                  (question) => question.submission?.correct,
                ).length
              }{" "}
              / {practice.returned_count} answers matched the generated key.
              Reasoning assessments remain separate estimates.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
