/**
 * Caller-supplied input for submitting a Luau Execution task against a
 * place's head version. Submitting against a specific place version uses
 * {@link SubmitAtVersionParameters} instead.
 */
export interface SubmitAtHeadParameters {
	/**
	 * Resource path returned by `binaryInputs.create`, passed to the
	 * server to attach a pre-uploaded binary to this task.
	 */
	readonly binaryInput?: string | undefined;
	/** When `true`, the server places the task output into a binary blob. */
	readonly enableBinaryOutput?: boolean | undefined;
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
	/**
	 * Resource path returned by `binaryInputs.create`, passed to the
	 * server to attach a pre-uploaded binary to this task.
	 */
	readonly binaryInput?: string | undefined;
	/** When `true`, the server places the task output into a binary blob. */
	readonly enableBinaryOutput?: boolean | undefined;
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
 * Discriminated variant carrying the script's return values. The
 * server populates `output.results` with the Luau `return` values from
 * the script run, serialized as JSON; entries that were not
 * JSON-serializable (e.g., Roblox `Instance`s) appear as `null`.
 */
export interface CompleteTask extends LuauExecutionTaskBase {
	/**
	 * JSON projection of the script's return values, in order. The total
	 * serialized size of this array is bounded by the server-enforced
	 * 4 MB output limit.
	 */
	readonly output: { readonly results: ReadonlyArray<JSONValue> };
	/** Discriminator: the task ran to completion and produced output. */
	readonly state: "COMPLETE";
}

/**
 * Discriminated variant carrying the categorical error code and a
 * human-readable message describing the failure. The
 * `ERROR_CODE_UNSPECIFIED` wire sentinel is rejected by the parser, so
 * `code` is narrowed here to the four substantive error categories.
 */
export interface FailedTask extends LuauExecutionTaskBase {
	/** The categorical error code and message that caused the task to fail. */
	readonly error: {
		/**
		 * `SCRIPT_ERROR` for unhandled Luau errors, `DEADLINE_EXCEEDED`
		 * when the script outran its timeout, `OUTPUT_SIZE_LIMIT_EXCEEDED`
		 * when the return values exceeded 4 MB, or `INTERNAL_ERROR` for
		 * server-side faults.
		 */
		readonly code:
			| "DEADLINE_EXCEEDED"
			| "INTERNAL_ERROR"
			| "OUTPUT_SIZE_LIMIT_EXCEEDED"
			| "SCRIPT_ERROR";
		/** Human-readable description of the failure. */
		readonly message: string;
	};
	/** Discriminator: the task ran but failed before producing output. */
	readonly state: "FAILED";
}

/**
 * Public, discriminated representation of a Luau Execution session
 * task. The variants are mutually exclusive on `state`.
 */
export type LuauExecutionTask = CompleteTask | FailedTask | InProgressTask;

/**
 * Common fields surfaced on every {@link LuauExecutionTask} variant.
 * Variant-specific fields (`output` for COMPLETE, `error` for FAILED)
 * live on the variants themselves.
 */
interface LuauExecutionTaskBase {
	/**
	 * Resource path of the binary input attached to this task, when one
	 * was supplied at submit time.
	 */
	readonly binaryInput?: string | undefined;
	/**
	 * Pre-signed URI from which the binary output blob can be downloaded.
	 * Present only after a `COMPLETE` task whose `enableBinaryOutput` was
	 * `true`.
	 */
	readonly binaryOutputUri?: string | undefined;
	/**
	 * Timestamp when the task was created. Surfaces `undefined` on the
	 * task returned by `submit`, since the server omits the timestamp
	 * from the create-task response; polled tasks carry it.
	 */
	readonly createdAt?: Date | undefined;
	/** When `true`, the server writes output to a binary blob. */
	readonly enableBinaryOutput?: boolean | undefined;
	/** Round-trip-safe reference to this task. */
	readonly ref: LuauExecutionTaskRef;
	/**
	 * Wall-clock execution limit in seconds, as supplied at submit time.
	 * Surfaces `undefined` when the request did not set a timeout (the
	 * server applies its 5-minute default in that case).
	 */
	readonly timeoutSeconds?: number | undefined;
	/**
	 * Timestamp of the most recent state change. Surfaces `undefined`
	 * on the task returned by `submit`, since the server omits the
	 * timestamp from the create-task response; polled tasks carry it.
	 */
	readonly updatedAt?: Date | undefined;
	/** Identifier of the user that owns the API key used to create this task. */
	readonly user: string;
}
