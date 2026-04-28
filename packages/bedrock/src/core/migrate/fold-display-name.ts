import {
	EMPTY_FRAGMENT,
	type FoldFragment,
	isObjectPayload,
	mergeFragment,
} from "./fold-universe-shared.ts";
import type { MantleResource } from "./types.ts";

const PLACE_KIND = "place";
const PLACE_CONFIGURATION_KIND = "placeConfiguration";

interface NamedPlaceConfig {
	readonly key: string;
	readonly name: string;
}

function readPlaceConfigName(resource: MantleResource): NamedPlaceConfig | undefined {
	if (!isObjectPayload(resource.inputs)) {
		return undefined;
	}

	const { name } = resource.inputs;
	return typeof name === "string" ? { key: resource.key, name } : undefined;
}

function isStartPlace(resource: MantleResource): boolean {
	if (resource.kind !== PLACE_KIND || !isObjectPayload(resource.inputs)) {
		return false;
	}

	return resource.inputs["isStart"] === true;
}

function startKeys(resources: ReadonlyArray<MantleResource>): ReadonlyArray<string> {
	return resources.filter(isStartPlace).map((resource) => resource.key);
}

function blockedFragment(key: string): FoldFragment {
	return {
		entryFragment: {},
		warnings: [
			{
				kind: "blocked",
				mantlePath: `${PLACE_CONFIGURATION_KIND}_${key}.name`,
				reason: "non-start placeConfiguration.name has no Open Cloud equivalent",
			},
		],
	};
}

function interpretiveFragment(named: NamedPlaceConfig): FoldFragment {
	return {
		entryFragment: { displayName: named.name },
		warnings: [
			{
				bedrockPath: "universe.displayName",
				kind: "interpretive",
				mantlePath: `${PLACE_CONFIGURATION_KIND}_${named.key}.name`,
				rule: "start-place-name-to-display-name",
			},
		],
	};
}

const AMBIGUOUS_MULTIPLE_STARTS: FoldFragment = {
	entryFragment: {},
	warnings: [
		{
			hint: "Multiple place_<k> resources have inputs.isStart=true; pick one as the canonical start place.",
			kind: "ambiguous",
			mantlePath: "place_*.isStart",
		},
	],
};

/**
 * Fold the start place's `placeConfiguration_<k>.name` into
 * `universe.displayName`. Non-start places' names emit `blocked` warnings;
 * multiple `isStart: true` places emit one `ambiguous` warning and skip
 * the displayName mapping (every placeConfiguration name is blocked in
 * that case).
 *
 * @param resources - Mantle resource list for one environment.
 * @returns The folded displayName plus per-rule diagnostics.
 */
export function foldDisplayName(resources: ReadonlyArray<MantleResource>): FoldFragment {
	const namedConfigs = resources
		.filter((resource) => resource.kind === PLACE_CONFIGURATION_KIND)
		.flatMap((resource) => {
			const named = readPlaceConfigName(resource);
			return named === undefined ? [] : [named];
		});

	const starts = startKeys(resources);
	if (starts.length >= 2) {
		return mergeFragment(AMBIGUOUS_MULTIPLE_STARTS, foldAllBlocked(namedConfigs));
	}

	const [startKey] = starts;
	if (startKey === undefined) {
		return foldAllBlocked(namedConfigs);
	}

	return foldFromSingleStart(startKey, namedConfigs);
}

function foldFromSingleStart(
	startKey: string,
	namedConfigs: ReadonlyArray<NamedPlaceConfig>,
): FoldFragment {
	return namedConfigs.reduce<FoldFragment>((accumulator, named) => {
		return mergeFragment(
			accumulator,
			named.key === startKey ? interpretiveFragment(named) : blockedFragment(named.key),
		);
	}, EMPTY_FRAGMENT);
}

function foldAllBlocked(namedConfigs: ReadonlyArray<NamedPlaceConfig>): FoldFragment {
	return namedConfigs.reduce<FoldFragment>(
		(accumulator, named) => mergeFragment(accumulator, blockedFragment(named.key)),
		EMPTY_FRAGMENT,
	);
}
