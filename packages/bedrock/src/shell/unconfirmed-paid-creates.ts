import type { ImportDeclaration } from "../core/import-current.ts";
import type { ResourceCurrentState } from "../core/resources.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { BedrockState, UnconfirmedPaidCreate } from "../core/state.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";

/**
 * Clear the **Unconfirmed paid creates** the user confirms made no badge.
 *
 * @param state - Saved State of the Environment.
 * @param confirmed - Keys the user confirms Roblox made no badge for.
 * @returns State without those markers.
 */
export function withoutConfirmed(
	state: BedrockState | undefined,
	confirmed: ReadonlyArray<string> | undefined,
): BedrockState | undefined {
	if (state?.unconfirmedPaidCreates === undefined) {
		return state;
	}

	const keys = new Set(confirmed);
	return {
		...state,
		unconfirmedPaidCreates: state.unconfirmedPaidCreates.filter(({ key }) => !keys.has(key)),
	};
}

/**
 * Keep the **Unconfirmed paid creates** that stop a create: those for a
 * declared badge. Importing or adopting a badge clears its marker, so a
 * marked Key is never tracked.
 *
 * @param config - Effective config of the Environment.
 * @param state - Saved State, with or without the imports added.
 * @returns The Unconfirmed paid creates whose Key would be created.
 */
export function blockingUnconfirmed(
	config: ResolvedConfig,
	state: Pick<BedrockState, "unconfirmedPaidCreates"> | undefined,
): ReadonlyArray<UnconfirmedPaidCreate> {
	const declared = new Set(Object.keys(config.badges ?? {}));
	return (state?.unconfirmedPaidCreates ?? []).filter(({ key }) => declared.has(key));
}

/**
 * Find the badge each **Unconfirmed paid create** may have made: the one
 * live badge with the name the create sent. A Key the Environment already
 * imports by id is left to that import. A name no live badge has, or more
 * than one has, finds nothing, and neither does a list that fails. The
 * public list hides disabled badges, so a disabled one is never found.
 *
 * @param inputs - Config, Environment, and the Drivers that list badges.
 * @param search - The imports the Environment declares, and saved State.
 * @returns One import of the found badge per Unconfirmed paid create.
 */
export async function adoptionsAsync(
	{
		config,
		environment,
		registry,
	}: {
		readonly config: ResolvedConfig;
		readonly environment: string;
		readonly registry: Partial<DriverRegistry> | undefined;
	},
	{
		declared,
		state,
	}: {
		readonly declared: ReadonlyArray<ImportDeclaration>;
		readonly state: Pick<BedrockState, "unconfirmedPaidCreates"> | undefined;
	},
): Promise<ReadonlyArray<ImportDeclaration>> {
	const unconfirmed = blockingUnconfirmed(config, state).filter(({ key }) => {
		return declared.every((declaration) => declaration.key !== key);
	});
	if (unconfirmed.length === 0) {
		return [];
	}

	const listed = await registry?.badge?.list?.();
	if (listed?.success !== true) {
		return [];
	}

	const live = [...listed.data];
	return unconfirmed.flatMap(({ key, name }) => {
		const named = live.filter(([, item]) => item.name === name);
		const [only] = named;
		return only !== undefined && named.length === 1
			? [
					{
						key,
						acceptLocalIcon: true,
						environment,
						kind: "badge" as const,
						robloxId: only[0],
					},
				]
			: [];
	});
}

/**
 * Clear the **Unconfirmed paid creates** of the badges a run imported: the
 * import tracks the badge Roblox made, so no create is left to pay for.
 *
 * @param state - State with the imports added.
 * @param imported - The items the run imported.
 * @returns State without the markers of imported badges.
 */
export function withoutImported(
	state: BedrockState,
	imported: ReadonlyArray<ResourceCurrentState>,
): BedrockState {
	if (state.unconfirmedPaidCreates === undefined) {
		return state;
	}

	const badges = new Set(
		imported.filter((resource) => resource.kind === "badge").map(({ key }) => key),
	);
	return {
		...state,
		unconfirmedPaidCreates: state.unconfirmedPaidCreates.filter(({ key }) => !badges.has(key)),
	};
}
