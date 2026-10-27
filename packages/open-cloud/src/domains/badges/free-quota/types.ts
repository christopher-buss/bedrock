/**
 * Parameters for reading how many badges a universe can still create free
 * of charge today.
 *
 * @since unreleased
 */
export interface GetFreeBadgeQuotaParameters {
	/** Stringified ID of the universe whose free badge quota is read. */
	readonly universeId: string;
}
