import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@strictbudget/ui/components/card";
import type { ReactNode } from "react";
import { BrandLockup } from "./brand";

export function AuthCard(props: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="relative isolate flex min-h-svh flex-col items-center justify-center gap-8 overflow-hidden bg-muted/40 px-4 py-12">
      {/* A soft wash of the brand colour behind the card. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-[28rem] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent)]"
      />
      <BrandLockup />
      <Card className="w-full max-w-sm shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.12)] dark:shadow-none">
        <CardHeader className="gap-1.5 pt-2 text-center">
          <CardTitle className="font-semibold text-2xl tracking-tight">{props.title}</CardTitle>
          <CardDescription className="text-pretty">{props.description}</CardDescription>
        </CardHeader>
        <CardContent>{props.children}</CardContent>
        <CardFooter className="justify-center py-4 text-muted-foreground text-sm">
          {props.footer}
        </CardFooter>
      </Card>
    </main>
  );
}
