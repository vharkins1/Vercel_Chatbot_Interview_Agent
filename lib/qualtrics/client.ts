import "server-only";

// Thin wrapper over the Qualtrics REST API. Reads QUALTRICS_API_TOKEN and
// QUALTRICS_DATACENTER from env; any caller-facing route that depends on this
// should treat `qualtrics_not_configured` as a 503, mirroring the APP_PEPPER
// gate on the agent API.

export type QualtricsNotConfigured = { ok: false; reason: "not_configured" };
export type QualtricsHttpError = {
  ok: false;
  reason: "http_error";
  status: number;
  body: string;
};
export type QualtricsResult<T> =
  | { ok: true; value: T }
  | QualtricsNotConfigured
  | QualtricsHttpError;

function getEnv(): { token: string; datacenter: string } | null {
  const token = process.env.QUALTRICS_API_TOKEN;
  const datacenter = process.env.QUALTRICS_DATACENTER;
  if (!token || !datacenter) {
    return null;
  }
  return { token, datacenter };
}

async function request<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown
): Promise<QualtricsResult<T>> {
  const env = getEnv();
  if (!env) {
    return { ok: false, reason: "not_configured" };
  }

  const res = await fetch(`https://${env.datacenter}.qualtrics.com${path}`, {
    method,
    headers: {
      "X-API-TOKEN": env.token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    return {
      ok: false,
      reason: "http_error",
      status: res.status,
      body: text,
    };
  }
  const json = (await res.json()) as { result: T };
  return { ok: true, value: json.result };
}

// ── Survey definition types ─────────────────────────────────────
// Shapes are intentionally permissive; the adapter is the source of truth for
// what we trust. Anything not modeled here passes through as `unknown`.

export type QualtricsChoice = { Display: string };
export type QualtricsAnswer = { Display: string }; // scale point label, e.g. "Strongly agree"

export type QualtricsQuestion = {
  QuestionID?: string;
  QuestionType: "TE" | "MC" | "Matrix" | "Slider" | "DB" | string;
  Selector?: string;
  SubSelector?: string;
  QuestionText?: string;
  Choices?: Record<string, QualtricsChoice>;
  ChoiceOrder?: Array<string | number>;
  Answers?: Record<string, QualtricsAnswer>;
  AnswerOrder?: Array<string | number>;
  Configuration?: {
    CSSliderMin?: number;
    CSSliderMax?: number;
    GridLines?: number;
    NumDecimals?: number;
  };
};

export type QualtricsBlockElement =
  | { Type: "Question"; QuestionID: string }
  | { Type: "Page Break" }
  | { Type: string; [k: string]: unknown };

export type QualtricsBlock = {
  Description?: string;
  BlockElements: QualtricsBlockElement[];
};

export type QualtricsFlowElement = {
  Type: string;
  ID?: string;
  FlowID?: string;
  Flow?: QualtricsFlowElement[];
};

export type QualtricsSurveyDefinition = {
  SurveyID: string;
  SurveyName: string;
  Blocks: Record<string, QualtricsBlock>;
  SurveyFlow: { Flow: QualtricsFlowElement[] };
  Questions: Record<string, QualtricsQuestion>;
};

export type QualtricsResponseSubmission = {
  responseId: string;
};

// A single response row read back from Qualtrics. `values` holds both the
// declared embedded data (completion_code, chat_id, participant_seq, …) and
// the question answers, keyed by Qualtrics field name.
export type QualtricsResponse = {
  values: Record<string, unknown>;
};

export async function getSurveyDefinition(
  surveyId: string
): Promise<QualtricsResult<QualtricsSurveyDefinition>> {
  return await request<QualtricsSurveyDefinition>(
    "GET",
    `/API/v3/survey-definitions/${surveyId}`
  );
}

export async function submitResponse(
  surveyId: string,
  values: Record<string, string | number>
): Promise<QualtricsResult<QualtricsResponseSubmission>> {
  return await request<QualtricsResponseSubmission>(
    "POST",
    `/API/v3/surveys/${surveyId}/responses`,
    { values }
  );
}

export async function getResponse(
  surveyId: string,
  responseId: string
): Promise<QualtricsResult<QualtricsResponse>> {
  return await request<QualtricsResponse>(
    "GET",
    `/API/v3/surveys/${surveyId}/responses/${responseId}`
  );
}
