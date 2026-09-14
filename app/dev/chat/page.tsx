import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DevChatShell } from "@/app/dev/chat/dev-chat-shell";
import { DEV_PROMPTS, type DevPromptInfo } from "@/lib/dev/prompts";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function DevChatBoot({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  const customIdRaw = params.customId;
  const customId = Array.isArray(customIdRaw) ? customIdRaw[0] : customIdRaw;
  const customVersionRaw = params.customVersion;
  const customVersion = Array.isArray(customVersionRaw)
    ? customVersionRaw[0]
    : customVersionRaw;

  let promptInfo: DevPromptInfo;

  if (customId) {
    promptInfo = {
      label: "Custom Prompt ID",
      promptId: customId,
      model: "Unknown (Custom)",
      description: `Testing custom Prompt ID: ${customId}\nVersion: ${customVersion || "default"}`,
    };
  } else {
    const idStr = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!idStr) {
      return notFound();
    }

    const idx = Number.parseInt(idStr, 10);
    promptInfo = DEV_PROMPTS[idx];
  }

  if (!promptInfo || !promptInfo.promptId) {
    return notFound();
  }
  return (
    <DevChatShell
      devPromptVersion={customId ? customVersion : undefined}
      promptInfo={promptInfo}
    />
  );
}

export default function DevChatPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <DevChatBoot searchParams={searchParams} />
    </Suspense>
  );
}
