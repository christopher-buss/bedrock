/**
 * Discriminated union for explicit error handling (ADR-009).
 *
 * Every SDK client method returns `Promise<Result<T, OpenCloudError>>`.
 * Errors are never thrown; they are returned as `{ err, success: false }`.
 *
 * @template T - The success value type.
 * @template E - The error type (defaults to `Error`).
 *
 * @example
 *
 * ```ts
 * import type { Result } from "@bedrock/ocale";
 *
 * function parseAge(input: string): Result<number, Error> {
 *     const n = Number(input);
 *     return Number.isFinite(n)
 *         ? { data: n, success: true }
 *         : { err: new Error(`Not a number: ${input}`), success: false };
 * }
 *
 * const ok = parseAge("42");
 * if (ok.success) {
 *     expect(ok.data).toBe(42);
 * }
 *
 * const bad = parseAge("nope");
 * if (!bad.success) {
 *     expect(bad.err.message).toContain("Not a number");
 * }
 * ```
 */
export type Result<T, E = Error> = { data: T; success: true } | { err: E; success: false };
