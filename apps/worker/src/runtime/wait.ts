export function waitForAbortOrTimeout(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);

    function onAbort(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve();
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}
