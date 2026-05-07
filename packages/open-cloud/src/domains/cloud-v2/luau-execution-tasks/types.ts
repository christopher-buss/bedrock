/**
 * Caller-supplied input for submitting a Luau Execution task against a
 * place's head version. Submitting against a specific place version uses
 * `SubmitAtVersionParameters` instead.
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
