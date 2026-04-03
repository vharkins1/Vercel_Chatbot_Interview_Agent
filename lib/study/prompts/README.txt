HOW TO EDIT THE INTERVIEW PROMPTS
==================================

This folder contains all the text the AI uses during interviews.
You can edit any file here with a plain text editor — no coding needed.

FILES
-----

  topics.json           - The interview topics (name + intro sentence)
  questions.json        - All interview questions, grouped by topic
  feedback-positive.txt - What the AI says after a topic (warm/supportive)
  feedback-negative.txt - What the AI says after a topic (dismissive/critical)
  feedback-neutral.txt  - What the AI says after a topic (flat/clinical)
  questioning.txt       - How the AI presents each question
  topic-transition.txt  - How the AI transitions between topics
  consent-message.txt   - The consent text shown to participants
  consent-instructions.txt - How the AI presents the consent message
  completion.txt        - What the AI says when the interview is done
  summarization.txt     - How the AI summarizes each topic (optional feature)

PLACEHOLDERS
------------
Some files use {placeholders} that get filled in automatically:

  {topicName}       - Current topic name (e.g. "Tastes & Interests")
  {questionText}    - The current question text
  {topicIntro}      - The topic's intro sentence
  {answer1}         - Participant's answer to question 1
  {answer2}         - Participant's answer to question 2
  {answer3}         - Participant's answer to question 3
  {q1Text}          - Text of question 1
  {q2Text}          - Text of question 2
  {q3Text}          - Text of question 3
  {previousSummary} - Summary of previous topics
  {consentText}     - The consent message text
  {exchangeText}    - Full exchange text (for summarization)

Do NOT remove or rename the {placeholders} — just edit the text around them.

ADDING/REMOVING QUESTIONS
--------------------------
Edit questions.json. Each question needs:
  - "topic"    : Must match a topic name from topics.json exactly
  - "intimacy" : "low", "moderate", or "high"
  - "text"     : The question text

If you change the number of questions per topic, also update the
QUESTIONS_PER_TOPIC setting in protocol.config.ts (it's just a number).
