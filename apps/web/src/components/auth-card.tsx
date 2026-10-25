import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@strictbudget/ui/components/card";
import type { ReactNode } from "react";

export function AuthCard(props: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <p className="font-semibold text-primary-text text-sm tracking-tight">strictbudget</p>
          <CardTitle className="text-2xl">{props.title}</CardTitle>
          <CardDescription>{props.description}</CardDescription>
        </CardHeader>
        <CardContent>{props.children}</CardContent>
        <CardFooter className="justify-center text-muted-foreground text-sm">
          {props.footer}
        </CardFooter>
      </Card>
    </main>
  );
}
