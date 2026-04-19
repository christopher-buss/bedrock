import type { ResourceCurrentState } from "./resources.ts";

/**
 * In-memory state snapshot for one environment.
 *
 * The on-disk JSON wraps this shape with a `$bedrock: { version: N }` envelope
 * (see ADR-019 § State file format). Adapters flatten the envelope on read and
 * re-wrap it on write; nothing outside an adapter sees the `$bedrock` key.
 *
 * `version` is the literal `1` so a future breaking schema change is a
 * compile-time type shift rather than a silently accepted runtime value.
 */
export interface BedrockState {
	/** Environment name this snapshot belongs to (e.g. `"production"`, `"staging"`). */
	readonly environment: string;
	/** Current state of every resource Bedrock manages in this environment. */
	readonly resources: ReadonlyArray<ResourceCurrentState>;
	/** Schema-version literal; bumped only for breaking changes (ADR-019). */
	readonly version: 1;
}

/**
 * Failure surfaced by a `StatePort` when a state file exists but cannot be
 * trusted: corrupt JSON, schema failure, or an unknown `$bedrock.version`.
 *
 * The `kind` literal `"stateError"` is the discriminator for a future error
 * union that will carry sibling ports' failures; narrow on it, don't
 * `instanceof` it.
 */
export interface StateError {
	/** Adapter-specific path or identifier of the file that failed to parse. */
	readonly file: string;
	/** Discriminator for the future port-error union. */
	readonly kind: "stateError";
	/** Human-readable explanation of why the file could not be trusted. */
	readonly reason: string;
}
