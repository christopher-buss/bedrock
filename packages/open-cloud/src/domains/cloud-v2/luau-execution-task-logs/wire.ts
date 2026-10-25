// Wire-level shape of the list-luau-execution-task-logs response body
// returned by the Open Cloud `cloud/v2` luau-execution endpoints.
// Internal to the sub-tree; not re-exported.

/**
 * Wire shape of a single structured log message within a
 * {@link LogChunkWire}.
 */
export interface LogMessageWire {
	/** ISO timestamp when the log message was produced. */
	readonly createTime: string;
	/** Human-readable log message text. */
	readonly message: string;
	/** Wire enum value; every message type the OpenAPI schema declares. */
	readonly messageType: "ERROR" | "INFO" | "MESSAGE_TYPE_UNSPECIFIED" | "OUTPUT" | "WARNING";
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
	 * Required for the STRUCTURED view requested by this SDK. The captured
	 * no-print task returns an explicit empty array.
	 */
	readonly structuredMessages: ReadonlyArray<LogMessageWire>;
}

/**
 * Wire shape consumed by the STRUCTURED list parser. The schema leaves
 * both fields optional, but the parser requires the chunks array so a
 * missing or renamed field surfaces drift instead of empty messages.
 */
export interface ListLogsResponseWire {
	/**
	 * Required array of log chunks. Explicit empty arrays are accepted.
	 */
	readonly luauExecutionSessionTaskLogs: ReadonlyArray<LogChunkWire>;
	/**
	 * Opaque continuation token for the next page. Captured final pages
	 * omit this field; explicit JSON null is not a supported variant.
	 */
	readonly nextPageToken?: string | undefined;
}
