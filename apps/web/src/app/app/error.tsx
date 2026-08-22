"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto max-w-xl p-8 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-amber-100 text-amber-800">
        <AlertTriangle className="size-6" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-xl font-semibold text-slate-950">This view could not be loaded</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        The operation is safe to retry. No background work is inferred from this screen state.
      </p>
      <Button className="mt-6" onClick={reset}>Try again</Button>
    </Card>
  );
}
