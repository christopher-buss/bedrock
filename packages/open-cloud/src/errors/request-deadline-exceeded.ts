import type { AdmissionWaitReason } from "../client/types.ts";
import { OpenCloudError } from "./base.ts";

/**
 * Options for constructing a {@link RequestDeadlineExceededError}.
 *
 * @since 0.3.2
 */
export interface RequestDeadlineExceededErrorOptions extends ErrorOptions {
	/** Absolute caller-supplied deadline, as Unix epoch milliseconds. */
	readonly deadlineMs: number;
	/** Time left when the SDK refused or ended the wait. */
	readonly remainingMs: number;
	/** Intended wait duration, when it was known before waiting. */
	readonly waitMs?: number | undefined;
	/** SDK admission mechanism whose wait could not meet the deadline. */
	readonly waitReason?: AdmissionWaitReason | undefined;
}

/**
 * Returned when a logical request cannot complete by its absolute deadline.
 * Optional wait details identify an SDK-managed admission wait that was
 * refused. This is distinct from caller cancellation so consumers can report
 * exhausted wall-clock budget accurately.
 *
 * @since 0.3.2
 *
 * @example
 *
 * ```ts
 * import { RequestDeadlineExceededError } from "@bedrock-rbx/ocale";
 *
 * const error = new RequestDeadlineExceededError("Request deadline elapsed", {
 *     deadlineMs: 1_000_000,
 *     remainingMs: 0,
 *     waitReason: "operation-queue",
 * });
 *
 * expect(error.remainingMs).toBe(0);
 * expect(error.waitReason).toBe("operation-queue");
 * ```
 */
export class RequestDeadlineExceededError extends OpenCloudError {
	/** Absolute caller-supplied deadline, as Unix epoch milliseconds. */
	public readonly deadlineMs: number;
	public override readonly name: string = "RequestDeadlineExceededError";
	/** Time left when the SDK refused or ended the wait. */
	public readonly remainingMs: number;
	/** Intended wait duration, when known. */
	public readonly waitMs: number | undefined;
	/** SDK admission mechanism whose wait could not meet the deadline. */
	public readonly waitReason: AdmissionWaitReason | undefined;

	/**
	 * Creates a new RequestDeadlineExceededError.
	 *
	 * @param message - Human-readable description of the exhausted deadline.
	 * @param options - Deadline, remaining budget, and optional wait details.
	 */
	constructor(message: string, options: RequestDeadlineExceededErrorOptions) {
		super(message, options);
		this.deadlineMs = options.deadlineMs;
		this.remainingMs = options.remainingMs;
		this.waitMs = options.waitMs;
		this.waitReason = options.waitReason;
	}
}
