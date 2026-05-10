/**
 * Caller-supplied input for creating a Luau execution task binary input
 * upload slot. The server returns a presigned `uploadUri` the caller uses
 * to PUT the binary data.
 */
export interface CreateBinaryInputParameters {
	/** Size in bytes of the binary data to be uploaded. */
	readonly size: number;
	/** Stringified ID of the universe that owns the task. */
	readonly universeId: string;
}

/**
 * Public representation of a created Luau execution task binary input.
 * Pass `path` verbatim to `tasks.submit({ binaryInput })`.
 */
export interface LuauExecutionTaskBinaryInput {
	/** Server-emitted resource path; pass to `tasks.submit` as `binaryInput`. */
	readonly path: string;
	/** Presigned PUT target; perform the binary upload to this URI directly. */
	readonly uploadUri: string;
}
