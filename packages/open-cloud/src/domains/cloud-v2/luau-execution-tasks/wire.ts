// Wire-level shape of the LuauExecutionSessionTask response body
// returned by the Open Cloud `cloud/v2` luau-execution endpoints.
// Internal to the sub-tree; not re-exported.

/**
 * Wire error payload for `FAILED` tasks. Carries the categorical
 * `code` plus a human-readable `message`. The wire enum value
 * `ERROR_CODE_UNSPECIFIED` is excluded here so a malformed sentinel
 * response is rejected at validation time.
 */
export interface LuauExecutionTaskErrorWire {
	/** Categorical error code; `ERROR_CODE_UNSPECIFIED` is not represented. */
	readonly code:
		| "DEADLINE_EXCEEDED"
		| "INTERNAL_ERROR"
		| "OUTPUT_SIZE_LIMIT_EXCEEDED"
		| "SCRIPT_ERROR";
	/** Human-readable error message. */
	readonly message: string;
}

/**
 * Wire output payload for `COMPLETE` tasks. Each entry of `results` is
 * a Roblox-protobuf `Value` whose JSON projection is null, boolean,
 * number, string, JSON array, or JSON object.
 */
export interface LuauExecutionTaskOutputWire {
	/** JSON projection of the script's `return` values, in order. */
	readonly results: ReadonlyArray<JSONValue>;
}

/**
 * Wire shape of the `LuauExecutionSessionTask` response body, narrowed
 * to the fields the current parser slice accepts. View-controlled
 * fields (`script`, `timeout`) are folded in by later slices when
 * they're observed.
 */
export interface LuauExecutionTaskWire {
	/** ISO timestamp when the task was created. */
	readonly createTime: string;
	/**
	 * Wire error payload. Present only for tasks in the `FAILED`
	 * state; absent for in-progress and `COMPLETE` states.
	 */
	readonly error?: LuauExecutionTaskErrorWire | undefined;
	/**
	 * Wire output payload. Present only for tasks in the `COMPLETE`
	 * state; absent for in-progress and `FAILED` states.
	 */
	readonly output?: LuauExecutionTaskOutputWire | undefined;
	/** Resource path; one of the four x-aep-resource path formats. */
	readonly path: string;
	/**
	 * Wire enum value, narrowed to the supported task states. The
	 * server-side `STATE_UNSPECIFIED` sentinel is excluded so the
	 * validator rejects it.
	 */
	readonly state: "CANCELLED" | "COMPLETE" | "FAILED" | "PROCESSING" | "QUEUED";
	/**
	 * Server-side duration string in `"<n>s"` form. Optional; when
	 * absent, the server applies its 5-minute default.
	 */
	readonly timeout?: string | undefined;
	/** ISO timestamp of the most recent state change. */
	readonly updateTime: string;
	/** Identifier of the user that owns the API key used to create this task. */
	readonly user: string;
}
