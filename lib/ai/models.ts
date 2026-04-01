export const DEFAULT_CHAT_MODEL = "gpt-4.1-nano";

export const titleModel = {
  id: "mistral/mistral-small",
  name: "Mistral Small",
  provider: "mistral",
  description: "Fast model for title generation",
  gatewayOrder: ["mistral"],
};

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
};

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  gatewayOrder?: string[];
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
};

export const chatModels: ChatModel[] = [
  {
    id: "gpt-4.1-nano",
    name: "GPT-4.1 Nano",
    provider: "openai",
    description: "Fast and affordable",
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "openai",
    description: "Fast and affordable",
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    description: "Most capable model",
  },
];

export async function getCapabilities(): Promise<
  Record<string, ModelCapabilities>
> {
  return {
    "gpt-4.1-nano": { tools: true, vision: false, reasoning: false },
    "gpt-4o-mini": { tools: true, vision: true, reasoning: false },
    "gpt-4o": { tools: true, vision: true, reasoning: false },
  };
}

export const isDemo = process.env.IS_DEMO === "1";

export function getActiveModels(): ChatModel[] {
  return chatModels;
}

export const allowedModelIds = new Set(chatModels.map((m) => m.id));

export const modelsByProvider = chatModels.reduce(
  (acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  },
  {} as Record<string, ChatModel[]>
);
