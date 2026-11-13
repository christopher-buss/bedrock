import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";

import { adoptablePlaces } from "../core/adopt-place.ts";
import { flattenConfig, type RetiredInput } from "../core/flatten.ts";
import {
	collectImports,
	type ImportDeclaration,
	importedBadge,
	importedDeveloperProduct,
	importedGamePass,
	type ImportKind,
	importNotLive,
	importUnreadable,
	pendingImports,
} from "../core/import-current.ts";
import type { BuildDesiredError } from "../core/kinds/module.ts";
import type { ResourceLiveState } from "../core/live-state.ts";
import type {
	ResourceCurrentState,
	ResourceDesiredState,
	ResourceKind,
} from "../core/resources.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { BedrockState, StateError } from "../core/state.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import type { Sha256Hex } from "../types/ids.ts";
import { adoptPlacesAsync, type ImportedResource } from "./adopt-places.ts";
import { buildDesired } from "./build-desired.ts";
import { withImportedState } from "./imported-state-port.ts";
import type { LiveCheckError } from "./read-live-state.ts";
import { storedIconHashAsync } from "./stored-icon-hash.ts";

export type { ImportedResource } from "./adopt-places.ts";

/** Why an import stopped the run before any Operation. */
export type ImportError =
	| LiveCheckError
	| { readonly cause: BuildDesiredError; readonly kind: "buildDesiredFailed" };

/** What an import reads from the run. */
export interface ImportInputs {
	/** Effective config of the Environment, with every overlay. */
	readonly config: ResolvedConfig;
	/** The Environment being reconciled. */
	readonly environment: string;
	/** `false` turns the live check off, and with it place adoption. */
	readonly live?: boolean | undefined;
	/** Reads local icon files to record their hashes. */
	readonly readFile: (path: string) => Promise<Uint8Array>;
	/** Drivers that read Live state, absent without a credential. */
	readonly registry: Partial<DriverRegistry> | undefined;
}

/** State with the imports recorded, and what was imported. */
export interface ImportedState {
	/** The items recorded by this run, in declaration order. */
	readonly imported: ReadonlyArray<ImportedResource>;
	/** Saved State with the imported items added. */
	readonly state: BedrockState;
}

type ImportDesired = Extract<ResourceDesiredState, { readonly kind: ImportKind }>;

type Lookup<K extends ImportKind> =
	| { readonly kind: "found"; readonly live: ResourceLiveState<K> }
	| { readonly kind: "missing"; readonly otherKind: ImportKind | undefined };

/** Kinds whose single read can hold an id declared under another Kind. */
const PROBED_KINDS = ["gamePass", "developerProduct", "badge"] as const;

/**
 * Record each live item the Environment overlay imports as Current state,
 * before any Diff. Nothing is written: the imports reach State with the
 * run's first write.
 *
 * @param inputs - Config, Environment, file reader, and Drivers.
 * @param state - Saved State of the Environment.
 * @returns State with the imports added and what was imported, or the
 *   refusal that stops the run.
 */
export async function importLiveAsync(
	inputs: ImportInputs,
	state: BedrockState | undefined,
): Promise<Result<ImportedState, ImportError>> {
	const pending = pendingImports(
		collectImports(inputs.config, inputs.environment),
		state?.resources ?? [],
	);
	if (!pending.success) {
		return buildFailed(pending.err);
	}

	const recorded = await recordImportsAsync(inputs, pending.data);
	if (!recorded.success) {
		return recorded;
	}

	const adopted = await adoptPlacesAsync(inputs, state?.resources ?? []);
	if (!adopted.success) {
		return adopted;
	}

	const all = [...recorded.data, ...adopted.data];
	return {
		data: {
			imported: all.map(({ imported }) => imported),
			state: withResources(
				{ environment: inputs.environment, version: 1, ...state },
				all.map(({ current }) => current),
			),
		},
		success: true,
	};
}

/**
 * Record the Environment's imports and hand later stages a State port that
 * sees them until the run's first write, which carries them into the backend.
 *
 * @param inputs - Config, Environment, file reader, and Drivers.
 * @param statePort - The Environment's State port.
 * @returns The State port and what was imported, or the refusal.
 */
export async function importIntoStatePortAsync(
	inputs: ImportInputs & { readonly registry: DriverRegistry },
	statePort: StatePort,
): Promise<
	Result<
		{ readonly imported: ReadonlyArray<ImportedResource>; readonly statePort: StatePort },
		ImportError | { readonly cause: StateError; readonly kind: "stateReadFailed" }
	>
> {
	if (
		collectImports(inputs.config, inputs.environment).length === 0 &&
		adoptablePlaces(flattenConfig(inputs.config), []).length === 0
	) {
		return { data: { imported: [], statePort }, success: true };
	}

	const prior = await statePort.read(inputs.environment);
	if (!prior.success) {
		return { err: { cause: prior.err, kind: "stateReadFailed" }, success: false };
	}

	const recorded = await importLiveAsync(inputs, prior.data.state);
	if (!recorded.success) {
		return recorded;
	}

	const { imported, state } = recorded.data;
	return {
		data: {
			imported,
			statePort: withImportedState(statePort, state),
		},
		success: true,
	};
}

function buildFailed(cause: BuildDesiredError): {
	readonly err: ImportError;
	readonly success: false;
} {
	return { err: { cause, kind: "buildDesiredFailed" }, success: false };
}

function withResources(
	state: Partial<BedrockState> & Pick<BedrockState, "environment" | "version">,
	imported: ReadonlyArray<ResourceCurrentState>,
): BedrockState {
	return { ...state, resources: [...(state.resources ?? []), ...imported] };
}

function pairWithDesired(
	declarations: ReadonlyArray<ImportDeclaration>,
	desired: ReadonlyArray<ResourceDesiredState | RetiredInput>,
): ReadonlyArray<readonly [ImportDeclaration, ImportDesired]> {
	return declarations.flatMap((declaration) => {
		// A Key the root retires has no Desired state to import into.
		return desired
			.filter((entry): entry is ImportDesired => {
				return (
					!("retired" in entry) &&
					entry.kind === declaration.kind &&
					entry.key === declaration.key
				);
			})
			.map((entry) => [declaration, entry] as const);
	});
}

function liveReadFailed(
	cause: OpenCloudError,
	resourceKind: ResourceKind,
): { readonly err: LiveCheckError; readonly success: false } {
	return { err: { cause, kind: "liveCheckFailed", resourceKind }, success: false };
}

async function lookUpAsync<K extends ImportKind>(
	registry: Partial<DriverRegistry> | undefined,
	{
		declaration,
		driver,
	}: { readonly declaration: ImportDeclaration; readonly driver: ResourceDriver<K> | undefined },
): Promise<Result<Lookup<K> | undefined, LiveCheckError>> {
	if (driver?.read === undefined) {
		return { data: undefined, success: true };
	}

	const found = await driver.read(declaration.robloxId);
	if (!found.success) {
		return liveReadFailed(found.err, declaration.kind);
	}

	if (found.data !== undefined) {
		return { data: { kind: "found", live: found.data }, success: true };
	}

	for (const otherKind of PROBED_KINDS) {
		if (otherKind === declaration.kind) {
			continue;
		}

		const other = await registry?.[otherKind]?.read?.(declaration.robloxId);
		if (other?.success === false) {
			return liveReadFailed(other.err, otherKind);
		}

		if (other?.data !== undefined) {
			return { data: { kind: "missing", otherKind }, success: true };
		}
	}

	return { data: { kind: "missing", otherKind: undefined }, success: true };
}

async function recordReadAsync<K extends ImportKind>(
	registry: Partial<DriverRegistry> | undefined,
	{
		declaration,
		desired,
		driver,
		record,
	}: {
		readonly declaration: ImportDeclaration;
		readonly desired: ImportDesired;
		readonly driver: ResourceDriver<K> | undefined;
		readonly record: (seen: {
			readonly live: ResourceLiveState<K>;
			readonly storedIconHash: Sha256Hex | undefined;
		}) => Result<ResourceCurrentState, BuildDesiredError>;
	},
): Promise<Result<ResourceCurrentState, ImportError>> {
	const lookup = await lookUpAsync(registry, { declaration, driver });
	if (!lookup.success) {
		return lookup;
	}

	let recorded: Result<ResourceCurrentState, BuildDesiredError>;
	if (lookup.data === undefined) {
		recorded = importUnreadable(declaration);
	} else if (lookup.data.kind === "missing") {
		recorded = importNotLive(declaration, lookup.data.otherKind);
	} else {
		const { live } = lookup.data;
		const storedIconHash = await storedIconHashAsync(driver, { declaration, desired, live });
		recorded = record({ live, storedIconHash });
	}

	return recorded.success ? recorded : buildFailed(recorded.err);
}

async function importOneAsync(
	registry: Partial<DriverRegistry> | undefined,
	{
		declaration,
		desired,
	}: {
		readonly declaration: ImportDeclaration;
		readonly desired: ImportDesired;
	},
): Promise<Result<ResourceCurrentState, ImportError>> {
	switch (desired.kind) {
		case "badge": {
			return recordReadAsync(registry, {
				declaration,
				desired,
				driver: registry?.badge,
				record: (seen) => importedBadge(declaration, { desired, ...seen }),
			});
		}
		case "developerProduct": {
			return recordReadAsync(registry, {
				declaration,
				desired,
				driver: registry?.developerProduct,
				record: (seen) => importedDeveloperProduct(declaration, { desired, ...seen }),
			});
		}
		case "gamePass": {
			return recordReadAsync(registry, {
				declaration,
				desired,
				driver: registry?.gamePass,
				record: (seen) => importedGamePass(declaration, { desired, ...seen }),
			});
		}
	}
}

async function recordImportsAsync(
	inputs: ImportInputs,
	pending: ReadonlyArray<ImportDeclaration>,
): Promise<
	Result<
		ReadonlyArray<{
			readonly current: ResourceCurrentState;
			readonly imported: ImportedResource;
		}>,
		ImportError
	>
> {
	const wanted = new Set(pending.map(({ key, kind }) => `${kind}:${key}`));
	const desired = await buildDesired({
		include: (input) => wanted.has(`${input.kind}:${input.key}`),
		readFile: inputs.readFile,
		resources: flattenConfig(inputs.config),
	});
	if (!desired.success) {
		return buildFailed(desired.err);
	}

	const recorded: Array<{ current: ResourceCurrentState; imported: ImportedResource }> = [];
	for (const [declaration, target] of pairWithDesired(pending, desired.data)) {
		const current = await importOneAsync(inputs.registry, { declaration, desired: target });
		if (!current.success) {
			return current;
		}

		const { key, kind, robloxId } = declaration;
		recorded.push({ current: current.data, imported: { key, kind, robloxId } });
	}

	return { data: recorded, success: true };
}
