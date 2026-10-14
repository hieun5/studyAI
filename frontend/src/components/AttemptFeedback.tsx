import type { QuizAttempt } from "../results/model";

export default function AttemptFeedback({
  attempts,
}: {
  attempts: QuizAttempt[];
}) {
  return (
    <div className="attempt-list">
      {[...attempts].reverse().map((attempt) => (
        <section key={attempt.sessionId} className="attempt-group">
          <div className="attempt-heading">
            <h3>
              {attempt.questions.length === attempt.generatedCount
                ? "Completed quiz"
                : "Quiz in progress"}{" "}
              · {attempt.questions.length}/{attempt.generatedCount} answered
            </h3>
            <small>
              {new Date(attempt.updatedAt).toLocaleString()} · {attempt.model}
            </small>
          </div>
          {attempt.questions.map((question) => (
            <details className="question-feedback" key={question.questionId}>
              <summary>
                <span>
                  {question.topic} · {question.question}
                </span>
                <span
                  className={
                    question.selectedIndex === question.correctIndex
                      ? "result-tag correct"
                      : "result-tag incorrect"
                  }
                >
                  {question.selectedIndex === question.correctIndex
                    ? "Correct"
                    : "Incorrect"}
                </span>
              </summary>
              <div className="question-feedback-body">
                <dl>
                  <dt>Your selected answer</dt>
                  <dd>{question.selectedAnswer}</dd>
                  <dt>Correct answer in the generated key</dt>
                  <dd>{question.correctAnswer}</dd>
                  <dt>Your written explanation</dt>
                  <dd className="preserve-text">
                    {question.studentExplanation}
                  </dd>
                  <dt>Answer-key explanation</dt>
                  <dd>{question.answerExplanation}</dd>
                </dl>
                {question.feedback ? (
                  <section className="saved-ai-feedback">
                    <h4>AI reasoning feedback · qualitative estimate</h4>
                    <dl>
                      <dt>Reasoning assessment</dt>
                      <dd>
                        {question.feedback.reasoning_assessment.replaceAll(
                          "_",
                          " ",
                        )}
                      </dd>
                      <dt>AI explanation</dt>
                      <dd>{question.feedback.explanation}</dd>
                      <dt>Suggested knowledge gap</dt>
                      <dd>
                        {question.feedback.possible_knowledge_gap ??
                          "No specific gap suggested by this estimate."}
                      </dd>
                      <dt>Recommended review topic</dt>
                      <dd>{question.feedback.recommended_topic_to_review}</dd>
                    </dl>
                    <p className="estimate-note">
                      {question.feedback.assessment_note} This does not change
                      the quiz score.
                    </p>
                    {question.feedback.source_passages_used.length > 0 && (
                      <details>
                        <summary>Saved feedback source excerpts</summary>
                        {question.feedback.source_passages_used.map(
                          (passage) => (
                            <article className="passage" key={passage.chunk_id}>
                              <strong>
                                {passage.filename || "Pasted lecture notes"}
                                {passage.page_number
                                  ? " · Page " + passage.page_number
                                  : ""}
                              </strong>
                              <p>{passage.text}</p>
                            </article>
                          ),
                        )}
                      </details>
                    )}
                  </section>
                ) : (
                  <p className="form-message">
                    {question.feedbackStatus === "pending"
                      ? "Feedback was pending when this result was saved. Recover the live practice session to check it while its index remains available."
                      : "AI feedback is unavailable. " +
                        (question.feedbackError ?? "")}{" "}
                    Your numerical score is still based only on the selected
                    answer.
                  </p>
                )}
              </div>
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}
