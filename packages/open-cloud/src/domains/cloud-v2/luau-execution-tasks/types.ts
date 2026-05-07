/**
 * Caller-supplied input for submitting a Luau Execution task against a
 * place's head version. Submitting against a specific place version uses
 * {@link SubmitAtVersionParameters} instead.
 */
export interface SubmitAtHeadParameters {
	/** Stringified ID of the place to run the script against. */
	readonly placeId: string;
	/** Luau source to execute. */
	readonly script: string;
	/**
	 * Wall-clock limit in seconds. The task fails when the script does not
	 * complete within this duration. Server default is 5 minutes.
	 */
	readonly timeoutSeconds?: number;
	/** Stringified ID of the universe that owns the place. */
	readonly universeId: string;
}

/**
 * Caller-supplied input for submitting a Luau Execution task against a
 * specific place version. Submitting against the head version uses
 * {@link SubmitAtHeadParameters} instead.
 */
export interface SubmitAtVersionParameters {
	/** Stringified ID of the place to run the script against. */
	readonly placeId: string;
	/** Luau source to execute. */
	readonly script: string;
	/**
	 * Wall-clock limit in seconds. The task fails when the script does not
	 * complete within this duration. Server default is 5 minutes.
	 */
	readonly timeoutSeconds?: number;
	/** Stringified ID of the universe that owns the place. */
	readonly universeId: string;
	/** Stringified ID of the place version the script targets. */
	readonly versionId: string;
}

/**
 * Five-field reference to a Luau Execution session task. The parser
 * extracts this from any of the four x-aep-resource `path` formats
 * returned by the server, and the get builder consumes it to construct
 * the maximal GET URL. `versionId` and `sessionId` are `undefined` when
 * the response `path` did not include those segments.
 */
export interface LuauExecutionTaskRef {
	/** Stringified place ID. */
	readonly placeId: string;
	/** Stringified luau-execution-session ID, when carried by the path. */
	readonly sessionId?: string | undefined;
	/** Stringified luau-execution-session-task ID. */
	readonly taskId: string;
	/** Stringified universe ID. */
	readonly universeId: string;
	/** Stringified place version ID, when carried by the path. */
	readonly versionId?: string | undefined;
}

/**
 * Caller-supplied input for fetching a Luau Execution task's current
 * state.
 */
export interface GetParameters {
	/** Reference to the task to fetch, typically returned by submit. */
	readonly ref: LuauExecutionTaskRef;
	/**
	 * View controls how much of the task body the server returns. The
	 * server defaults to BASIC (excludes `script`) when no view is sent;
	 * `FULL` includes every field.
	 */
	readonly view?: "BASIC" | "FULL";
}

/**
 * Discriminated variant carrying every state in which the task has not
 * yet produced output or an error: queued for execution, currently
 * executing, or cancelled by the caller.
 */
export interface InProgressTask extends LuauExecutionTaskBase {
	/** Discriminator: the task is queued, processing, or cancelled. */
	readonly state: "CANCELLED" | "PROCESSING" | "QUEUED";
}

/**
 * Public, discriminated representation of a Luau Execution session
 * task. Later slices widen the union with COMPLETE (carrying typed
 * `output.results`) and FAILED (carrying typed `error.code` and
 * `error.message`) variants.
 */
export type LuauExecutionTask = InProgressTask;

/**
 * Common fields surfaced on every {@link LuauExecutionTask} variant.
 * Variant-specific fields (`output` for COMPLETE, `error` for FAILED)
 * live on the variants themselves.
 */
interface LuauExecutionTaskBase {
	/** Timestamp when the task was created. */
	readonly createdAt: Date;
	/** Round-trip-safe reference to this task. */
	readonly ref: LuauExecutionTaskRef;
	/** Timestamp of the most recent state change. */
	readonly updatedAt: Date;
	/** Identifier of the user that owns the API key used to create this task. */
	readonly user: string;
}
