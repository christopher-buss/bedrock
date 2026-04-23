import { OpenCloudError } from "./base.ts";

/**
 * Closed discriminator for a {@link ValidationError}. Consumers can
 * exhaustively `switch` over this union so TypeScript will refuse to compile
 * if a new variant is added without a handler.
 */
export type ValidationErrorCode = "empty_body" | "empty_update" | "format_mismatch";

/**
 * Options for constructing a {@link ValidationError}.
 */
export interface ValidationErrorOptions extends ErrorOptions {
	/** Machine-readable discriminator identifying the validation failure. */
	code: ValidationErrorCode;
}

/**
 * Thrown locally when caller-supplied input is rejected before any HTTP
 * round-trip. The `code` discriminator lets consumers branch on local-input
 * errors separately from server-side errors.
 *
 * @example
 *
 * ```ts
 * import { ValidationError } from "@bedrock/ocale";
 *
 * const error = new ValidationError("Place body is empty", {
 *     code: "empty_body",
 * });
 *
 * expect(error).toBeInstanceOf(ValidationError);
 * expect(error.code).toBe("empty_body");
 * ```
 */
export class ValidationError extends OpenCloudError {
	public readonly code: ValidationErrorCode;
	public override readonly name: string = "ValidationError";

	/**
	 * Creates a new ValidationError.
	 *
	 * @param message - Human-readable error description.
	 * @param options - Error options including the validation failure code.
	 */
	constructor(message: string, options: ValidationErrorOptions) {
		super(message, options);
		this.code = options.code;
	}
}
