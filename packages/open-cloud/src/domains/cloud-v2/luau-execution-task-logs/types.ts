import type { LuauExecutionTaskRef } from "../luau-execution-tasks/types.ts";

export type { LuauExecutionTaskRef } from "../luau-execution-tasks/types.ts";

/**
 * Caller-supplied input for listing the structured log messages produced
 * by a previously-submitted Luau execution task.
 *
 * @since 0.1.0
 */
export interface ListLogsParameters {
	/**
	 * Maximum number of log messages to return per page. The server
	 * clamps this to the range [1, 10000]. When omitted, the server
	 * applies its own default page size.
	 */
	readonly pageSize?: number | undefined;
	/**
	 * Opaque continuation token returned by the previous `listLogs`
	 * call. Pass this to retrieve the next page of results.
	 */
	readonly pageToken?: string | undefined;
	/** Reference to the task whose logs are being listed. */
	readonly ref: LuauExecutionTaskRef;
}

/**
 * A single structured log message produced by a Luau execution task.
 * The `createTime` field is a raw ISO timestamp string, not a
 * {@link Date}, so it can be serialized without conversion.
 *
 * @since 0.1.0
 */
export interface LogMessage {
	/** ISO timestamp when the log message was produced. */
	readonly createTime: string;
	/** Human-readable log message text. */
	readonly message: string;
	/**
	 * Categorical message type. The wire `MESSAGE_TYPE_UNSPECIFIED`
	 * sentinel is rejected by the parser and never surfaces here.
	 */
	readonly messageType: "ERROR" | "INFO" | "OUTPUT" | "WARNING";
}

/**
 * One page of structured log messages from a Luau execution task.
 * Chunks are flattened by the parser; consumers see a single ordered
 * array. When `nextPageToken` is present, pass it to the next
 * `listLogs` call to retrieve the following page.
 *
 * @since 0.1.0
 */
export interface LogPage {
	/** Flattened, ordered list of log messages from this page. */
	readonly messages: ReadonlyArray<LogMessage>;
	/**
	 * Opaque token for the next page of results. `undefined` when this
	 * is the last page.
	 */
	readonly nextPageToken?: string | undefined;
}
