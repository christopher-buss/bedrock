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
 * import type { Result } from "@bedrock-rbx/ocale";
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

/**
 * One page of a cursor-paginated SDK response.
 *
 * `list`-style methods on resource clients (for example
 * `GamePassesClient.list`) return a {@link Result} wrapping a `Page<T>`.
 * `nextPageToken` carries the cursor for the next page when one exists,
 * or `undefined` on the last page; the SDK normalizes the wire's
 * `null`-vs-absent variants to `undefined` so callers only ever see one
 * shape.
 *
 * @template T - The public item type for the listed resource.
 *
 * @example
 *
 * ```ts
 * import type { Page } from "@bedrock-rbx/ocale";
 *
 * const middle: Page<string> = { items: ["a", "b"], nextPageToken: "cursor" };
 * expect(middle.items).toEqual(["a", "b"]);
 * expect(middle.nextPageToken).toBe("cursor");
 *
 * const last: Page<string> = { items: ["c"], nextPageToken: undefined };
 * expect(last.items).toEqual(["c"]);
 * expect(last.nextPageToken).toBeUndefined();
 * ```
 */
export interface Page<T> {
	/** Items in this page, in the order returned by the API. */
	readonly items: ReadonlyArray<T>;
	/** Cursor for the next page; `undefined` on the last page. */
	readonly nextPageToken: string | undefined;
}
