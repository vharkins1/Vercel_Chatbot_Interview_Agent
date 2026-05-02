export { TOPICS } from "./protocol.config";

export const FEEDBACK_STYLES = ["positive", "negative", "neutral"] as const;
export type FeedbackStyle = (typeof FEEDBACK_STYLES)[number];
