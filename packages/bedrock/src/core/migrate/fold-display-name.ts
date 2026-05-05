import {
	ambiguousWarning,
	EMPTY_FRAGMENT,
	type FoldFragment,
	interpretiveWarning,
	isObjectPayload,
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

function interpretiveFragment(named: NamedPlaceConfig): FoldFragment {
	return {
		entryFragment: { displayName: named.name },
		warnings: [
			interpretiveWarning({
				bedrockPath: "universe.displayName",
				mantlePath: `${PLACE_CONFIGURATION_KIND}_${named.key}.name`,
				rule: "start-place-name-to-display-name",
			}),
		],
	};
}

const AMBIGUOUS_MULTIPLE_STARTS: FoldFragment = {
	entryFragment: {},
	warnings: [
		ambiguousWarning(
			"place_*.isStart",
			"Multiple place_<k> resources have inputs.isStart=true; pick one as the canonical start place.",
		),
	],
};

/**
 * Fold the start place's `placeConfiguration_<k>.name` into
 * `universe.displayName`. Non-start places' names are folded onto each
 * place's `displayName` by `foldPlaces`; multiple `isStart: true` places
 * emit one `ambiguous` warning and skip the displayName mapping.
 *
 * @param resources - Mantle resource list for one environment.
 * @returns The folded displayName plus per-rule diagnostics.
 */
export function foldDisplayName(resources: ReadonlyArray<MantleResource>): FoldFragment {
	const starts = startKeys(resources);
	if (starts.length >= 2) {
		return AMBIGUOUS_MULTIPLE_STARTS;
	}

	const [startKey] = starts;
	if (startKey === undefined) {
		return EMPTY_FRAGMENT;
	}

	const startConfigResource = resources.findLast((resource) => {
		return resource.kind === PLACE_CONFIGURATION_KIND && resource.key === startKey;
	});
	if (startConfigResource === undefined) {
		return EMPTY_FRAGMENT;
	}

	const named = readPlaceConfigName(startConfigResource);
	return named === undefined ? EMPTY_FRAGMENT : interpretiveFragment(named);
}
