import OpenAI from "openai";

let client: OpenAI | null = null;

/**
 * Lazily instantiate the OpenAI client. Creating it at module load makes the
 * Next.js build crash while collecting page data, because the SDK throws when
 * no API key is present in the build environment. Deferring construction until
 * the first runtime call keeps the build green and only requires the key where
 * it is actually used.
 */
export function getOpenAIClient(): OpenAI {
  if (client) {
    return client;
  }

  const apiKey = process.env.STUDY_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Missing OpenAI credentials. Set STUDY_OPENAI_API_KEY in the environment."
    );
  }

  client = new OpenAI({ apiKey });
  return client;
}
