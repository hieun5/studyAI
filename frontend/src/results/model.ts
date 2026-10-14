import type { Passage, PracticeSet, ReasoningFeedback } from "../api";

export interface CompletedQuestion {
  questionId: string;
  question: string;
  topic: string;
  options: string[];
  selectedIndex: number;
  correctIndex: number;
  selectedAnswer: string;
  correctAnswer: string;
  correct: boolean;
  studentExplanation: string;
  answerExplanation: string;
  answerSources: Passage[];
  feedback: ReasoningFeedback | null;
  feedbackStatus: "pending" | "available" | "unavailable";
  feedbackError: string | null;
  answeredAt: number;
}
export interface QuizAttempt {
  sessionId: string;
  model: string;
  requestedCount: 5 | 10;
  generatedCount: number;
  startedAt: number;
  updatedAt: number;
  questions: CompletedQuestion[];
}
export interface QuestionRecord {
  question: CompletedQuestion;
  sessionId: string;
  model: string;
  attemptUpdatedAt: number;
}
export interface FeedbackPattern {
  label: string;
  count: number;
}
export interface TopicPerformance {
  key: string;
  topic: string;
  answered: number;
  correct: number;
  incorrect: number;
  scorePercent: number;
  feedbackCount: number;
  patterns: FeedbackPattern[];
  records: QuestionRecord[];
}
export interface Recommendation {
  key: string;
  topic: string;
  reviewTopic: string;
  reason: string;
  incorrect: number;
  patterns: FeedbackPattern[];
  sessionIds: string[];
}

export function topicKey(topic: string): string {
  return topic
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}
const cleanTopic = (topic: string) => topic.trim().replace(/\s+/g, " ");
const accuracy = (correct: number, total: number) =>
  Math.round((correct / total) * 1000) / 10;

function recurringPatterns(records: QuestionRecord[]): FeedbackPattern[] {
  const counts = new Map<string, FeedbackPattern>();
  function add(key: string, label: string) {
    const current = counts.get(key);
    counts.set(key, {
      label: current?.label ?? label,
      count: (current?.count ?? 0) + 1,
    });
  }
  for (const { question } of records) {
    const feedback = question.feedback;
    if (!feedback) continue;
    const concern =
      feedback.reasoning_assessment !== "supported" ||
      feedback.possible_knowledge_gap !== null;
    if (feedback.reasoning_assessment !== "supported")
      add(
        "assessment:" + feedback.reasoning_assessment,
        "AI reasoning estimate: " +
          feedback.reasoning_assessment.replaceAll("_", " "),
      );
    if (feedback.possible_knowledge_gap)
      add(
        "gap:" + topicKey(feedback.possible_knowledge_gap),
        "Possible gap: " + feedback.possible_knowledge_gap,
      );
    if (concern)
      add(
        "review:" + topicKey(feedback.recommended_topic_to_review),
        "AI suggested review: " + feedback.recommended_topic_to_review,
      );
  }
  return [...counts.values()]
    .filter((pattern) => pattern.count >= 2)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function summarize(attempts: QuizAttempt[]) {
  const grouped = new Map<string, TopicPerformance>();
  let answered = 0;
  let correct = 0;
  for (const attempt of attempts) {
    for (const question of attempt.questions) {
      const key = topicKey(question.topic);
      const topic = grouped.get(key) ?? {
        key,
        topic: cleanTopic(question.topic),
        answered: 0,
        correct: 0,
        incorrect: 0,
        scorePercent: 0,
        feedbackCount: 0,
        patterns: [],
        records: [],
      };
      // Scores depend only on the answer indices, never on model judgments,
      // persisted percentages, or even a cached correct boolean.
      const isCorrect = question.selectedIndex === question.correctIndex;
      topic.answered++;
      topic.correct += Number(isCorrect);
      topic.incorrect += Number(!isCorrect);
      topic.feedbackCount += Number(question.feedback !== null);
      topic.records.push({
        question,
        sessionId: attempt.sessionId,
        model: attempt.model,
        attemptUpdatedAt: attempt.updatedAt,
      });
      grouped.set(key, topic);
      answered++;
      correct += Number(isCorrect);
    }
  }
  const topics = [...grouped.values()]
    .map((topic) => ({
      ...topic,
      scorePercent: accuracy(topic.correct, topic.answered),
      patterns: recurringPatterns(topic.records),
    }))
    .sort((a, b) => a.topic.localeCompare(b.topic));
  const recommendations: Recommendation[] = topics
    .filter((topic) => topic.incorrect > 0 || topic.patterns.length > 0)
    .map((topic) => {
      const candidates = new Map<string, { label: string; count: number }>();
      for (const { question } of topic.records) {
        const feedback = question.feedback;
        const wrong = question.selectedIndex !== question.correctIndex;
        const qualitativeConcern =
          feedback &&
          (feedback.reasoning_assessment !== "supported" ||
            feedback.possible_knowledge_gap !== null);
        if (feedback && (wrong || qualitativeConcern)) {
          const label = cleanTopic(feedback.recommended_topic_to_review);
          const key = topicKey(label);
          const current = candidates.get(key);
          candidates.set(key, {
            label: current?.label ?? label,
            count: (current?.count ?? 0) + 1,
          });
        }
      }
      const reviewTopic =
        [...candidates.values()].sort(
          (a, b) => b.count - a.count || a.label.localeCompare(b.label),
        )[0]?.label ?? topic.topic;
      return {
        key: topic.key,
        topic: topic.topic,
        reviewTopic,
        incorrect: topic.incorrect,
        patterns: topic.patterns,
        reason:
          topic.incorrect > 0
            ? topic.incorrect +
              " of " +
              topic.answered +
              " submitted answers did not match the generated key."
            : "Answers matched the key, but qualitative feedback concerns recur in at least two explanations. The numerical score is unchanged.",
        sessionIds: [
          ...new Set(
            [...topic.records]
              .sort((a, b) => b.attemptUpdatedAt - a.attemptUpdatedAt)
              .map((record) => record.sessionId),
          ),
        ].slice(0, 3),
      };
    })
    .sort(
      (a, b) => b.incorrect - a.incorrect || a.topic.localeCompare(b.topic),
    );
  return {
    answered,
    correct,
    scorePercent: answered ? accuracy(correct, answered) : null,
    completedAttempts: attempts.filter(
      (attempt) => attempt.questions.length === attempt.generatedCount,
    ).length,
    attemptsCount: attempts.length,
    topics,
    recommendations,
  };
}

export function cachedSummary(attempts: QuizAttempt[]) {
  const summary = summarize(attempts);
  return {
    answered: summary.answered,
    correct: summary.correct,
    scorePercent: summary.scorePercent,
    completedAttempts: summary.completedAttempts,
    attemptsCount: summary.attemptsCount,
    topics: summary.topics.map(
      ({ key, topic, answered, correct, incorrect, scorePercent }) => ({
        key,
        topic,
        answered,
        correct,
        incorrect,
        scorePercent,
      }),
    ),
  };
}

function sourceExcerpt(passage: Passage): Passage {
  return {
    chunk_id: passage.chunk_id,
    text: Array.from(passage.text).slice(0, 1500).join(""),
    source_type: passage.source_type,
    filename: passage.filename,
    page_number: passage.page_number,
    score: passage.score,
  };
}
function savedFeedback(
  feedback: ReasoningFeedback | null,
): ReasoningFeedback | null {
  if (!feedback) return null;
  return {
    reasoning_assessment: feedback.reasoning_assessment,
    explanation: feedback.explanation,
    possible_knowledge_gap: feedback.possible_knowledge_gap,
    recommended_topic_to_review: feedback.recommended_topic_to_review,
    source_passages_used: feedback.source_passages_used.map(sourceExcerpt),
    assessment_note: feedback.assessment_note,
  };
}

export function recordPractice(
  attempts: QuizAttempt[],
  sessionId: string,
  practice: PracticeSet,
  now = Date.now(),
  ignored = new Set<string>(),
): QuizAttempt[] {
  const previous = attempts.find((attempt) => attempt.sessionId === sessionId);
  const completed = new Map(
    previous?.questions.map((question) => [question.questionId, question]) ??
      [],
  );
  for (const item of practice.questions) {
    const submission = item.submission;
    if (!submission?.locked || ignored.has(sessionId + "/" + item.question_id))
      continue;
    const old = completed.get(item.question_id);
    if (
      old &&
      (old.selectedIndex !== submission.selected_index ||
        old.correctIndex !== submission.correct_index ||
        old.studentExplanation !== submission.student_explanation)
    )
      throw new Error(
        "The received result conflicts with a previously locked answer. Saved results were preserved.",
      );
    const incoming: CompletedQuestion = {
      questionId: item.question_id,
      question: item.question,
      topic: item.topic,
      options: [...item.options],
      selectedIndex: submission.selected_index,
      correctIndex: submission.correct_index,
      selectedAnswer: item.options[submission.selected_index],
      correctAnswer: item.options[submission.correct_index],
      correct: submission.selected_index === submission.correct_index,
      studentExplanation: submission.student_explanation,
      answerExplanation: submission.answer_explanation,
      answerSources: submission.answer_sources.map(sourceExcerpt),
      feedback: savedFeedback(submission.feedback),
      feedbackStatus: submission.feedback_status,
      feedbackError: submission.feedback_error,
      answeredAt: old?.answeredAt ?? now,
    };
    if (
      old?.feedbackStatus === "available" &&
      incoming.feedbackStatus !== "available"
    ) {
      incoming.feedback = old.feedback;
      incoming.feedbackStatus = old.feedbackStatus;
      incoming.feedbackError = old.feedbackError;
    }
    completed.set(item.question_id, incoming);
  }
  if (!completed.size) return attempts;
  const questions = [...completed.values()];
  if (
    previous &&
    JSON.stringify(previous.questions) === JSON.stringify(questions)
  )
    return attempts;
  const attempt: QuizAttempt = {
    sessionId,
    model: practice.model,
    requestedCount: practice.requested_count as 5 | 10,
    generatedCount: practice.returned_count,
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
    questions,
  };
  return [
    ...attempts.filter((item) => item.sessionId !== sessionId),
    attempt,
  ].sort((a, b) => a.updatedAt - b.updatedAt);
}
