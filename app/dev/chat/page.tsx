import { DEV_PROMPTS } from "@/lib/dev/prompts";
import { ChatClient } from "@/app/chat/chat-client";
import { notFound } from "next/navigation";
import { Suspense } from "react";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function DevChatBoot({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  
  const customIdRaw = params.customId;
  const customId = Array.isArray(customIdRaw) ? customIdRaw[0] : customIdRaw;
  const customVersionRaw = params.customVersion;
  const customVersion = Array.isArray(customVersionRaw) ? customVersionRaw[0] : customVersionRaw;

  let promptInfo;

  if (customId) {
    promptInfo = {
      label: "Custom Prompt ID",
      promptId: customId,
      model: "Unknown (Custom)",
      description: `Testing custom Prompt ID: ${customId}\nVersion: ${customVersion || 'default'}`,
    };
  } else {
    const idStr = Array.isArray(params.id) ? params.id[0] : params.id;
    if (!idStr) return notFound();

    const idx = parseInt(idStr, 10);
    promptInfo = DEV_PROMPTS[idx];
  }

  if (!promptInfo || !promptInfo.promptId) {
    return notFound();
  }
  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* 2/3 Chat UI */}
      <div className="w-2/3 h-full border-r relative bg-background">
        <ChatClient
          invitationToken="dev-mode"
          sessionEndpoint="/api/dev/sessions"
          devPromptId={promptInfo.promptId}
          devPromptVersion={customId ? customVersion : undefined}
        />
      </div>

      {/* 1/3 Developer Panel */}
      <div className="w-1/3 h-full bg-muted/30 flex flex-col">
        <div className="p-4 border-b bg-background">
          <h2 className="font-semibold text-lg">Developer Reference</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Condition details for this session.
          </p>
        </div>
        
        <div className="flex-1 p-6 overflow-y-auto">
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Label</h3>
              <p className="font-medium">{promptInfo.label}</p>
            </div>
            
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Prompt ID</h3>
              <div className="flex gap-2">
                <p className="font-mono text-sm bg-muted p-2 rounded-md break-all flex-1">
                  {promptInfo.promptId}
                </p>
                {promptInfo.version && (
                  <p className="font-mono text-sm bg-muted p-2 rounded-md whitespace-nowrap">
                    v{promptInfo.version}
                  </p>
                )}
              </div>
            </div>
            
            {promptInfo.model && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Model</h3>
                <p className="font-mono text-sm bg-muted p-2 rounded-md inline-block">
                  {promptInfo.model}
                </p>
              </div>
            )}
            
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Prompt Description</h3>
              <div className="text-sm whitespace-pre-wrap bg-background p-4 rounded-md border shadow-sm prose prose-sm dark:prose-invert max-w-none">
                {promptInfo.description}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
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
