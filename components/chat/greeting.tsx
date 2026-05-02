"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { type FeedbackStyle } from "@/lib/study/protocol";

export function Greeting({
  isStudyMode,
  onStartStudy,
}: {
  isStudyMode?: boolean;
  onStartStudy?: (feedbackStyle: FeedbackStyle) => void;
}) {
  const [feedbackStyle, setFeedbackStyle] = useState<FeedbackStyle>("positive");

  if (!isStudyMode) {
    return (
      <div className="flex flex-col items-center px-4" key="overview">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="text-center font-semibold text-2xl tracking-tight text-foreground md:text-3xl"
          initial={{ opacity: 0, y: 10 }}
          transition={{ delay: 0.35, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          What can I help with?
        </motion.div>
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 text-center text-muted-foreground/80 text-sm"
          initial={{ opacity: 0, y: 10 }}
          transition={{ delay: 0.5, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          Ask a question, write code, or explore ideas.
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-4" key="study-welcome">
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="text-center font-semibold text-2xl tracking-tight text-foreground md:text-3xl"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.35, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        Self-Disclosure Interview
      </motion.div>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="mt-3 max-w-md text-center text-muted-foreground/80 text-sm leading-relaxed"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.5, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        You&apos;ll be asked a series of questions across three topics. Take your
        time with each response.
      </motion.div>

      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="mt-6 flex flex-col items-center gap-4"
        initial={{ opacity: 0, y: 10 }}
        transition={{ delay: 0.65, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/50 px-3 py-2">
          <label className="text-xs text-muted-foreground" htmlFor="feedback-style-select">
            Feedback style:
          </label>
          <select
            id="feedback-style-select"
            className="bg-transparent text-xs text-foreground outline-none"
            value={feedbackStyle}
            onChange={(e) => setFeedbackStyle(e.target.value as FeedbackStyle)}
          >
            <option value="positive">Positive</option>
            <option value="negative">Negative</option>
            <option value="neutral">Neutral</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => onStartStudy?.(feedbackStyle)}
          className="rounded-lg bg-foreground px-6 py-2.5 text-sm font-medium text-background transition-all hover:opacity-90 active:scale-[0.98]"
        >
          Begin Interview
        </button>
      </motion.div>
    </div>
  );
}
