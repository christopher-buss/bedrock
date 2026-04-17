/**
 * Discriminated union for explicit error handling.
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
 *     const age = Number(input);
 *     return Number.isFinite(age)
 *         ? { data: age, success: true }
 *         : { err: new Error(`Not a number: ${input}`), success: false };
 * }
 *
 * const ok = parseAge("42");
 * if (ok.success) {
 *     // ok.data is narrowed to number here; value is 42
 *     expect(ok.data).toBe(42);
 * }
 *
 * const bad = parseAge("nope");
 * if (!bad.success) {
 *     // bad.err is narrowed to Error here; message mentions the input
 *     expect(bad.err.message).toContain("Not a number");
 * }
 * ```
 */
export type Result<T, E = Error> = { data: T; success: true } | { err: E; success: false };
