import type { ResourceCurrentState, ResourceDesiredState } from "./resources.ts";

/**
 * A name Roblox's text filter changed between what bedrock sent and what
 * Roblox stored.
 */
export interface ModeratedName {
	/** Name Roblox stored after its text filter. */
	readonly stored: string;
	/** Name bedrock sent. */
	readonly submitted: string;
}

/**
 * Compares the name an applied developer product recorded with the name its
 * desired state asked for. Roblox's text filter can replace a product name
 * (for example with `####`) and still accept the write.
 *
 * @param desired - Desired state the apply submitted.
 * @param applied - Current state the driver recorded after the apply.
 * @returns The submitted and stored names when they differ for a developer
 *   product; otherwise `undefined`.
 */
export function findModeratedName(
	desired: ResourceDesiredState,
	applied: ResourceCurrentState,
): ModeratedName | undefined {
	if (desired.kind !== "developerProduct" || applied.kind !== "developerProduct") {
		return undefined;
	}

	return applied.name === desired.name
		? undefined
		: { stored: applied.name, submitted: desired.name };
}
