import type { Result } from "@bedrock-rbx/ocale";

import { ArkErrors, type } from "arktype";

import type { ResourceKey, Sha256Hex } from "../types/ids.ts";
import type { ResourceCurrentState, ResourceRealDisplay } from "./resources.ts";
import type { BedrockState, StateError } from "./state.ts";

// Resource-level validation is intentionally shallow: every resource must be
// an object with a known `kind` discriminator, but per-kind field validation
// (game-pass vs place vs universe) is deferred. Bedrock is both the writer
// and the reader of state files, so tampering is out of scope for v0.1;
// a follow-up issue widens this to full per-kind schema + brand narrowing.
const resourceShape = type({
	"key": "string",
	"[string]": "unknown",
	"kind": "'developerProduct' | 'gamePass' | 'place' | 'universe'",
	"outputs": "object",
});

// `codegenHash` is constrained to the `Sha256Hex` shape (64 lowercase hex
// chars) at the schema boundary so a malformed digest from old tooling or a
// manual edit is rejected as an untrusted state file rather than branded and
// fed into the rebuild-decision comparison.
const envelopeSchema = type({
	$bedrock: {
		"codegenHash?": "/^[0-9a-f]{64}$/",
		"pendingRebuild?": "string[]",
		"version": "1",
	},
	environment: "string",
	resources: resourceShape.array(),
});

/**
 * Project the `realDisplay` map onto the resources array for serialization,
 * attaching each covered resource's real display values as an adapter-private
 * `$realDisplay` sibling. A resource the map does not cover is returned by
 * reference unchanged, never with an `$realDisplay: undefined` key, which
 * `JSON.stringify` would erase but `parseStateFile` and equality checks would
 * not. Exported for direct unit coverage of that distinction.
 *
 * @param resources - The persisted resources, in state-file order.
 * @param realDisplay - The `kind:key`-keyed real-display map, or `undefined`
 *   when nothing is redacted (the resources are returned untouched).
 * @returns The resources, each covered one carrying its `$realDisplay` sibling.
 */
export function coLocateRealDisplay(
	resources: ReadonlyArray<ResourceCurrentState>,
	realDisplay: Readonly<Record<string, ResourceRealDisplay>> | undefined,
): ReadonlyArray<unknown> {
	if (realDisplay === undefined) {
		return resources;
	}

	return resources.map((resource) => {
		const real = realDisplay[`${resource.kind}:${resource.key}`];
		return real === undefined ? resource : { ...resource, $realDisplay: real };
	});
}

/**
 * Serialize a {@link BedrockState} to the on-disk JSON representation used by
 * state-port adapters.
 *
 * The on-disk shape wraps the in-memory state with a
 * `$bedrock: { version: N }` envelope so that a future breaking change to the
 * schema can be detected and rejected at parse time rather than silently
 * accepted. The top-level `version` field is not duplicated on disk.
 *
 * A non-empty `pendingRebuild` set is written as a `pendingRebuild` list of
 * keys alongside `version` inside the envelope; an empty or absent set is
 * omitted so a happy-path file never shows the marker. A present `codegenHash`
 * is likewise stored alongside `version`; an absent one is omitted.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { serializeStateFile, type BedrockState } from "@bedrock-rbx/core";
 *
 * const state: BedrockState = {
 *     environment: "production",
 *     resources: [],
 *     version: 1,
 * };
 *
 * const wire = serializeStateFile(state);
 * expect(JSON.parse(wire)).toStrictEqual({
 *     $bedrock: { version: 1 },
 *     environment: "production",
 *     resources: [],
 * });
 * ```
 *
 * @param state - The in-memory state snapshot to serialize.
 * @returns A pretty-printed JSON string ready to hand to a state adapter's write method.
 */
export function serializeStateFile(state: BedrockState): string {
	const envelope = {
		$bedrock: bedrockMeta(state),
		environment: state.environment,
		resources: coLocateRealDisplay(state.resources, state.realDisplay),
	};
	return JSON.stringify(envelope, undefined, 2);
}

/**
 * Parse a raw on-disk state file into a {@link BedrockState}.
 *
 * A backend that reports "no state file for this environment yet" must pass
 * `undefined`: that distinguishes a legitimate first deploy from a file that
 * exists but cannot be trusted.
 *
 * A `pendingRebuild` list inside the envelope is hydrated back into the typed
 * set; an absent or empty list leaves the field off the parsed state. A
 * pre-existing v1 file without the field parses unchanged.
 *
 * @since 0.1.0
 *
 * @example
 *
 * ```ts
 * import { parseStateFile } from "@bedrock-rbx/core";
 *
 * const freshStart = parseStateFile(undefined, "gist:abc123/state.production.json");
 * expect(freshStart.success).toBeTrue();
 * if (freshStart.success) {
 *     expect(freshStart.data).toBeUndefined();
 * }
 * ```
 *
 * @param raw - Raw file contents as a string, or `undefined` when the
 * backend reports no file exists yet.
 * @param file - Adapter-specific identifier included in any `StateError`
 * surfaced during parsing.
 * @returns `Ok(undefined)` for a missing file, `Ok(state)` for a parseable
 * file, or `Err(StateError)` for anything that cannot be trusted.
 */
export function parseStateFile(
	raw: string | undefined,
	file: string,
): Result<BedrockState | undefined, StateError> {
	if (raw === undefined) {
		return { data: undefined, success: true };
	}

	const parsed = parseJson(raw, file);
	if (!parsed.success) {
		return parsed;
	}

	const validated = envelopeSchema(parsed.data);
	if (validated instanceof ArkErrors) {
		return errState(file, `invalid state file: ${validated.summary}`);
	}

	return { data: toState(validated), success: true };
}

function bedrockMeta(state: BedrockState): {
	codegenHash?: Sha256Hex;
	pendingRebuild?: ReadonlyArray<ResourceKey>;
	version: 1;
} {
	const { codegenHash, pendingRebuild, version } = state;
	const marker =
		pendingRebuild === undefined || pendingRebuild.size === 0
			? {}
			: { pendingRebuild: [...pendingRebuild] };
	const hash = codegenHash === undefined ? {} : { codegenHash };
	return { ...hash, ...marker, version };
}

function splitRealDisplay(rawResources: typeof envelopeSchema.infer.resources): {
	realDisplay: Record<string, ResourceRealDisplay> | undefined;
	resources: ReadonlyArray<ResourceCurrentState>;
} {
	const realDisplay: Record<string, ResourceRealDisplay> = {};
	const resources = rawResources.map((raw) => {
		const { $realDisplay, ...rest } = raw;
		if ($realDisplay !== undefined) {
			realDisplay[`${rest.kind}:${rest.key}`] = $realDisplay as ResourceRealDisplay;
		}

		return rest as unknown as ResourceCurrentState;
	});

	return {
		realDisplay: Object.keys(realDisplay).length > 0 ? realDisplay : undefined,
		resources,
	};
}

function toState(validated: typeof envelopeSchema.infer): BedrockState {
	const { realDisplay, resources } = splitRealDisplay(validated.resources);
	const pendingKeys = validated.$bedrock.pendingRebuild;
	const pendingRebuild =
		pendingKeys === undefined || pendingKeys.length === 0
			? undefined
			: new Set(pendingKeys as unknown as ReadonlyArray<ResourceKey>);
	const codegenHash = validated.$bedrock.codegenHash as Sha256Hex | undefined;

	return {
		...(codegenHash === undefined ? {} : { codegenHash }),
		environment: validated.environment,
		...(pendingRebuild === undefined ? {} : { pendingRebuild }),
		...(realDisplay === undefined ? {} : { realDisplay }),
		resources,
		version: 1,
	};
}

function parseJson(raw: string, file: string): Result<JSONValue, StateError> {
	try {
		return { data: JSON.parse(raw), success: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			err: { file, kind: "stateError", reason: `malformed JSON: ${message}` },
			success: false,
		};
	}
}

function errState(file: string, reason: string): Result<BedrockState | undefined, StateError> {
	return {
		err: { file, kind: "stateError", reason },
		success: false,
	};
}
