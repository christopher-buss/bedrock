// Wire-level shape of the list-luau-execution-task-logs response body
// returned by the Open Cloud `cloud/v2` luau-execution endpoints.
// Internal to the sub-tree; not re-exported.

/**
 * Wire shape of a single structured log message within a
 * {@link LogChunkWire}. The `MESSAGE_TYPE_UNSPECIFIED` sentinel is
 * deliberately excluded; the parser's type guard rejects it at the
 * wire boundary so it never surfaces here.
 */
export interface LogMessageWire {
	/** ISO timestamp when the log message was produced. */
	readonly createTime: string;
	/** Human-readable log message text. */
	readonly message: string;
	/** Wire enum value for the message type. */
	readonly messageType: "ERROR" | "INFO" | "OUTPUT" | "WARNING";
}

/**
 * Wire shape of a single log chunk returned by the Open Cloud
 * list-logs endpoint. The `structuredMessages` array is populated
 * when `view=STRUCTURED` is requested (which is always the case in
 * this SDK). Other wire fields (`path`, FLAT-mode `messages`) exist
 * on the schema but are not modelled here because they are not
 * surfaced on the public `LogPage` type.
 */
export interface LogChunkWire {
	/**
	 * Structured log messages in this chunk. Optional on the wire;
	 * absent when the chunk has no messages.
	 */
	readonly structuredMessages?: ReadonlyArray<LogMessageWire> | undefined;
}

/**
 * Wire shape of the list-luau-execution-task-logs response body. Both
 * fields are optional per the OpenAPI spec
 * (`ListLuauExecutionSessionTaskLogsResponse` has no `required` array);
 * the parser also accepts JSON `null` on either field at the wire
 * boundary and normalizes it to `undefined` / `[]`.
 */
export interface ListLogsResponseWire {
	/**
	 * Array of log chunks. Omitted or JSON `null` on an empty page; the
	 * parser normalizes both to an empty array.
	 */
	readonly luauExecutionSessionTaskLogs?: ReadonlyArray<LogChunkWire> | undefined;
	/**
	 * Opaque continuation token for the next page. Absent or JSON
	 * `null` when this is the last page; the parser normalizes both to
	 * `undefined`.
	 */
	readonly nextPageToken?: string | undefined;
}
