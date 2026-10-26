/**
 * Identifies the experience to make public.
 *
 * @since unreleased
 */
export interface ActivateUniverseParameters {
	/** Stringified ID of the universe to activate. */
	readonly universeId: string;
}

/**
 * Identifies the experience to make private.
 *
 * @since unreleased
 */
export interface DeactivateUniverseParameters {
	/** Stringified ID of the universe to deactivate. */
	readonly universeId: string;
}
