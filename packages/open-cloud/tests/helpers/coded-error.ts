/**
 * Immutable `Error` subclass carrying a Node-style transport `code`, for
 * building transport-failure fixtures in tests without mutating an `Error`
 * instance after construction (the `Object.assign(new Error(), { code })`
 * pattern the project's immutability rule forbids).
 */
export class CodedError extends Error {
	public readonly code: string;

	/**
	 * Creates a coded transport error.
	 *
	 * @param message - Human-readable error description.
	 * @param code - Node-style transport error code (e.g. `ECONNRESET`).
	 */
	constructor(message: string, code: string) {
		super(message);
		this.code = code;
	}
}
