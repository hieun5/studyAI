export const feedback = (
  assessment = "supported",
  gap = null,
  review = "Cellular respiration",
) => ({
  reasoning_assessment: assessment,
  explanation: "The reasoning connects ATP with the supplied notes.",
  possible_knowledge_gap: gap,
  recommended_topic_to_review: review,
  source_passages_used: [],
  assessment_note:
    "AI reasoning feedback is an estimate, not a definitive measure of knowledge.",
});
export function submission(selected = 0, correct = 0, ai = feedback()) {
  return {
    locked: true,
    selected_index: selected,
    correct_index: correct,
    correct: selected === correct,
    student_explanation:
      "ATP stores energy for cells according to the lecture notes.",
    answer_explanation: "ATP stores cellular energy.",
    answer_sources: [],
    feedback: ai,
    feedback_status: ai ? "available" : "unavailable",
    feedback_error: ai ? null : "Local AI feedback unavailable.",
  };
}
export function question(
  id = "q1",
  topic = "Cellular energy",
  selected = 0,
  ai = feedback(),
) {
  return {
    question_id: id,
    question: "Which molecule stores cellular energy?",
    options: ["ATP", "Soil", "Light", "Frequency"],
    topic,
    submission: submission(selected, 0, ai),
  };
}
export function practice(questions = [question()]) {
  return {
    questions,
    requested_count: 5,
    returned_count: questions.length,
    notice: null,
    model: "mock-model:latest",
  };
}
export class MemoryStorage {
  values = new Map();
  limit = Infinity;
  blocked = false;
  getItem(key) {
    if (this.blocked) throw new Error("Storage blocked");
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    if (this.blocked) throw new Error("Storage blocked");
    if (value.length > this.limit) throw { name: "QuotaExceededError" };
    this.values.set(key, value);
  }
  removeItem(key) {
    if (this.blocked) throw new Error("Storage blocked");
    this.values.delete(key);
  }
}
