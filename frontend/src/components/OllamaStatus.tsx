import type { OllamaHealth } from "../api";

export default function OllamaStatus({
  health,
  error,
  checking,
  onCheck,
}: {
  health: OllamaHealth | null;
  error: string;
  checking: boolean;
  onCheck: () => void;
}) {
  return (
    <div className={health?.available ? "llm-status ready" : "llm-status"}>
      <div role={(health && !health.available) || error ? "alert" : "status"}>
        <strong>
          {checking
            ? "Checking local Ollama…"
            : health?.available
              ? "Ollama ready · " + health.model
              : "Local AI is not ready"}
        </strong>
        <p>
          {error ||
            health?.message ||
            "Checking the service and configured model."}
        </p>
        {!checking && !health?.available && (
          <p>
            Start the local service with <code>ollama serve</code>.{" "}
            {health ? (
              <>
                Install the configured model with{" "}
                <code>ollama pull {health.model}</code>.
              </>
            ) : (
              <>Start FastAPI first to check your configured model.</>
            )}
          </p>
        )}
      </div>
      <button
        type="button"
        className="text-button"
        disabled={checking}
        onClick={onCheck}
      >
        Check Ollama again
      </button>
    </div>
  );
}
