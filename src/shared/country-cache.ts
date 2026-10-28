/**
 * Country lookups by account, shared by every flag of a player: one request at a time per
 * player, a found country kept for hours, a miss only for minutes (the player may set a
 * location), and at most `max` players remembered. A failed request is not remembered.
 */
export function countryCache(
  fetch: (id: string) => Promise<string | null>,
  { found = 6 * 3_600_000, missing = 10 * 60_000, max = 500, now = Date.now } = {},
) {
  const entries = new Map<string, { at: number; value: Promise<string | null>; known?: string | null }>();
  return function lookup(id: string): Promise<string | null> {
    const entry = entries.get(id);
    const age = entry ? now() - entry.at : Infinity;
    if (entry && (entry.known === undefined || age < (entry.known === null ? missing : found))) return entry.value;
    entries.delete(id);
    const next = {
      at: now(),
      value: Promise.resolve<string | null>(null),
      known: undefined as string | null | undefined,
    };
    next.value = fetch(id).then(
      (value) => {
        next.known = value;
        return value;
      },
      () => {
        if (entries.get(id) === next) entries.delete(id);
        return null;
      },
    );
    entries.set(id, next);
    // Map order is insertion order: the first keys are the oldest lookups.
    for (const key of entries.keys()) {
      if (entries.size <= max) break;
      entries.delete(key);
    }
    return next.value;
  };
}
