/**
 * Identifies the experience to make public.
 *
 * @since 0.4.0
 */
export interface ActivateUniverseParameters {
	/** Stringified ID of the universe to activate. */
	readonly universeId: string;
}

/**
 * Identifies the experience to make private.
 *
 * @since 0.4.0
 */
export interface DeactivateUniverseParameters {
	/** Stringified ID of the universe to deactivate. */
	readonly universeId: string;
}
