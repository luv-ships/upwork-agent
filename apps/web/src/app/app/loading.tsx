export default function AppLoading() {
  return (
    <div className="grid gap-4" aria-label="Loading" role="status">
      <div className="h-9 w-64 animate-pulse rounded-lg bg-slate-200" />
      <div className="h-4 w-96 max-w-full animate-pulse rounded bg-slate-200" />
      <div className="mt-4 h-48 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      <span className="sr-only">Loading workspace</span>
    </div>
  );
}
