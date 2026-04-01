"use client";

import { useState } from "react";

/**
 * Placeholder survey scales — swap with validated instruments later.
 */
const SCALES = [
  {
    id: "closeness",
    label: "Perceived Closeness",
    items: [
      { id: "close_1", text: "I felt close to the interviewer." },
      { id: "close_2", text: "The interviewer understood me." },
      { id: "close_3", text: "I could be open with the interviewer." },
    ],
  },
  {
    id: "competence",
    label: "AI Competence",
    items: [
      { id: "comp_1", text: "The interviewer seemed competent." },
      { id: "comp_2", text: "The interviewer conducted the interview well." },
    ],
  },
  {
    id: "comfort",
    label: "Self-Disclosure Comfort",
    items: [
      { id: "comf_1", text: "I felt comfortable sharing personal information." },
      { id: "comf_2", text: "I disclosed more than I normally would." },
    ],
  },
];

const POINTS = [1, 2, 3, 4, 5, 6, 7] as const;

export function SurveyForm({
  onSubmit,
}: {
  onSubmit: (data: Record<string, number>) => void;
}) {
  const [responses, setResponses] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const allItemIds = SCALES.flatMap((s) => s.items.map((i) => i.id));
  const isComplete = allItemIds.every((id) => responses[id] !== undefined);

  const handleSubmit = () => {
    if (!isComplete) return;
    setSubmitted(true);
    onSubmit(responses);
  };

  if (submitted) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-4 py-12 text-center">
        <div className="text-3xl">✓</div>
        <h2 className="text-xl font-semibold text-foreground">Thank you!</h2>
        <p className="text-sm text-muted-foreground">
          Your responses have been recorded. You may now close this window.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">
          Post-Interview Survey
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Please rate your agreement with each statement (1 = Strongly Disagree,
          7 = Strongly Agree).
        </p>
      </div>

      {SCALES.map((scale) => (
        <div key={scale.id} className="mb-8">
          <h3 className="mb-3 text-sm font-medium text-foreground/80">
            {scale.label}
          </h3>
          <div className="space-y-4">
            {scale.items.map((item) => (
              <div
                key={item.id}
                className="rounded-lg border border-border/40 bg-card/50 p-4"
              >
                <p className="mb-3 text-sm text-foreground">{item.text}</p>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] text-muted-foreground/60">
                    Strongly disagree
                  </span>
                  <div className="flex gap-2">
                    {POINTS.map((point) => (
                      <button
                        key={point}
                        type="button"
                        onClick={() =>
                          setResponses((r) => ({ ...r, [item.id]: point }))
                        }
                        className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs transition-all ${
                          responses[item.id] === point
                            ? "border-foreground bg-foreground text-background"
                            : "border-border/50 text-muted-foreground hover:border-foreground/30"
                        }`}
                      >
                        {point}
                      </button>
                    ))}
                  </div>
                  <span className="text-[10px] text-muted-foreground/60">
                    Strongly agree
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!isComplete}
        className={`w-full rounded-lg px-4 py-3 text-sm font-medium transition-all ${
          isComplete
            ? "bg-foreground text-background hover:opacity-90"
            : "cursor-not-allowed bg-muted text-muted-foreground"
        }`}
      >
        Submit Survey
      </button>
    </div>
  );
}
