/**
 * Per-request identity threaded into every handler and integration function.
 * `userId` is the owning user's E.164 phone number (see docs/v2-plan.md §C.3
 * — there is no separate registry id yet, phone number *is* the id).
 * `timezone` is that user's own setting; there is no global default.
 */
export interface Ctx {
  userId: string;
  timezone: string;
}
