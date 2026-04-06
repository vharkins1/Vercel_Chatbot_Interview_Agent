"use client";

import { EXTERNAL_SURVEY_URL } from "@/lib/study/protocol.config";

export function SurveyForm() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 px-4 py-12 text-center">
      <h2 className="text-xl font-semibold text-foreground">
        Interview Complete
      </h2>
      <p className="text-sm text-muted-foreground">
        Thank you for participating. Please complete the survey below to finish
        the study.
      </p>
      {EXTERNAL_SURVEY_URL && (
        <a
          href={EXTERNAL_SURVEY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 rounded-lg bg-foreground px-6 py-3 text-sm font-medium text-background transition-all hover:opacity-90 active:scale-[0.98]"
        >
          Take Survey
        </a>
      )}
    </div>
  );
}
