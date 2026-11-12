import type { Result } from "@bedrock-rbx/ocale";

import type { BuildDesiredError } from "./kinds/module.ts";
import { type LiveSnapshot, resourceRobloxId } from "./live-state.ts";
import { extractDisplayNamePrefix } from "./migrate/extract-display-name-prefix.ts";
import type { CreateOperation, Operation } from "./operations.ts";
import type { ResourceCurrentState, ResourceDesiredState } from "./resources.ts";

type UntrackedNameMatch = Extract<BuildDesiredError, { readonly kind: "untrackedNameMatch" }>;

type NameMatch = UntrackedNameMatch["matches"][number];

type NameGuardedKind = NameMatch["kind"];

/** Kinds whose creates the name check guards. */
export const NAME_GUARDED_KINDS: ReadonlyArray<NameGuardedKind> = [
	"badge",
	"developerProduct",
	"gamePass",
];

const COLLECTIONS: Readonly<Record<NameGuardedKind, string>> = {
	badge: "badges",
	developerProduct: "products",
	gamePass: "passes",
};

const HEADING =
	"A planned create has the name of a live item that no Key tracks. Add the importId line to take the item over, or rename the entry:";

type GuardedCreate = CreateOperation & {
	readonly desired: Extract<ResourceDesiredState, { readonly kind: NameGuardedKind }>;
};

/**
 * Refuse every planned create whose name matches a live item that no Key
 * tracks, so taking the item over goes through review instead of a
 * duplicate. A bracketed display-name prefix is removed from both names
 * first. Kinds the live check did not list are not checked.
 *
 * @param inputs - The Environment, its planned Operations, the Current state
 *   that tracks live items, and the live check's lists.
 * @returns Success, or the refusal printing one `importId` line per match.
 */
export function guardCreatesByName({
	environment,
	ops,
	resources,
	snapshot,
}: {
	readonly environment: string;
	readonly ops: ReadonlyArray<Operation>;
	readonly resources: ReadonlyArray<ResourceCurrentState>;
	readonly snapshot: LiveSnapshot;
}): Result<undefined, UntrackedNameMatch> {
	const tracked = new Set(
		resources.map((resource) => `${resource.kind}:${resourceRobloxId(resource)}`),
	);
	const found = ops
		.filter(isGuardedCreate)
		.flatMap((op) => untrackedNamesakes(op, { snapshot, tracked }));
	if (found.length === 0) {
		return { data: undefined, success: true };
	}

	const lines = found.map(({ name, match: { key, kind, robloxId } }) => {
		return `  ${kind}:${key} matches "${name}" (id ${robloxId}): environments.${environment}.${COLLECTIONS[kind]}.${key}.importId "${robloxId}"`;
	});
	return {
		err: {
			kind: "untrackedNameMatch",
			matches: found.map(({ match }) => match),
			message: [HEADING, ...lines].join("\n"),
		},
		success: false,
	};
}

function sameName(live: string, desired: string): boolean {
	return extractDisplayNamePrefix(live).body === extractDisplayNamePrefix(desired).body;
}

function untrackedNamesakes(
	{ key, desired }: GuardedCreate,
	{
		snapshot,
		tracked,
	}: { readonly snapshot: LiveSnapshot; readonly tracked: ReadonlySet<string> },
): ReadonlyArray<{ readonly match: NameMatch; readonly name: string }> {
	const { kind } = desired;
	const live = [...(snapshot[kind] ?? [])];
	return live.flatMap(([robloxId, { name }]) => {
		return name !== undefined &&
			!tracked.has(`${kind}:${robloxId}`) &&
			sameName(name, desired.name)
			? [{ name, match: { key, kind, robloxId } }]
			: [];
	});
}

function isGuardedCreate(op: Operation): op is GuardedCreate {
	return op.type === "create" && op.desired.kind in COLLECTIONS;
}
