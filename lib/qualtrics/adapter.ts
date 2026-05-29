import type {
  QualtricsBlock,
  QualtricsFlowElement,
  QualtricsQuestion,
  QualtricsSurveyDefinition,
} from "./client";

// Strips Qualtrics' rich-text wrappers so prompts are plain text for the agent.
function stripHtml(s: string | undefined): string {
  if (!s) {
    return "";
  }
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+\n/g, "\n")
    .trim();
}

// ── Agent-facing page shape ─────────────────────────────────────

export type AgentChoice = { value: string; label: string };
export type AgentRow = { answerKey: string; label: string };
export type AgentScalePoint = { value: string; label: string };

export type AgentQuestion =
  | {
      qid: string;
      type: "text";
      prompt: string;
      answerKey: string; // e.g. "QID1_TEXT"
    }
  | {
      qid: string;
      type: "choice";
      prompt: string;
      answerKey: string; // e.g. "QID18"
      choices: AgentChoice[];
    }
  | {
      qid: string;
      type: "matrix_likert";
      prompt: string;
      rows: AgentRow[]; // each row.answerKey is what the agent POSTs
      scale: AgentScalePoint[];
    }
  | {
      qid: string;
      type: "slider";
      prompt: string;
      rows: AgentRow[];
      min: number;
      max: number;
    };

export type AgentPage = {
  index: number;
  questions: AgentQuestion[];
};

// ── Page extraction ─────────────────────────────────────────────

// Walk SurveyFlow → take only Standard/Block-typed flow entries (in order) →
// resolve to block IDs. Blocks not in the flow (e.g. "Trash / Unused
// Questions") are silently dropped.
function flowBlockIds(definition: QualtricsSurveyDefinition): string[] {
  const ids: string[] = [];
  const walk = (flow: QualtricsFlowElement[]) => {
    for (const el of flow) {
      if ((el.Type === "Block" || el.Type === "Standard") && el.ID) {
        ids.push(el.ID);
      }
      if (el.Flow) {
        walk(el.Flow);
      }
    }
  };
  walk(definition.SurveyFlow.Flow);
  return ids;
}

// Split a block's element list into ordered groups (one group per page) on
// "Page Break" boundaries. Returns the QIDs that live on each page.
function blockPages(block: QualtricsBlock): string[][] {
  const pages: string[][] = [[]];
  for (const el of block.BlockElements) {
    if (el.Type === "Page Break") {
      pages.push([]);
      continue;
    }
    if (
      el.Type === "Question" &&
      typeof (el as { QuestionID?: string }).QuestionID === "string"
    ) {
      // pages always has at least one entry; never undefined here.
      const current = pages[pages.length - 1];
      current.push((el as { QuestionID: string }).QuestionID);
    }
  }
  return pages.filter((p) => p.length > 0);
}

// Convert a single Qualtrics Question to our AgentQuestion. Returns null for
// display-only (DB) questions and for question types we don't yet support, so
// callers can drop them from the page payload.
function toAgentQuestion(
  qid: string,
  q: QualtricsQuestion
): AgentQuestion | null {
  const prompt = stripHtml(q.QuestionText);

  if (q.QuestionType === "DB") {
    return null;
  }

  if (q.QuestionType === "TE") {
    return { qid, type: "text", prompt, answerKey: `${qid}_TEXT` };
  }

  if (q.QuestionType === "MC") {
    const order = (q.ChoiceOrder ?? Object.keys(q.Choices ?? {})).map(String);
    const choices: AgentChoice[] = order
      .map((id) => {
        const c = q.Choices?.[id];
        if (!c) {
          return null;
        }
        return { value: id, label: stripHtml(c.Display) };
      })
      .filter((x): x is AgentChoice => x !== null);
    return { qid, type: "choice", prompt, answerKey: qid, choices };
  }

  if (q.QuestionType === "Matrix" && q.SubSelector === "SingleAnswer") {
    const rowOrder = (q.ChoiceOrder ?? Object.keys(q.Choices ?? {})).map(
      String
    );
    const rows: AgentRow[] = rowOrder
      .map((rowId) => {
        const c = q.Choices?.[rowId];
        if (!c) {
          return null;
        }
        return { answerKey: `${qid}_${rowId}`, label: stripHtml(c.Display) };
      })
      .filter((x): x is AgentRow => x !== null);
    const scaleOrder = (q.AnswerOrder ?? Object.keys(q.Answers ?? {})).map(
      String
    );
    const scale: AgentScalePoint[] = scaleOrder
      .map((id) => {
        const a = q.Answers?.[id];
        if (!a) {
          return null;
        }
        return { value: id, label: stripHtml(a.Display) };
      })
      .filter((x): x is AgentScalePoint => x !== null);
    return { qid, type: "matrix_likert", prompt, rows, scale };
  }

  if (q.QuestionType === "Slider") {
    const rowOrder = (q.ChoiceOrder ?? Object.keys(q.Choices ?? {})).map(
      String
    );
    const rows: AgentRow[] = rowOrder.length
      ? rowOrder
          .map((rowId) => {
            const c = q.Choices?.[rowId];
            if (!c) {
              return null;
            }
            return {
              answerKey: `${qid}_${rowId}`,
              label: stripHtml(c.Display),
            };
          })
          .filter((x): x is AgentRow => x !== null)
      : [{ answerKey: `${qid}_1`, label: prompt }];
    const min = q.Configuration?.CSSliderMin ?? 0;
    const max = q.Configuration?.CSSliderMax ?? 100;
    return { qid, type: "slider", prompt, rows, min, max };
  }

  return null;
}

export function parsePages(definition: QualtricsSurveyDefinition): AgentPage[] {
  const result: AgentPage[] = [];
  let pageIndex = 0;

  for (const blockId of flowBlockIds(definition)) {
    const block = definition.Blocks[blockId];
    if (!block) {
      continue;
    }
    for (const pageQids of blockPages(block)) {
      const questions = pageQids
        .map((qid) => {
          const q = definition.Questions[qid];
          if (!q) {
            return null;
          }
          return toAgentQuestion(qid, q);
        })
        .filter((x): x is AgentQuestion => x !== null);
      if (questions.length === 0) {
        continue; // skip display-only pages
      }
      pageIndex += 1;
      result.push({ index: pageIndex, questions });
    }
  }

  return result;
}

// ── Answer validation ───────────────────────────────────────────

// All answer keys the agent is allowed to submit for a given page. Anything
// outside this set is rejected at POST time.
export function expectedAnswerKeys(page: AgentPage): string[] {
  const keys: string[] = [];
  for (const q of page.questions) {
    if (q.type === "text") {
      keys.push(q.answerKey);
    } else if (q.type === "choice") {
      keys.push(q.answerKey);
    } else if (q.type === "matrix_likert" || q.type === "slider") {
      for (const r of q.rows) {
        keys.push(r.answerKey);
      }
    }
  }
  return keys;
}

// Validate raw answers against the page spec. Returns the canonicalized string
// values to persist as SurveyAnswer rows, or an error describing what's wrong.
export type ValidatedAnswers = Map<string, string>;

export function validatePageAnswers(
  page: AgentPage,
  answers: Record<string, unknown>
): { ok: true; values: ValidatedAnswers } | { ok: false; error: string } {
  const expected = new Set(expectedAnswerKeys(page));
  const supplied = new Set(Object.keys(answers));

  for (const k of supplied) {
    if (!expected.has(k)) {
      return { ok: false, error: `unknown_answer_key:${k}` };
    }
  }
  const missing = [...expected].filter((k) => !supplied.has(k));
  if (missing.length > 0) {
    return { ok: false, error: `missing_answer_keys:${missing.join(",")}` };
  }

  const out: ValidatedAnswers = new Map();
  for (const q of page.questions) {
    if (q.type === "text") {
      const v = answers[q.answerKey];
      if (typeof v !== "string") {
        return { ok: false, error: `${q.answerKey}:not_a_string` };
      }
      out.set(q.answerKey, v);
    } else if (q.type === "choice") {
      const v = String(answers[q.answerKey]);
      const allowed = new Set(q.choices.map((c) => c.value));
      if (!allowed.has(v)) {
        return { ok: false, error: `${q.answerKey}:invalid_choice:${v}` };
      }
      out.set(q.answerKey, v);
    } else if (q.type === "matrix_likert") {
      const allowed = new Set(q.scale.map((s) => s.value));
      for (const r of q.rows) {
        const v = String(answers[r.answerKey]);
        if (!allowed.has(v)) {
          return { ok: false, error: `${r.answerKey}:invalid_scale:${v}` };
        }
        out.set(r.answerKey, v);
      }
    } else if (q.type === "slider") {
      for (const r of q.rows) {
        const raw = answers[r.answerKey];
        const n =
          typeof raw === "number"
            ? raw
            : typeof raw === "string"
              ? Number(raw)
              : Number.NaN;
        if (!Number.isFinite(n) || n < q.min || n > q.max) {
          return { ok: false, error: `${r.answerKey}:out_of_range` };
        }
        out.set(r.answerKey, String(n));
      }
    }
  }
  return { ok: true, values: out };
}

// ── Qualtrics submission payload ────────────────────────────────

// Convert our (qid, value) rows into the QID-keyed `values` map Qualtrics
// expects on POST /surveys/{id}/responses. SurveyAnswer rows already use the
// Qualtrics answer-key form (e.g. "QID1_TEXT", "QID3_1"), so values pass
// through; we only coerce numeric strings back to numbers for matrix/slider.
export function buildQualtricsValues(
  rows: Array<{ qid: string; value: string }>,
  pages: AgentPage[],
  embeddedData: Record<string, string>
): Record<string, string | number> {
  // Build a lookup of answerKey → expected type so we can coerce correctly.
  // Qualtrics' Response Import API rejects MC choices, matrix scale points,
  // and slider values that arrive as strings even if they parse as numbers
  // ("Value '1' for property 'QID8' must be a number"). Only TE keys stay
  // as strings.
  const numericKeys = new Set<string>();
  for (const page of pages) {
    for (const q of page.questions) {
      if (q.type === "choice") {
        numericKeys.add(q.answerKey);
      } else if (q.type === "matrix_likert" || q.type === "slider") {
        for (const r of q.rows) {
          numericKeys.add(r.answerKey);
        }
      }
    }
  }

  const values: Record<string, string | number> = {};
  for (const row of rows) {
    if (numericKeys.has(row.qid)) {
      const n = Number(row.value);
      values[row.qid] = Number.isFinite(n) ? n : row.value;
    } else {
      values[row.qid] = row.value;
    }
  }
  Object.assign(values, embeddedData);
  return values;
}
