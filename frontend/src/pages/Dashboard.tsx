import { lazy, Suspense, useMemo } from "react";
import { Badge, Card } from "../components/ui";
import ReviewPassages from "../components/ReviewPassages";
import AttemptFeedback from "../components/AttemptFeedback";
import { summarize, type QuizAttempt } from "../results/model";

const TopicChart = lazy(() => import("../components/TopicChart"));

export default function Dashboard({
  attempts,
  notice,
  onClear,
  onStart,
  activeSessionId,
}: {
  attempts: QuizAttempt[];
  notice: string;
  onClear: () => void;
  onStart: () => void;
  activeSessionId: string | null;
}) {
  const summary = useMemo(() => summarize(attempts), [attempts]);
  return (
    <div className="knowledge-dashboard">
      <div className="dashboard-toolbar">
        <div>
          <h2>Knowledge Gap Dashboard</h2>
          <p>
            Topic insights are estimates based on quiz performance and
            qualitative feedback, not a diagnosis of understanding.
          </p>
        </div>
        <button
          type="button"
          className="text-button clear-results"
          disabled={!attempts.length && !notice}
          onClick={onClear}
        >
          Clear saved results
        </button>
      </div>
      {notice && (
        <p className="form-message storage-notice" role="status">
          {notice}
        </p>
      )}
      {!summary.answered ? (
        <Card className="empty-state dashboard-empty">
          <span className="empty-icon" aria-hidden="true">
            ◎
          </span>
          <Badge>YOUR NEXT CHAPTER</Badge>
          <h2>Your learning story starts with a question.</h2>
          <p>
            No submitted quiz results yet. Process your notes, generate a
            practice set, and explain an answer to build your dashboard.
          </p>
          <button type="button" className="primary" onClick={onStart}>
            Start Studying ↗
          </button>
          <small>
            Results save on this browser. PDF files and full lecture notes are
            never saved here.
          </small>
        </Card>
      ) : (
        <>
          <div className="stats-grid dashboard-stats">
            <Card>
              <span className="eyebrow">OVERALL QUIZ SCORE</span>
              <strong className="stat-value">{summary.scorePercent}%</strong>
              <p>
                {summary.correct} / {summary.answered} answers matched the
                generated key.
              </p>
            </Card>
            <Card>
              <span className="eyebrow">TOTAL QUESTIONS ANSWERED</span>
              <strong className="stat-value">{summary.answered}</strong>
              <p>
                Every submitted question counts once, including partial quizzes.
              </p>
            </Card>
            <Card>
              <span className="eyebrow">COMPLETED QUIZ ATTEMPTS</span>
              <strong className="stat-value">
                {summary.completedAttempts}
              </strong>
              <p>
                {summary.attemptsCount} saved attempt(s) with submitted answers.
              </p>
            </Card>
          </div>
          <Card>
            <div className="section-heading">
              <div>
                <h2>Topic performance</h2>
                <p>
                  Measured answer accuracy across the saved questions for each
                  topic.
                </p>
              </div>
              <Badge>Answer scores only</Badge>
            </div>
            <Suspense
              fallback={
                <p className="chart-loading" role="status">
                  Loading topic chart…
                </p>
              }
            >
              <TopicChart topics={summary.topics} />
            </Suspense>
            <div className="table-scroll">
              <table className="topic-table">
                <caption>
                  Exact topic counts used to calculate the chart
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Topic</th>
                    <th scope="col">Answered</th>
                    <th scope="col">Correct</th>
                    <th scope="col">Incorrect</th>
                    <th scope="col">Quiz accuracy</th>
                    <th scope="col">AI feedback available</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.topics.map((topic) => (
                    <tr key={topic.key}>
                      <th scope="row">{topic.topic}</th>
                      <td>{topic.answered}</td>
                      <td>{topic.correct}</td>
                      <td>{topic.incorrect}</td>
                      <td>{topic.scorePercent}%</td>
                      <td>
                        {topic.feedbackCount} / {topic.answered}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="dashboard-insights">
            <Card>
              <div className="section-heading">
                <div>
                  <h2>Potential knowledge gaps</h2>
                  <p>
                    Review signals from incorrect answers or repeated feedback
                    concerns.
                  </p>
                </div>
                <Badge>Estimates</Badge>
              </div>
              {summary.recommendations.length ? (
                summary.recommendations.map((recommendation) => (
                  <article className="gap-item" key={recommendation.key}>
                    <h3>{recommendation.topic}</h3>
                    <p>{recommendation.reason}</p>
                    {recommendation.patterns.length > 0 && (
                      <ul>
                        {recommendation.patterns.slice(0, 3).map((pattern) => (
                          <li key={pattern.label}>
                            {pattern.label}{" "}
                            <span>({pattern.count} questions)</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))
              ) : (
                <p className="insight-empty">
                  No review signals from incorrect answers or recurring feedback
                  patterns in these saved results. This does not establish
                  mastery.
                </p>
              )}
              <p className="insight-method">
                Rule: at least one incorrect answer, or the same qualitative
                concern in at least two submitted questions within a topic.
                Numerical scores are never reduced by AI assessments.
              </p>
            </Card>
            <Card>
              <div className="section-heading">
                <div>
                  <h2>Recommended topics to review</h2>
                  <p>
                    Start with topics linked to incorrect answers, then revisit
                    recurring reasoning suggestions.
                  </p>
                </div>
              </div>
              {summary.recommendations.length ? (
                summary.recommendations.map((recommendation) => (
                  <article
                    className="recommendation-item"
                    key={recommendation.key}
                  >
                    <h3>{recommendation.reviewTopic}</h3>
                    <p>
                      From {recommendation.topic}: {recommendation.reason}
                    </p>
                    <ReviewPassages
                      recommendation={recommendation}
                      activeSessionId={activeSessionId}
                    />
                  </article>
                ))
              ) : (
                <p className="insight-empty">
                  No targeted review topic to recommend yet. Keep practicing
                  with a broader set of notes.
                </p>
              )}
            </Card>
          </div>
          <Card className="feedback-history">
            <div className="section-heading">
              <div>
                <h2>Question feedback history</h2>
                <p>
                  Expand any submitted question to review your answer,
                  reasoning, and available AI feedback.
                </p>
              </div>
              <Badge>Qualitative feedback</Badge>
            </div>
            <AttemptFeedback attempts={attempts} />
          </Card>
          <p className="dashboard-footnote">
            Quiz accuracy describes agreement with generated answer keys across
            saved questions. It is not a confidence estimate or a complete
            measure of knowledge. Topic names are grouped by case and
            whitespace; different names are not merged automatically.
          </p>
        </>
      )}
    </div>
  );
}
