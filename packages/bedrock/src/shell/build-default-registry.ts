import type { Result } from "@bedrock/ocale";
import { GamePassesClient } from "@bedrock/ocale/game-passes";
import { PlacesClient } from "@bedrock/ocale/places";
import { UniversesClient } from "@bedrock/ocale/universes";

import { createGamePassDriver } from "../adapters/game-pass-driver.ts";
import { createPlaceDriver } from "../adapters/place-driver.ts";
import { createUniverseDriver } from "../adapters/universe-driver.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import { asRobloxAssetId } from "../types/ids.ts";
import type { MissingCredentialError } from "./build-state-port.ts";

/**
 * Failure surfaced when default-constructing a registry needs a config
 * field that is not present. The deploy boundary wraps this in a
 * `DeployError` so the caller sees a typed Result instead of a downstream
 * driver error.
 */
export interface RegistryConfigError {
	/** Suggested fix routed back to the caller. */
	readonly hint: string;
	/** Literal discriminator for narrowing. */
	readonly kind: "registryConfigMissing";
	/** Which config field was missing. */
	readonly missing: "universeId";
}

/** Inputs for {@link buildDefaultRegistry}. */
interface BuildDefaultRegistryDeps {
	/** Resolved project config; supplies `universe.universeId` and is read for nothing else. */
	readonly config: ResolvedConfig;
	/** Reads an environment variable; injected so tests stay free of `process.env`. */
	readonly getEnv: (name: string) => string | undefined;
	/** Reader plumbed into kind-specific drivers that ingest file bytes. */
	readonly readFile: (path: string) => Promise<Uint8Array>;
}

interface AssembleRegistryInputs {
	readonly apiKey: string;
	readonly readFile: (path: string) => Promise<Uint8Array>;
	readonly universeId: ReturnType<typeof asRobloxAssetId>;
}

/**
 * Construct the default `DriverRegistry` from `config.universe.universeId`
 * and `ROBLOX_API_KEY`. Reads the API key via the injected `getEnv` seam
 * and surfaces `missingCredential` or `registryConfigMissing` as typed
 * Results instead of throwing.
 *
 * @example
 *
 * ```ts
 * import { buildDefaultRegistry } from "@bedrock/core";
 *
 * const registry = buildDefaultRegistry({
 *     config: {
 *         environments: { production: {} },
 *         state: { backend: "gist", gistId: "abc" },
 *         universe: { universeId: "1234567890" },
 *     },
 *     getEnv: () => "rbx-test",
 *     readFile: async () => new Uint8Array(),
 * });
 *
 * expect(registry.success).toBeTrue();
 * ```
 *
 * @param deps - Validated config plus credential and file-reader seams.
 * @returns A `DriverRegistry` on success, or a typed Err describing the
 * missing API key or the missing universe declaration.
 */
export function buildDefaultRegistry(
	deps: BuildDefaultRegistryDeps,
): Result<DriverRegistry, MissingCredentialError | RegistryConfigError> {
	const apiKey = deps.getEnv("ROBLOX_API_KEY");
	if (apiKey === undefined) {
		return missingApiKey();
	}

	const rawUniverseId = deps.config.universe?.universeId;
	if (rawUniverseId === undefined) {
		return missingUniverseId();
	}

	return {
		data: assembleRegistry({
			apiKey,
			readFile: deps.readFile,
			universeId: asRobloxAssetId(rawUniverseId),
		}),
		success: true,
	};
}

function missingApiKey(): Result<DriverRegistry, MissingCredentialError> {
	return {
		err: {
			kind: "missingCredential",
			purpose: "registry",
			variable: "ROBLOX_API_KEY",
		},
		success: false,
	};
}

function missingUniverseId(): Result<DriverRegistry, RegistryConfigError> {
	return {
		err: {
			hint: "declare universe.universeId in bedrock.config.ts",
			kind: "registryConfigMissing",
			missing: "universeId",
		},
		success: false,
	};
}

function assembleRegistry(inputs: AssembleRegistryInputs): DriverRegistry {
	const { apiKey, readFile, universeId } = inputs;
	const gamePasses = new GamePassesClient({ apiKey });
	const places = new PlacesClient({ apiKey });
	const universes = new UniversesClient({ apiKey });

	return {
		gamePass: createGamePassDriver({ client: gamePasses, readFile, universeId }),
		place: createPlaceDriver({ client: places, readFile, universeId }),
		universe: createUniverseDriver({ places, universes }),
	};
}
