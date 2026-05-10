// Wire-level shape of the LuauExecutionSessionTaskBinaryInput response
// returned by the Open Cloud create endpoint. Internal; not re-exported.

/** Wire shape of the binary-input create response body. */
export interface LuauExecutionTaskBinaryInputWire {
	/** Resource path the server assigned to this binary input slot. */
	readonly path: string;
	/** Byte size echoed back from the request. */
	readonly size?: number | undefined;
	/** Presigned PUT URI the caller uses to upload the binary data. */
	readonly uploadUri: string;
}
