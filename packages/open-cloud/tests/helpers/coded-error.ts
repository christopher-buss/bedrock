/**
 * Immutable `Error` subclass carrying a `code` property, for building
 * transport-failure fixtures in tests without mutating an `Error` instance
 * after construction (the `Object.assign(new Error(), { code })` pattern the
 * project's immutability rule forbids). `code` is typed `number | string` so
 * tests can also exercise the non-string-code path; pass `options.cause` to
 * build a nested cause chain.
 */
export class CodedError extends Error {
	public readonly code: number | string;

	/**
	 * Creates a coded error.
	 *
	 * @param message - Human-readable error description.
	 * @param code - Transport error code (e.g. `ECONNRESET`); a non-string value
	 *   exercises the "ignore non-string code" path.
	 * @param options - Standard error options, e.g. `cause` for chained errors.
	 */
	constructor(message: string, code: number | string, options?: ErrorOptions) {
		super(message, options);
		this.code = code;
	}
}
