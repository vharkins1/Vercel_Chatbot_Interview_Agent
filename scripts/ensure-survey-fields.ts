/**
 * Idempotently declare the embedded-data fields the app pushes to Qualtrics, so
 * the values actually persist on response rows (Qualtrics silently drops
 * embedded data that isn't declared in the Survey Flow).
 *
 *   pnpm db:ensure-survey-fields
 *
 * Surgical + safe: it locates the existing EmbeddedData flow element (the one
 * already declaring `completion_code`) and adds only the missing fields to it,
 * cloning the exact shape of the working `completion_code` entry. It does NOT
 * touch any Block/Standard flow elements, never reorders the flow, and is a
 * no-op if the fields are already present. Run once per survey (or after the
 * survey is rebuilt). Requires QUALTRICS_* env in .env.local.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const DC = process.env.QUALTRICS_DATACENTER;
const TOK = process.env.QUALTRICS_API_TOKEN;
const SID = process.env.QUALTRICS_SURVEY_ID_STUDY1;

// Fields the app sends (see survey + participant complete routes). completion_code
// is already declared; the other two are what this script ensures.
const REQUIRED_FIELDS = ["completion_code", "participant_seq", "chat_id"];

type EmbeddedField = {
  Description: string;
  Type: string;
  Field: string;
  VariableType: string;
  DataVisibility: unknown;
  AnalyzeText: boolean;
};
type FlowElement = {
  Type: string;
  FlowID: string;
  EmbeddedData?: EmbeddedField[];
};

async function qx<T>(
  method: "GET" | "PUT",
  path: string,
  body?: unknown
): Promise<{ status: number; json: T }> {
  const res = await fetch(`https://${DC}.qualtrics.com${path}`, {
    method,
    headers: {
      "X-API-TOKEN": TOK ?? "",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return {
    status: res.status,
    json: (text ? JSON.parse(text) : {}) as T,
  };
}

async function main() {
  if (!(DC && TOK && SID)) {
    throw new Error(
      "QUALTRICS_DATACENTER, QUALTRICS_API_TOKEN, QUALTRICS_SURVEY_ID_STUDY1 required"
    );
  }

  const got = await qx<{ result: { Flow: FlowElement[] } }>(
    "GET",
    `/API/v3/survey-definitions/${SID}/flow`
  );
  if (got.status !== 200) {
    throw new Error(
      `GET flow failed: ${got.status} ${JSON.stringify(got.json)}`
    );
  }

  const ed = got.json.result.Flow.find((f) => f.Type === "EmbeddedData");
  if (!ed) {
    throw new Error(
      "No EmbeddedData element found in the survey flow. Add one in Qualtrics (Survey Flow > Add Embedded Data) declaring completion_code, then re-run."
    );
  }

  const existing = new Set((ed.EmbeddedData ?? []).map((f) => f.Field));
  console.log(
    `EmbeddedData element ${ed.FlowID} currently declares: ${[...existing].join(", ") || "(none)"}`
  );

  // Clone the shape of an existing entry (e.g. completion_code) so the new
  // fields match exactly what Qualtrics already accepts via response import.
  const template = (ed.EmbeddedData ?? [])[0];
  const missing = REQUIRED_FIELDS.filter((f) => !existing.has(f));
  if (missing.length === 0) {
    console.log("✓ All required fields already declared — nothing to do.");
    return;
  }
  if (!template) {
    throw new Error(
      "EmbeddedData element has no existing entry to clone a shape from. Declare completion_code manually first."
    );
  }

  const additions: EmbeddedField[] = missing.map((field) => ({
    Description: field,
    Type: template.Type,
    Field: field,
    VariableType: template.VariableType,
    DataVisibility: template.DataVisibility,
    AnalyzeText: template.AnalyzeText,
  }));
  const updatedElement: FlowElement = {
    ...ed,
    EmbeddedData: [...(ed.EmbeddedData ?? []), ...additions],
  };

  console.log(`Adding missing fields: ${missing.join(", ")}`);
  const put = await qx<{ meta?: { httpStatus?: string } }>(
    "PUT",
    `/API/v3/survey-definitions/${SID}/flow/${ed.FlowID}`,
    updatedElement
  );
  if (put.status !== 200) {
    throw new Error(
      `PUT flow element failed: ${put.status} ${JSON.stringify(put.json)}`
    );
  }

  // Verify it stuck.
  const verify = await qx<{ result: { Flow: FlowElement[] } }>(
    "GET",
    `/API/v3/survey-definitions/${SID}/flow`
  );
  const edAfter = verify.json.result.Flow.find((f) => f.FlowID === ed.FlowID);
  const now = new Set((edAfter?.EmbeddedData ?? []).map((f) => f.Field));
  const stillMissing = REQUIRED_FIELDS.filter((f) => !now.has(f));
  if (stillMissing.length > 0) {
    throw new Error(`After update, still missing: ${stillMissing.join(", ")}`);
  }
  console.log(
    `✓ Declared. Element ${ed.FlowID} now has: ${[...now].join(", ")}`
  );
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
