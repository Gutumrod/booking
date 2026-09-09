// Reconcile a background schedule refetch with unsaved local edits (KMO-05).
//
// The dashboard used to overwrite the whole schedules array on every refetch,
// discarding edits the merchant had made to staff cards they hadn't saved yet.
// This keeps the local copy for any staff marked dirty and takes the server
// copy for everyone else.
//
// Pure and framework-free for unit testing from `tests/`.

export function mergeServerSchedules<T extends { staffId: string }>(
  previous: readonly T[],
  server: readonly T[],
  dirtyStaffIds: ReadonlySet<string>,
): T[] {
  return server.map((s) =>
    dirtyStaffIds.has(s.staffId)
      ? (previous.find((p) => p.staffId === s.staffId) ?? s)
      : s,
  );
}
