import OpenAI from "openai";

export const openaiClient = new OpenAI({
  apiKey: process.env.STUDY_OPENAI_API_KEY,
});
