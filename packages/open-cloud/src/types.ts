/**
 * Discriminated union for explicit error handling (ADR-009).
 *
 * Every SDK client method returns `Promise<Result<T, OpenCloudError>>`.
 * Errors are never thrown — they are returned as `{ err, success: false }`.
 *
 * @template T - The success value type.
 * @template E - The error type (defaults to `Error`).
 */
export type Result<T, E = Error> = { data: T; success: true } | { err: E; success: false };
