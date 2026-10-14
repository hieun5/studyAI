import { useCallback, useRef, useState } from "react";
import type { PracticeSet } from "../api";
import { recordPractice } from "./model";
import {
  clearStoredResults,
  loadResults,
  saveResults,
  validateAttempts,
  MAX_ATTEMPTS,
  type LoadedResults,
} from "./storage";

export default function useQuizResults() {
  const [state, setState] = useState<LoadedResults>(loadResults);
  const latest = useRef(state);
  const ignored = useRef(new Set<string>());
  const update = (next: LoadedResults) => {
    latest.current = next;
    setState(next);
  };
  const onPracticeUpdate = useCallback(
    (sessionId: string, practice: PracticeSet) => {
      try {
        const current = latest.current;
        const attempts = recordPractice(
          current.attempts,
          sessionId,
          practice,
          Date.now(),
          ignored.current,
        );
        if (attempts === current.attempts) return;
        if (current.writeBlocked) {
          update({
            ...current,
            attempts: validateAttempts(attempts.slice(-MAX_ATTEMPTS)),
          });
          return;
        }
        const saved = saveResults(attempts);
        update({
          attempts: saved.attempts,
          notice: saved.notice,
          writeBlocked: false,
        });
      } catch (error) {
        update({
          ...latest.current,
          notice:
            error instanceof Error
              ? error.message
              : "Could not record quiz results. Existing results were preserved.",
        });
      }
    },
    [],
  );
  const clearResults = useCallback(() => {
    if (!clearStoredResults()) {
      update({
        ...latest.current,
        notice:
          "Could not clear browser storage. Your displayed results were preserved; allow storage access and try again.",
      });
      return;
    }
    for (const attempt of latest.current.attempts)
      for (const question of attempt.questions)
        ignored.current.add(attempt.sessionId + "/" + question.questionId);
    update({
      attempts: [],
      notice:
        "Saved results cleared. Future submissions can be saved; cleared answers will not be added back during this visit.",
      writeBlocked: false,
    });
  }, []);
  return {
    attempts: state.attempts,
    notice: state.notice,
    clearResults,
    onPracticeUpdate,
  };
}
