import { Button } from "@strictbudget/ui/components/button";
import { Spinner } from "@strictbudget/ui/components/spinner";
import { cn } from "@strictbudget/ui/lib/utils";
import { useRouter } from "@tanstack/react-router";
import {
  ChevronRight,
  CloudOff,
  Copy,
  House,
  RotateCw,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { BrandLockup } from "./brand";
import { PageTitle } from "./page-title";

type Kind = "offline" | "unreachable" | "unexpected";

const UNREACHABLE =
  /failed to fetch|networkerror|load failed|network request failed|data is undefined/i;

/** What went wrong, in words a person can act on, plus the raw details for a bug report. */
export function describeError(
  error: unknown,
  online = typeof navigator === "undefined" || navigator.onLine,
): { kind: Kind; title: string; message: string; details: string } {
  const details = errorDetails(error);
  if (!online) {
    return {
      kind: "offline",
      title: "You're offline",
      message: "Check your internet connection, then try again.",
      details,
    };
  }
  const status = (error as { status?: unknown } | null)?.status;
  if (UNREACHABLE.test(details) || (typeof status === "number" && status >= 500)) {
    return {
      kind: "unreachable",
      title: "We can't reach strictbudget",
      message:
        "The server isn't responding right now. This is usually brief, so try again in a moment.",
      details,
    };
  }
  return {
    kind: "unexpected",
    title: "Something went wrong",
    message:
      "This page ran into a problem it didn't expect. Try again, or head back to your budgets.",
    details,
  };
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return [`${error.name}: ${error.message}`, error.stack?.split("\n").slice(1).join("\n")]
      .filter(Boolean)
      .join("\n");
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error, null, 2) ?? String(error);
  } catch {
    return String(error);
  }
}

const ICONS: Record<Kind, typeof CloudOff> = {
  offline: WifiOff,
  unreachable: CloudOff,
  unexpected: TriangleAlert,
};

/**
 * The router's error screen. It needs nothing from the API, so it renders while the API is down.
 * `fullPage` is for errors above the app shell (the root route), with the brand and the whole
 * window to itself; otherwise it fills the shell's content area.
 */
export function ErrorScreen({
  error,
  reset,
  fullPage = false,
}: {
  error: unknown;
  reset?: () => void;
  fullPage?: boolean;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const { kind, title, message, details } = describeError(error);
  const Icon = ICONS[kind];

  async function retry() {
    setRetrying(true);
    try {
      reset?.();
      await router.invalidate();
    } catch {
      window.location.reload();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <StatusLayout fullPage={fullPage} title={title}>
      <div className="grid justify-items-center gap-4 text-center">
        <span
          className={cn(
            "grid size-12 place-items-center rounded-xl ring-1",
            kind === "unexpected"
              ? "bg-destructive/10 text-destructive ring-destructive/20"
              : "bg-muted text-muted-foreground ring-border",
          )}
        >
          <Icon className="size-6" aria-hidden />
        </span>
        <div className="grid gap-1.5">
          <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
          <p className="text-pretty text-muted-foreground">{message}</p>
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => void retry()} disabled={retrying}>
          {retrying ? <Spinner /> : <RotateCw />}
          {retrying ? "Retrying…" : "Try again"}
        </Button>
        <Button variant="outline" asChild>
          {/* A full page load, so a fresh start doesn't depend on the router's state. */}
          <a href="/">
            <House /> Go to my budgets
          </a>
        </Button>
      </div>
      <TechnicalDetails details={details} />
    </StatusLayout>
  );
}

function TechnicalDetails({ details }: { details: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="group w-full rounded-lg border bg-muted/40 text-left text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-3 py-2 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 transition-transform duration-150 group-open:rotate-90"
          aria-hidden
        />
        Technical details
      </summary>
      <div className="grid gap-2 border-t px-3 py-3">
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-muted-foreground text-xs">
          {details}
        </pre>
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() =>
            void navigator.clipboard?.writeText(details).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          <Copy /> {copied ? "Copied" : "Copy details"}
        </Button>
      </div>
    </details>
  );
}

/** The frame the error and not-found screens share. */
export function StatusLayout({
  fullPage,
  title,
  children,
}: {
  fullPage: boolean;
  title: string;
  children: ReactNode;
}) {
  const content = (
    <div className="mx-auto grid h-fit w-full max-w-md justify-items-center gap-6">{children}</div>
  );
  if (!fullPage) {
    return (
      <div className="flex flex-1 justify-center px-4 pt-[12vh] pb-10">
        <PageTitle name={title} />
        {content}
      </div>
    );
  }
  return (
    <main className="flex min-h-svh flex-col items-center bg-muted/40 px-4 py-10">
      <PageTitle name={title} />
      <BrandLockup />
      <div className="flex w-full flex-1 justify-center pt-[14vh] pb-10">{content}</div>
    </main>
  );
}
