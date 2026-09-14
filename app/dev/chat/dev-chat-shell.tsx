"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { ChatClient } from "@/app/chat/chat-client";
import { Button } from "@/components/ui/button";
import type { DevPromptInfo } from "@/lib/dev/prompts";

type DevChatShellProps = {
  promptInfo: DevPromptInfo;
  devPromptVersion?: string;
};

export function DevChatShell({
  promptInfo,
  devPromptVersion,
}: DevChatShellProps) {
  const [chatId, setChatId] = useState<string | null>(null);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {/* 2/3 Chat UI */}
      <div className="w-2/3 h-full border-r relative bg-background">
        <ChatClient
          devPromptId={promptInfo.promptId ?? undefined}
          devPromptVersion={devPromptVersion}
          invitationToken="dev-mode"
          onSessionStarted={setChatId}
          sessionEndpoint="/api/dev/sessions"
        />
      </div>

      {/* 1/3 Developer Panel */}
      <div className="w-1/3 h-full bg-muted/30 flex flex-col">
        <div className="p-4 border-b bg-background">
          <h2 className="font-semibold text-lg">Developer Reference</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Condition details for this session.
          </p>
          {chatId ? (
            <Button asChild className="mt-4 w-full" variant="outline">
              <a
                download
                href={`/api/dev/sessions/${encodeURIComponent(chatId)}/export`}
              >
                <Download data-icon="inline-start" />
                Export text transcript
              </a>
            </Button>
          ) : (
            <Button
              className="mt-4 w-full"
              disabled
              title="Start the interview to enable text export"
              variant="outline"
            >
              <Download data-icon="inline-start" />
              Export text transcript (start interview first)
            </Button>
          )}
        </div>

        <div className="flex-1 p-6 overflow-y-auto">
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Label
              </h3>
              <p className="font-medium">{promptInfo.label}</p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Prompt ID
              </h3>
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
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Model
                </h3>
                <p className="font-mono text-sm bg-muted p-2 rounded-md inline-block">
                  {promptInfo.model}
                </p>
              </div>
            )}

            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Prompt Description
              </h3>
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
