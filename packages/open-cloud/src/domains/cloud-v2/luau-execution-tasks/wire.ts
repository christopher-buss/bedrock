// Wire-level shape of the LuauExecutionSessionTask response body
// returned by the Open Cloud `cloud/v2` luau-execution endpoints.
// Internal to the sub-tree; not re-exported.

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
 * to the fields present on every state. Variant-specific fields
 * (`output` for COMPLETE, `error` for FAILED) and view-controlled
 * fields (`script`, `timeout`) are folded in by later slices when
 * they're observed.
 */
export interface LuauExecutionTaskWire {
	/** ISO timestamp when the task was created. */
	readonly createTime: string;
	/**
	 * Wire output payload. Present only for tasks in the `COMPLETE`
	 * state; absent for in-progress states and (in a later slice)
	 * `FAILED`.
	 */
	readonly output?: LuauExecutionTaskOutputWire | undefined;
	/** Resource path; one of the four x-aep-resource path formats. */
	readonly path: string;
	/**
	 * Wire enum narrowed to the variants the current parser slice accepts.
	 * Later slices widen this union as `FAILED` is folded in.
	 */
	readonly state: "CANCELLED" | "COMPLETE" | "PROCESSING" | "QUEUED";
	/** ISO timestamp of the most recent state change. */
	readonly updateTime: string;
	/** Identifier of the user that owns the API key used to create this task. */
	readonly user: string;
}
