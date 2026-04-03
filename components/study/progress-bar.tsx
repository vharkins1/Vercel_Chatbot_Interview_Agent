"use client";

import { QUESTIONS_PER_TOPIC, TOPICS, TOTAL_TOPICS } from "@/lib/study/protocol.config";

export function StudyProgressBar({
  phase,
  topicIndex,
  questionIndex,
}: {
  phase: string;
  topicIndex: number;
  questionIndex: number;
}) {
  const totalQuestions = TOTAL_TOPICS * QUESTIONS_PER_TOPIC;
  const answeredQuestions = topicIndex * QUESTIONS_PER_TOPIC + questionIndex;
  const progress = phase === "complete"
    ? 100
    : Math.round((answeredQuestions / totalQuestions) * 100);

  return (
    <div className="w-full px-4 py-2 border-b border-border/30">
      <div className="mx-auto flex max-w-4xl items-center gap-3">
        <div className="flex-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted shadow-inner border border-border/20">
            <div
              className="h-full rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.2)] transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground/70 tabular-nums">
          {phase === "complete"
            ? "Complete"
            : phase === "feedback"
              ? `Feedback · Topic ${topicIndex + 1}/${TOTAL_TOPICS}`
              : `${TOPICS[topicIndex]?.name ?? ""} · Q${questionIndex + 1}/${QUESTIONS_PER_TOPIC}`}
        </span>
      </div>
    </div>
  );
}
