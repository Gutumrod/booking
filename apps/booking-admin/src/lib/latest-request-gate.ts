// Small framework-free generation gate for async loaders (Codex NEW-F14).
// Every new request invalidates every older token. cancel() invalidates all
// in-flight tokens, which is useful during component cleanup.

export interface LatestRequestGate {
  begin(): number;
  isCurrent(token: number): boolean;
  cancel(): void;
}

export function createLatestRequestGate(): LatestRequestGate {
  let generation = 0;

  return {
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(token: number) {
      return token === generation;
    },
    cancel() {
      generation += 1;
    },
  };
}
