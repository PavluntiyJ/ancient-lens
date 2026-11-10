// The page's state contract. Types are inferred from these schemas, and every state
// command/event crosses them. Rust's contract test sends real Store output here too.
import { z } from 'zod';

// Persisted records deliberately preserve fields written by newer versions of the app.
export const noteEntrySchema = z.looseObject({
  id: z.string(),
  text: z.string(),
  at: z.string(),
  editedAt: z.string().optional(),
  matchId: z.number().optional(),
  heroId: z.number().optional(),
  ally: z.boolean().optional(),
});
export const noteSchema = z.looseObject({
  accountId: z.string(),
  name: z.string(),
  entries: z.array(noteEntrySchema),
  text: z.string(),
  updatedAt: z.string(),
});
export const mmrEntrySchema = z.looseObject({
  id: z.string(),
  value: z.number(),
  createdAt: z.string(),
  accountId: z.string().optional(),
  source: z.string().optional(),
  confidence: z.number().optional(),
});
export const ownAccountSchema = z.strictObject({
  accountId: z.string().nullable(),
  status: z.string(),
  source: z.string(),
  observedAt: z.string(),
  mmr: z.number().nullable(),
  confidence: z.number().nullable(),
  behaviorScore: z.number().nullable(),
  communicationScore: z.number().nullable(),
});
export const ratingSnapshotSchema = z.looseObject({
  mmr: z.number().nullable(),
  confidence: z.number(),
  behaviorScore: z.number(),
  communicationScore: z.number(),
  confirmedAt: z.string(),
});
export const shortcutsSchema = z.strictObject({
  global: z.string(),
  profile: z.string(),
  leftPrevious: z.string(),
  leftNext: z.string(),
  rightPrevious: z.string(),
  rightNext: z.string(),
  lanePrevious: z.string(),
  laneNext: z.string(),
});
// The UI also merges older partial updates. Current IPC always sends the complete shape
// below; .required() at the wire boundary catches removal/renaming of optional UI fields.
export const localStateSchema = z.strictObject({
  revision: z.number().optional(),
  ownAccount: ownAccountSchema.nullable().optional(),
  ratingSnapshot: ratingSnapshotSchema.nullable().optional(),
  profileAccounts: z.array(z.string()).optional(),
  unassignedMmrCount: z.number().optional(),
  nativeRosterReader: z.enum(['off', 'on']).optional(),
  closeToTray: z.boolean().optional(),
  autoHide: z.boolean().optional(),
  keysOverGame: z.boolean().optional(),
  updateCheck: z.boolean().optional(),
  skippedVersion: z.string().nullable().optional(),
  shortcuts: shortcutsSchema.optional(),
  recordedMatches: z.number().optional(),
  journalRevision: z.number().optional(),
  accountId: z.string(),
  notes: z.array(noteSchema),
  mmr: z.array(mmrEntrySchema),
});
export const stateResultSchema = localStateSchema.required();
export const ownUpdateSchema = z.strictObject({ revision: z.number(), ownAccount: ownAccountSchema.nullable() });

export type NoteEntry = z.infer<typeof noteEntrySchema>;
export type Note = z.infer<typeof noteSchema>;
export type MmrEntry = z.infer<typeof mmrEntrySchema>;
export type OwnAccount = z.infer<typeof ownAccountSchema>;
export type RatingSnapshot = z.infer<typeof ratingSnapshotSchema>;
export type LocalState = z.infer<typeof localStateSchema>;
export type OwnUpdate = z.infer<typeof ownUpdateSchema>;

const stateCommands = new Set([
  'state:get',
  'state:profile-account',
  'state:account',
  'state:add-profile',
  'state:remove-profile',
  'state:reader',
  'state:tray',
  'state:auto-hide',
  'state:keys-over-game',
  'state:update-check',
  'state:skip-version',
  'state:shortcuts',
  'note:add',
  'note:edit',
  'note:delete-entry',
  'note:delete',
  'mmr:add',
  'mmr:delete',
]);
/** Provider-shaped commands stay outside this first contract, as documented in architecture. */
export function validateStateResult(command: string, value: unknown): unknown {
  return stateCommands.has(command) ? stateResultSchema.parse(value) : value;
}
