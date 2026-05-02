"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useActiveChat } from "@/hooks/use-active-chat";
import {
  initialArtifactData,
  useArtifact,
  useArtifactSelector,
} from "@/hooks/use-artifact";
import type { Attachment, ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { FeedbackStyle } from "@/lib/study/protocol";
import { Artifact } from "./artifact";
import { DataStreamHandler } from "./data-stream-handler";
import { submitEditedMessage } from "./message-editor";
import { Messages } from "./messages";
import { MultimodalInput } from "./multimodal-input";

export function ChatShell() {
  const {
    chatId,
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    addToolApprovalResponse,
    input,
    setInput,
    visibilityType,
    isReadonly,
    isLoading,
    votes,
    currentModelId,
    setCurrentModelId,
    showCreditCardAlert,
    setShowCreditCardAlert,
  } = useActiveChat();

  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(
    null,
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const { setArtifact } = useArtifact();

  // ── Study State ────────────────────────────────────────────
  const [isStudyMode] = useState(true);

  const handleStartStudy = useCallback(
    async (feedbackStyle: FeedbackStyle) => {
      window.history.pushState(
        {},
        "",
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`,
      );

      sendMessage({
        role: "user" as const,
        parts: [{ type: "text" as const, text: "I'm ready to begin the interview." }],
      }, {
        body: {
          studyFeedbackStyle: feedbackStyle,
        },
      });
    },
    [chatId, sendMessage],
  );

  const handleReset = useCallback(() => {
    setMessages([]);
    window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;
  }, [setMessages]);

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const prevChatIdRef = useRef(chatId);
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      stopRef.current();
      setArtifact(initialArtifactData);
      setEditingMessage(null);
      setAttachments([]);
    }
  }, [chatId, setArtifact]);

  return (
    <>
      <div className="flex h-dvh w-full flex-col overflow-hidden">
        {isStudyMode && (
          <div className="w-full border-b border-red-900/30 bg-red-950/40 px-4 py-2.5 text-sm">
            <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="font-semibold tracking-wider uppercase text-xs text-red-200">
                  Demo
                </span>
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="rounded px-2 py-1 text-xs font-medium text-red-300/70 hover:bg-red-900/50 hover:text-red-200 transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-1 min-h-0 flex-row overflow-hidden">
          <div
            className={cn(
              "flex min-w-0 flex-col bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
              isArtifactVisible && !isStudyMode ? "w-[40%]" : "w-full",
            )}
          >
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
              <Messages
                addToolApprovalResponse={addToolApprovalResponse}
                chatId={chatId}
                isArtifactVisible={isArtifactVisible && !isStudyMode}
                isLoading={isLoading}
                isReadonly={isReadonly}
                isStudyMode={isStudyMode}
                messages={messages}
                onEditMessage={(msg) => {
                  if (isStudyMode) return;
                  const text = msg.parts
                    ?.filter((p) => p.type === "text")
                    .map((p) => p.text)
                    .join("");
                  setInput(text ?? "");
                  setEditingMessage(msg);
                }}
                onStartStudy={handleStartStudy}
                regenerate={regenerate}
                selectedModelId={currentModelId}
                setMessages={setMessages}
                status={status}
                votes={votes}
              />

              {isStudyMode && messages.length === 0 ? null : (
                <div className="sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
                  {!isReadonly && (
                    <MultimodalInput
                      attachments={attachments}
                      chatId={chatId}
                      editingMessage={editingMessage}
                      input={input}
                      isLoading={isLoading}
                      messages={messages}
                      onCancelEdit={() => {
                        setEditingMessage(null);
                        setInput("");
                      }}
                      onModelChange={setCurrentModelId}
                      selectedModelId={currentModelId}
                      sendMessage={
                        editingMessage
                          ? async () => {
                              const msg = editingMessage;
                              setEditingMessage(null);
                              await submitEditedMessage({
                                message: msg,
                                text: input,
                                setMessages,
                                regenerate,
                              });
                              setInput("");
                            }
                          : sendMessage
                      }
                      setAttachments={setAttachments}
                      setInput={setInput}
                      setMessages={setMessages}
                      status={status}
                      stop={stop}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          {!isStudyMode && (
            <Artifact
              addToolApprovalResponse={addToolApprovalResponse}
              attachments={attachments}
              chatId={chatId}
              input={input}
              isReadonly={isReadonly}
              messages={messages}
              regenerate={regenerate}
              selectedModelId={currentModelId}
              selectedVisibilityType={visibilityType}
              sendMessage={sendMessage}
              setAttachments={setAttachments}
              setInput={setInput}
              setMessages={setMessages}
              status={status}
              stop={stop}
              votes={votes}
            />
          )}
        </div>
      </div>

      <DataStreamHandler />

      <AlertDialog
        onOpenChange={setShowCreditCardAlert}
        open={showCreditCardAlert}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate AI Gateway</AlertDialogTitle>
            <AlertDialogDescription>
              This application requires{" "}
              {process.env.NODE_ENV === "production" ? "the owner" : "you"} to
              activate Vercel AI Gateway.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                window.open(
                  "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card",
                  "_blank",
                );
                window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;
              }}
            >
              Activate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
