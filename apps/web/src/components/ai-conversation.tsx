import { Bubble, BubbleContent } from "@strictbudget/ui/components/bubble";
import { Button } from "@strictbudget/ui/components/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@strictbudget/ui/components/input-group";
import { Message, MessageContent } from "@strictbudget/ui/components/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@strictbudget/ui/components/message-scroller";
import { Skeleton } from "@strictbudget/ui/components/skeleton";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@strictbudget/ui/components/trace";
import { fetchServerSentEvents, type UIMessage, useChat } from "@tanstack/ai-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Check, CircleAlert, CircleDashed, Paperclip, Square, X } from "lucide-react";
import { type DragEvent, type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { PickedFiles, SentFiles, sentFile, usePickedFiles } from "@/components/ai-attachments";
import { AiChangePreview } from "@/components/ai-change-preview";
import { AiChart, chartSpec } from "@/components/ai-chart";
import { AI_FILE_ACCEPT } from "@/lib/ai";
import { apiBaseUrl } from "@/lib/api";
import { todayIso } from "@/lib/dates";
import { CLIENT_ID } from "@/lib/live-updates";

/**
 * Streamdown's tables in the shared Table's look: a muted tray holding a raised body, small muted
 * headings and px-3 cells. Styled through its data-streamdown hooks rather than its `components`
 * prop, which would replace the table along with its copy, download and fullscreen controls.
 */
const MARKDOWN_TABLE = [
  "[&_[data-streamdown=table-wrapper]]:my-2 [&_[data-streamdown=table-wrapper]]:gap-1 [&_[data-streamdown=table-wrapper]]:rounded-xl [&_[data-streamdown=table-wrapper]]:border-0 [&_[data-streamdown=table-wrapper]]:bg-muted [&_[data-streamdown=table-wrapper]]:p-[5px] [&_[data-streamdown=table-wrapper]]:ring-1 [&_[data-streamdown=table-wrapper]]:ring-border dark:[&_[data-streamdown=table-wrapper]]:bg-[color-mix(in_oklch,var(--background),black_20%)]",
  "[&_[data-streamdown=table-wrapper]>div:has(>table)]:rounded-[10px] [&_[data-streamdown=table-wrapper]>div:has(>table)]:shadow-[0_1px_2px_rgb(0_0_0/0.04)] dark:[&_[data-streamdown=table-wrapper]>div:has(>table)]:shadow-[0_1px_2px_rgb(0_0_0/0.4)]",
  "[&_[data-streamdown=table]]:tabular-nums [&_[data-streamdown=table-header]]:bg-muted/50",
  "[&_[data-streamdown=table-header-cell]]:px-3 [&_[data-streamdown=table-header-cell]]:text-[13px] [&_[data-streamdown=table-header-cell]]:font-medium [&_[data-streamdown=table-header-cell]]:text-muted-foreground",
  "[&_[data-streamdown=table-cell]]:px-3",
].join(" ");

const SUGGESTIONS = [
  "What's left to spend this month?",
  "Where did my money go last month?",
  "Add a transaction",
] as const;

const VERBS: Record<string, [doing: string, done: string]> = {
  list: ["Looking at", "Looked at"],
  get: ["Looking at", "Looked at"],
  summarize: ["Adding up", "Added up"],
  preview: ["Checking", "Checked"],
  create: ["Adding", "Added"],
  update: ["Updating", "Updated"],
  delete: ["Deleting", "Deleted"],
  assign: ["Assigning to", "Assigned to"],
  move: ["Moving", "Moved"],
  set: ["Setting", "Set"],
  calculate: ["Calculating", "Calculated"],
  present: ["Drawing", "Drew"],
  attach: ["Attaching", "Attached"],
};

/** What a tool call did, for people: `listAccounts` → "Looked at accounts". */
function activityLabel(name: string, done: boolean): string {
  const [verb = "", ...rest] = name
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .split(" ");
  const words = rest.join(" ");
  const pair = VERBS[verb];
  if (!pair) return `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${words}`.trim();
  return `${done ? pair[1] : pair[0]} ${words}`;
}

/**
 * One conversation with the budget's assistant (TanStack AI `useChat`). The server keeps the
 * conversation, so opening it again (or reloading) shows it as it was, including any change still
 * waiting for approval. Without `conversationId` it starts a new one, reported through `onStarted`
 * once the first message is sent. A new one can start with `initialMessage` sent as it opens.
 */
export function AiConversation({
  budgetId,
  conversationId,
  initialMessage,
  onStarted,
}: {
  budgetId: string;
  conversationId?: string;
  initialMessage?: string;
  onStarted?: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  // A new conversation's id is made here; the server takes it as the conversation's id.
  const [threadId] = useState(() => conversationId ?? crypto.randomUUID());
  const started = useRef(Boolean(conversationId));
  const connection = useMemo(
    () =>
      fetchServerSentEvents(`${apiBaseUrl}/v1/budgets/${budgetId}/ai/chat`, {
        credentials: "include",
        headers: { "X-Client-Id": CLIENT_ID },
      }),
    [budgetId],
  );
  const refreshHistory = () =>
    queryClient.invalidateQueries({ queryKey: ["get", "/v1/budgets/{budgetId}/ai/conversations"] });
  const chat = useChat({
    threadId,
    connection,
    persistence: true,
    history: { pageSize: 50 },
    forwardedProps: { today: todayIso() },
    // The server has saved the conversation by the time it answers, so the history can show it.
    onResponse: () => void refreshHistory(),
    onFinish: () => void refreshHistory(),
  });
  const [draft, setDraft] = useState("");
  const picked = usePickedFiles(budgetId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const busy = chat.isLoading || chat.resuming;
  // Changes the assistant wants to make. The tools are the server's, so the client can't bind
  // them as typed tool approvals; they arrive as generic interrupts whose descriptor the server
  // marks as an approval (TanStack AI: "a generic item with a valid raw binding has untyped
  // controls"). The answer is the approval's response schema: `{ approved }`.
  // Which way the person answered each staged approval (the client keeps only that it's answered).
  const [decisions, setDecisions] = useState<Record<string, "approved" | "denied">>({});
  const approvals = chat.interrupts.flatMap((i) =>
    i.kind === "generic" && i.metadata?.kind === "approval"
      ? [
          {
            id: i.id,
            toolName: String(i.metadata.toolName ?? ""),
            args: i.metadata.input,
            canResolve: i.canResolve,
            /** Answered, waiting for the rest of the batch (or on its way to the server). */
            answered: i.status === "staged" || i.status === "submitting",
            errors: i.errors,
            approve: () => {
              setDecisions((d) => ({ ...d, [i.id]: "approved" }));
              i.resolveInterrupt({ approved: true });
            },
            // Cancelling skips the approval schema check, so a request made before the tool's
            // schema changed (a deploy) can still be turned down instead of blocking the chat.
            deny: () => {
              setDecisions((d) => ({ ...d, [i.id]: "denied" }));
              i.cancel();
            },
            change: () => i.clearResolution(),
          },
        ]
      : [],
  );

  function send(text: string) {
    const content = text.trim();
    const files = picked.ready;
    if ((!content && files.length === 0) || busy || picked.uploading || approvals.length > 0) {
      return;
    }
    setDraft("");
    picked.clear();
    // Files go as pointers to what was uploaded (the server never keeps a file in the transcript).
    void chat.sendMessage(
      files.length === 0
        ? content
        : {
            content: [
              ...(content ? [{ type: "text" as const, content }] : []),
              ...files.map((f) => ({
                type: f.contentType.startsWith("image/")
                  ? ("image" as const)
                  : ("document" as const),
                source: {
                  type: "url" as const,
                  value: `strictbudget-attachment:${f.id}`,
                  mimeType: f.contentType,
                },
                metadata: { attachmentId: f.id, fileName: f.fileName, byteSize: f.byteSize },
              })),
            ],
          },
    );
    if (!started.current) {
      started.current = true;
      onStarted?.(threadId);
    }
  }

  // The question it opened with goes out once, as soon as the chat can take it.
  const asked = useRef(false);
  useEffect(() => {
    if (!initialMessage || asked.current || started.current || busy) return;
    asked.current = true;
    send(initialMessage);
  }, [busy]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(draft);
  }

  return (
    <>
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport aria-label="Conversation" className="px-4">
            <MessageScrollerContent className="gap-4 py-4">
              {chat.isHydrating ? (
                <div className="grid gap-3">
                  <Skeleton className="ml-auto h-9 w-1/2" />
                  <Skeleton className="h-16 w-3/4" />
                </div>
              ) : chat.messages.length === 0 ? (
                <div className="grid gap-3 py-6 text-center">
                  <p className="text-muted-foreground text-sm">
                    Ask about this budget, or try one of these.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s) => (
                      <Button key={s} variant="outline" size="sm" onClick={() => send(s)}>
                        {s}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}
              {chat.messages.map((m) => (
                <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === "user"}>
                  <ChatMessage
                    budgetId={budgetId}
                    message={m}
                    streaming={chat.isLoading && m.id === chat.messages.at(-1)?.id}
                  />
                </MessageScrollerItem>
              ))}
              {approvals.length > 1 && (
                // Answers to several changes go to the server together, once all are answered.
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card p-3 text-sm">
                  <p className="min-w-0 flex-1">
                    <span className="font-medium">
                      {approvals.filter((a) => a.answered).length} of {approvals.length} changes
                      answered.
                    </span>{" "}
                    <span className="text-muted-foreground">
                      They're applied together once you've answered all of them.
                    </span>
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={chat.resuming}
                      onClick={() => {
                        setDecisions(
                          Object.fromEntries(approvals.map((a) => [a.id, "approved" as const])),
                        );
                        chat.resolveInterrupts((item) => {
                          if (item.kind === "generic") item.resolveInterrupt({ approved: true });
                          else item.cancel();
                        });
                      }}
                    >
                      <Check /> Approve all
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={chat.resuming}
                      onClick={() => {
                        setDecisions(
                          Object.fromEntries(approvals.map((a) => [a.id, "denied" as const])),
                        );
                        chat.cancelInterrupts();
                      }}
                    >
                      <X /> Deny all
                    </Button>
                  </div>
                </div>
              )}
              {approvals.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  name={approval.toolName}
                  args={approval.args}
                  decision={approval.answered ? (decisions[approval.id] ?? "approved") : null}
                  errors={approval.errors.map((e) => e.message)}
                  disabled={!approval.canResolve || chat.resuming}
                  onApprove={approval.approve}
                  onDeny={approval.deny}
                  onChange={approval.change}
                />
              ))}
              {chat.interruptErrors.length > 0 && (
                <Bubble variant="destructive">
                  <BubbleContent role="alert">
                    Your answers couldn't be applied. Try again, or start a new chat.
                  </BubbleContent>
                </Bubble>
              )}
              {busy && approvals.length === 0 && (
                <Trace aria-live="polite">
                  <TraceLine status="running">
                    <TraceTitle>Thinking…</TraceTitle>
                  </TraceLine>
                </Trace>
              )}
              {chat.error && (
                <Bubble variant="destructive">
                  {/* The provider's own message is technical and changes between versions. */}
                  <BubbleContent role="alert">
                    The assistant couldn't answer. Try again.
                  </BubbleContent>
                </Bubble>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <form
        onSubmit={onSubmit}
        className="relative border-t p-3"
        onDragOver={(e: DragEvent) => {
          if (!e.dataTransfer.types.includes("Files") || approvals.length > 0) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e: DragEvent) => {
          setDragging(false);
          if (!e.dataTransfer.files.length || approvals.length > 0) return;
          e.preventDefault();
          picked.add(e.dataTransfer.files);
        }}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-primary border-dashed bg-background/90 font-medium text-sm">
            Drop files to attach them
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={AI_FILE_ACCEPT}
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            if (e.target.files) picked.add(e.target.files);
            e.target.value = "";
          }}
        />
        <InputGroup>
          {picked.files.length > 0 && (
            <InputGroupAddon align="block-start" className="px-0 pt-1 pb-0">
              <PickedFiles files={picked.files} onRemove={picked.remove} />
            </InputGroupAddon>
          )}
          <InputGroupTextarea
            aria-label="Message"
            placeholder={
              approvals.length > 0 ? "Approve or deny the change first…" : "Ask about your budget…"
            }
            value={draft}
            rows={1}
            disabled={approvals.length > 0}
            className="max-h-32 min-h-10"
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              // A screenshot or copied file pastes as an attachment.
              if (e.clipboardData.files.length === 0) return;
              e.preventDefault();
              picked.add(e.clipboardData.files);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(draft);
              }
            }}
          />
          <InputGroupAddon align="block-end" className="justify-between">
            <InputGroupButton
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label="Attach files"
              title="Attach a receipt, statement or spreadsheet"
              disabled={approvals.length > 0 || picked.full}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip />
            </InputGroupButton>
            {chat.isLoading ? (
              <InputGroupButton
                type="button"
                size="icon-xs"
                variant="default"
                aria-label="Stop"
                onClick={() => chat.stop()}
              >
                <Square />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                size="icon-xs"
                variant="default"
                aria-label="Send"
                disabled={
                  (!draft.trim() && picked.ready.length === 0) ||
                  busy ||
                  picked.uploading ||
                  approvals.length > 0
                }
              >
                <ArrowUp />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </>
  );
}

function ChatMessage({
  budgetId,
  message,
  streaming,
}: {
  budgetId: string;
  message: UIMessage;
  streaming: boolean;
}) {
  const mine = message.role === "user";
  // A person's files sit above what they wrote, as they're read first.
  const files = mine ? message.parts.flatMap((p) => sentFile(p) ?? []) : [];
  const results = new Map(
    message.parts.flatMap((p) => (p.type === "tool-result" ? [[p.toolCallId, p] as const] : [])),
  );
  return (
    <Message align={mine ? "end" : "start"}>
      <MessageContent>
        {files.length > 0 && <SentFiles budgetId={budgetId} files={files} />}
        {message.parts.map((part, i) => {
          const key = `${message.id}-${i}`;
          if (part.type === "text" && part.content) {
            return (
              <Bubble key={key} variant={mine ? "default" : "muted"} align={mine ? "end" : "start"}>
                {mine ? (
                  <BubbleContent className="whitespace-pre-wrap">{part.content}</BubbleContent>
                ) : (
                  // The assistant writes Markdown; Streamdown renders it as it streams in, and
                  // asks before opening a link.
                  <BubbleContent className="[&_li]:py-0">
                    {/* Tighter than Streamdown's page-sized defaults (space-y-4, py-1 items). */}
                    <Streamdown className={`space-y-2 ${MARKDOWN_TABLE}`} isAnimating={streaming}>
                      {part.content}
                    </Streamdown>
                  </BubbleContent>
                )}
              </Bubble>
            );
          }
          if (mine && sentFile(part)) return null;
          if (part.type === "tool-call") {
            // The model's own tool for loading other tools' schemas isn't worth showing.
            if (part.name.startsWith("__")) return null;
            const result = results.get(part.id);
            // A chart the assistant shows: drawn from the call's arguments once the server
            // accepted them (a rejected spec reads as a failed step, and the model fixes it).
            if (part.name === "presentChart" && result?.state !== "error") {
              const spec = result ? chartSpec(part.input ?? parseArgs(part.arguments)) : null;
              return spec ? (
                <AiChart key={key} spec={spec} />
              ) : (
                <Skeleton key={key} className="h-72 w-full rounded-lg" />
              );
            }
            return (
              <ToolActivity
                key={key}
                name={part.name}
                status={
                  result?.outcome === "denied" || result?.outcome === "cancelled"
                    ? "denied"
                    : result?.state === "error"
                      ? "error"
                      : result
                        ? "done"
                        : "running"
                }
              />
            );
          }
          return null;
        })}
      </MessageContent>
    </Message>
  );
}

function parseArgs(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function ToolActivity({
  name,
  status,
}: {
  name: string;
  status: "running" | "done" | "error" | "denied";
}) {
  return (
    <Trace>
      <TraceLine
        status={status === "running" ? "running" : status === "error" ? "error" : undefined}
      >
        <TraceIcon>
          {status === "denied" ? (
            <X />
          ) : status === "error" ? (
            <CircleAlert />
          ) : status === "running" ? (
            <CircleDashed />
          ) : (
            <Check />
          )}
        </TraceIcon>
        <TraceTitle>
          {status === "denied"
            ? `Didn't ${activityLabel(name, false).toLowerCase()} (you said no)`
            : status === "error"
              ? `Couldn't finish: ${activityLabel(name, false).toLowerCase()}`
              : activityLabel(name, status === "done")}
        </TraceTitle>
      </TraceLine>
    </Trace>
  );
}

/**
 * A change the assistant wants to make, waiting for the person's approval: the assistant's own
 * plain-language summary, and what changes, field by field.
 */
function ApprovalCard({
  name,
  args,
  decision,
  errors,
  disabled,
  onApprove,
  onDeny,
  onChange,
}: {
  name: string;
  args: unknown;
  /** The person's answer, once given (it waits until every change in the batch is answered). */
  decision: "approved" | "denied" | null;
  errors: string[];
  disabled: boolean;
  onApprove: () => void;
  onDeny: () => void;
  onChange: () => void;
}) {
  const summary =
    args && typeof args === "object" && typeof (args as { summary?: unknown }).summary === "string"
      ? (args as { summary: string }).summary
      : null;
  return (
    <section
      aria-label="Approve this change"
      className="grid gap-3 rounded-lg border bg-card p-3 text-sm"
    >
      <div className="grid gap-0.5">
        <p className="text-muted-foreground text-xs">The assistant wants to make a change</p>
        <p className="font-medium">{summary ?? `${activityLabel(name, false)}?`}</p>
      </div>
      <AiChangePreview toolName={name} args={args} />
      {errors.map((message) => (
        <p key={message} role="alert" className="text-destructive">
          {message}
        </p>
      ))}
      {decision ? (
        <div className="flex items-center gap-2">
          <p className="flex items-center gap-1.5 font-medium">
            {decision === "approved" ? <Check className="size-4" /> : <X className="size-4" />}
            {decision === "approved" ? "You approved this" : "You denied this"}
          </p>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={onChange}>
            Change
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" disabled={disabled} onClick={onApprove}>
            <Check /> Approve
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={onDeny}>
            <X /> Deny
          </Button>
        </div>
      )}
    </section>
  );
}
