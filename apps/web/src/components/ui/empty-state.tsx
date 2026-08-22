import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

export function EmptyState({
  action,
  description,
  icon,
  title
}: {
  action?: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <Card className="grid min-h-64 place-items-center p-8 text-center">
      <div className="max-w-md">
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-slate-100 text-slate-600">{icon}</span>
        <h2 className="mt-5 text-lg font-semibold text-slate-950">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </Card>
  );
}
