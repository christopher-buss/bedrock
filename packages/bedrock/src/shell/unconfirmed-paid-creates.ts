import type { ImportDeclaration } from "../core/import-current.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { BedrockState } from "../core/state.ts";
import { blockingUnconfirmed } from "../core/unconfirmed-paid-creates.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";

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
