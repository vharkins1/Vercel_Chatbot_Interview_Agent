# How to Edit the Interview Prompts

This folder contains all the text the AI uses during interviews.
Edit any file here with a plain text editor — no coding needed.

## Files

### Questions & Topics

| File | What it controls |
|------|-----------------|
| `topics.json` | The interview topics (name + intro sentence) |
| `questions.json` | All interview questions, grouped by topic |

### Questioning Templates (per condition)

These control how the AI presents each question. Each condition has its own tone:

| File | Tone |
|------|------|
| `questioning-positive.txt` | Warm, encouraging transitions between questions |
| `questioning-negative.txt` | Cold, matter-of-fact transitions |
| `questioning-neutral.txt` | Flat, clinical transitions |

### Topic Transition Templates (per condition)

These control how the AI transitions between topics:

| File | Tone |
|------|------|
| `topic-transition-positive.txt` | Warm, enthusiastic topic transitions |
| `topic-transition-negative.txt` | Businesslike, no praise |
| `topic-transition-neutral.txt` | Clinical, neutral transitions |

### Feedback Templates (per condition)

These control what the AI says after completing each topic:

| File | Tone |
|------|------|
| `feedback-positive.txt` | Warm, empathetic, references specific answers |
| `feedback-negative.txt` | Dismissive, critical, minimizes what was shared |
| `feedback-neutral.txt` | Flat, clinical, no specifics referenced |

### Other Templates

| File | What it controls |
|------|-----------------|
| `consent-message.txt` | The consent text shown to participants |
| `consent-instructions.txt` | How the AI presents the consent message |
| `completion.txt` | What the AI says when the interview is done |
| `summarization.txt` | How the AI summarizes each topic (optional feature) |
| `reask.txt` | What the AI says when a participant didn't answer (restating the question) |
| `move-on.txt` | How the AI advances to the next question after exhausted re-asks |
| `answer-judge.txt` | The judge LLM's rubric (system prompt) for deciding whether a response counts as an answer |
| `answer-judge-user.txt` | The user-message format sent to the judge (fills in `{questionText}` and `{response}`) |

## Placeholders

Some files use `{placeholders}` that get filled in automatically:

| Placeholder | Filled with |
|-------------|------------|
| `{topicName}` | Current topic name (e.g. "Tastes & Interests") |
| `{questionText}` | The current question text |
| `{topicIntro}` | The topic's intro sentence |
| `{answer1}` | Participant's answer to question 1 |
| `{answer2}` | Participant's answer to question 2 |
| `{answer3}` | Participant's answer to question 3 |
| `{q1Text}` | Text of question 1 |
| `{q2Text}` | Text of question 2 |
| `{q3Text}` | Text of question 3 |
| `{previousSummary}` | Summary of previous topics |
| `{consentText}` | The consent message text |
| `{exchangeText}` | Full exchange text (for summarization) |
| `{response}` | The participant's most recent response (for `answer-judge-user.txt`) |

**Do NOT remove or rename the `{placeholders}`** — just edit the text around them.

## Re-ask Behavior

After each participant message in the questioning phase, a lightweight "judge" LLM decides whether the response actually engaged with the question. If it didn't, the state machine stays on the same question and the AI re-asks.

Two files control this:

- **`answer-judge.txt`** — the judge's rubric. Loosen it to accept more answers, tighten it to require more depth. This is where you control *when* a re-ask fires.
- **`reask.txt`** — what the AI says when re-asking. This controls the *wording* of the re-ask.
- **`move-on.txt`** — used when the re-ask limit is reached (only if `MAX_REATTEMPTS` is enforced in `protocol.config.ts`; currently re-asks loop indefinitely).

The judge runs on `STUDY_MODEL` (defaults to `gpt-4o-mini`). It's called in `app/(chat)/api/chat/route.ts` and pulls its system prompt from `answer-judge.txt`.

## Adding or Removing Questions

Edit `questions.json`. Each question needs:

- `"topic"` — Must match a topic name from `topics.json` exactly
- `"intimacy"` — `"low"`, `"moderate"`, or `"high"`
- `"text"` — The question text

If you change the number of questions per topic, also update `QUESTIONS_PER_TOPIC` in `protocol.config.ts` (it's just a number).

## Tone Consistency

The condition (positive/negative/neutral) selected before the interview controls the AI's tone throughout the **entire** session — not just the feedback. The questioning templates, topic transitions, and feedback all match the selected condition.
