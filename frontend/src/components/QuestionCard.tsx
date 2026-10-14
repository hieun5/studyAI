import { useState, type FormEvent } from "react";
import type { Passage, PracticeQuestion } from "../api";
import { Badge } from "./ui";

function Sources({ passages }: { passages: Passage[] }) {
  return (
    <>
      {passages.map((passage) => (
        <article className="passage" key={passage.chunk_id}>
          <div className="passage-heading">
            <strong>
              {passage.filename || "Pasted lecture notes"}
              {passage.page_number ? " · Page " + passage.page_number : ""}
            </strong>
            <span>{passage.chunk_id}</span>
          </div>
          <p>{passage.text}</p>
        </article>
      ))}
    </>
  );
}

export default function QuestionCard({
  question,
  position,
  total,
  busy,
  uncertain,
  onSubmit,
  onRetry,
  onRecover,
  onNext,
}: {
  question: PracticeQuestion;
  position: number;
  total: number;
  busy: boolean;
  uncertain: boolean;
  onSubmit: (choice: number, reasoning: string) => void;
  onRetry: () => void;
  onRecover: () => void;
  onNext: () => void;
}) {
  const [choice, setChoice] = useState<number | null>(null);
  const [reasoning, setReasoning] = useState("");
  const result = question.submission;
  const locked = Boolean(result) || uncertain || busy;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!locked && choice !== null && reasoning.trim().length >= 10)
      onSubmit(choice, reasoning.trim());
  }
  return (
    <div className="question-card">
      <div className="question-heading">
        <span>
          QUESTION {position + 1} OF {total}
        </span>
        <Badge>{question.topic}</Badge>
      </div>
      <h3>{question.question}</h3>
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={locked}>
          <legend>Choose one answer</legend>
          <div className="answer-options">
            {question.options.map((option, index) => (
              <label
                key={index}
                className={
                  (result?.selected_index ?? choice) === index ? "selected" : ""
                }
              >
                <input
                  type="radio"
                  name={question.question_id}
                  value={index}
                  checked={(result?.selected_index ?? choice) === index}
                  onChange={() => setChoice(index)}
                  required
                />
                <span className="answer-letter">
                  {String.fromCharCode(65 + index)}
                </span>
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor="reasoning">Explain your reasoning</label>
        <textarea
          id="reasoning"
          value={result?.student_explanation ?? reasoning}
          onChange={(event) => setReasoning(event.target.value)}
          disabled={locked}
          required
          minLength={10}
          maxLength={2000}
          rows={4}
          aria-describedby="reasoning-help"
          placeholder="Why does your chosen answer make sense? Connect it to a concept in your notes."
        />
        <p className="reasoning-help" id="reasoning-help">
          At least 10 characters. Your answer and explanation lock on
          submission.
        </p>
        {!result && (
          <div className="generate-row">
            <span className="muted-label">
              Correct answer hidden until submission
            </span>
            <button
              type="submit"
              className="primary"
              disabled={
                locked || choice === null || reasoning.trim().length < 10
              }
            >
              {busy ? "Scoring and evaluating…" : "Submit answer"}
            </button>
          </div>
        )}
      </form>
      {uncertain && !result && (
        <div className="form-message" role="status">
          The submission outcome is uncertain. Keep your answer unchanged until
          the backend confirms it.
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={onRecover}
          >
            Recover submitted answer
          </button>
        </div>
      )}
      {result && (
        <div className="answer-review">
          <section
            className={
              "mc-result " + (result.correct ? "correct" : "incorrect")
            }
            aria-label="Multiple-choice result"
          >
            <h4>
              Multiple-choice result: {result.correct ? "Correct" : "Incorrect"}
            </h4>
            <p>
              Correct option: {String.fromCharCode(65 + result.correct_index)} ·{" "}
              {question.options[result.correct_index]}
            </p>
            <p>{result.answer_explanation}</p>
            <small>
              Scored against the generated answer key. Submitted answer locked.
            </small>
            <details>
              <summary>Review answer-key sources</summary>
              <Sources passages={result.answer_sources} />
            </details>
          </section>
          <section className="ai-feedback" aria-label="AI reasoning feedback">
            <h4>AI reasoning feedback · estimate</h4>
            {result.feedback ? (
              <>
                <Badge>
                  {result.feedback.reasoning_assessment.replaceAll("_", " ")}
                </Badge>
                <p>{result.feedback.explanation}</p>
                <dl>
                  <dt>Possible knowledge gap</dt>
                  <dd>
                    {result.feedback.possible_knowledge_gap ||
                      "No specific gap identified in this estimate."}
                  </dd>
                  <dt>Recommended topic to review</dt>
                  <dd>{result.feedback.recommended_topic_to_review}</dd>
                </dl>
                <p className="estimate-note">
                  {result.feedback.assessment_note} This assessment is separate
                  from multiple-choice scoring.
                </p>
                <details>
                  <summary>Source passages used for feedback</summary>
                  <Sources passages={result.feedback.source_passages_used} />
                </details>
              </>
            ) : (
              <>
                <p role="status">
                  {result.feedback_status === "pending"
                    ? "Feedback is still processing. Your answer is already scored and locked."
                    : result.feedback_error}
                </p>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={
                    result.feedback_status === "pending" ? onRecover : onRetry
                  }
                >
                  {result.feedback_status === "pending"
                    ? "Refresh feedback status"
                    : "Retry AI feedback"}
                </button>
              </>
            )}
          </section>
          <div className="generate-row">
            <span className="muted-label">
              Your submitted answer cannot be changed.
            </span>
            {position < total - 1 ? (
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={onNext}
              >
                Next question →
              </button>
            ) : (
              <strong className="completion-note" role="status">
                Practice complete.
              </strong>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
