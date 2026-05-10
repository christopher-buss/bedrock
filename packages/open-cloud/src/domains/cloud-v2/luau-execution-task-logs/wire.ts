// Wire-level shape of the list-luau-execution-task-logs response body
// returned by the Open Cloud `cloud/v2` luau-execution endpoints.
// Internal to the sub-tree; not re-exported.

/**
 * Wire shape of a single structured log message within a
 * {@link LogChunkWire}. The `MESSAGE_TYPE_UNSPECIFIED` sentinel is
 * included here to allow the type guard to reject it.
 */
export interface LogMessageWire {
	/** ISO timestamp when the log message was produced. */
	readonly createTime: string;
	/** Human-readable log message text. */
	readonly message: string;
	/**
	 * Wire enum value for the message type. `MESSAGE_TYPE_UNSPECIFIED`
	 * is modelled so the parser can detect and reject it.
	 */
	readonly messageType: "ERROR" | "INFO" | "MESSAGE_TYPE_UNSPECIFIED" | "OUTPUT" | "WARNING";
}

/**
 * Wire shape of a single log chunk returned by the Open Cloud
 * list-logs endpoint. The `structuredMessages` array is populated
 * when `view=STRUCTURED` is requested (which is always the case in
 * this SDK).
 */
export interface LogChunkWire {
	/**
	 * Resource path for this chunk. Required by the server schema;
	 * not surfaced on the public `LogPage` type because chunks are
	 * flattened before being returned to callers.
	 */
	readonly path: string;
	/**
	 * Structured log messages in this chunk. Optional on the wire;
	 * absent when the chunk has no messages.
	 */
	readonly structuredMessages?: ReadonlyArray<LogMessageWire> | undefined;
}

/**
 * Wire shape of the list-luau-execution-task-logs response body.
 */
export interface ListLogsResponseWire {
	/**
	 * Array of log chunks. Optional on the wire; absent on an empty
	 * page.
	 */
	readonly luauExecutionSessionTaskLogs?: ReadonlyArray<LogChunkWire> | undefined;
	/**
	 * Opaque continuation token for the next page. Absent when this
	 * is the last page.
	 */
	readonly nextPageToken?: string | undefined;
}
