import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";

import { flattenConfig, type RetiredInput } from "../core/flatten.ts";
import {
	collectImports,
	type ImportDeclaration,
	importedCurrent,
	importNotLive,
	importUnreadable,
	pendingImports,
} from "../core/import-current.ts";
import type { BuildDesiredError } from "../core/kinds/module.ts";
import type { ResourceLiveState } from "../core/live-state.ts";
import type {
	GamePassDesiredState,
	ResourceCurrentState,
	ResourceDesiredState,
	ResourceKind,
} from "../core/resources.ts";
import type { ResolvedConfig } from "../core/schema.ts";
import type { BedrockState, StateError, StateRecord } from "../core/state.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";
import type { StatePort } from "../ports/state-port.ts";
import { buildDesired } from "./build-desired.ts";
import type { LiveCheckError } from "./read-live-state.ts";

/** Why an import stopped the run before any Operation. */
export type ImportError =
	| LiveCheckError
	| { readonly cause: BuildDesiredError; readonly kind: "buildDesiredFailed" };

/** A live item recorded as Current state by an import. */
export type ImportedResource = Pick<ImportDeclaration, "key" | "kind" | "robloxId">;

/** What an import reads from the run. */
export interface ImportInputs {
	/** Effective config of the Environment, with every overlay. */
	readonly config: ResolvedConfig;
	/** The Environment being reconciled. */
	readonly environment: string;
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
	readonly state: BedrockState | undefined;
}

type Lookup =
	| { readonly kind: "found"; readonly live: ResourceLiveState<"gamePass"> }
	| { readonly kind: "missing"; readonly otherKind: ResourceKind | undefined };

const OTHER_KINDS = ["developerProduct", "badge"] as const;

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

	return {
		data: {
			imported: recorded.data.map(({ imported }) => imported),
			state: withResources(
				{ environment: inputs.environment, version: 1, ...state },
				recorded.data.map(({ current }) => current),
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
	if (collectImports(inputs.config, inputs.environment).length === 0) {
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
): ReadonlyArray<readonly [ImportDeclaration, GamePassDesiredState]> {
	// A Key the root retires has no Desired state to import into.
	const passes = desired.filter((entry): entry is GamePassDesiredState => !("retired" in entry));
	return declarations.flatMap((declaration) => {
		return passes
			.filter(({ key }) => key === declaration.key)
			.map((pass) => [declaration, pass] as const);
	});
}

function recordLookup(
	declaration: ImportDeclaration,
	{
		desired,
		lookup,
	}: { readonly desired: GamePassDesiredState; readonly lookup: Lookup | undefined },
): Result<ResourceCurrentState, BuildDesiredError> {
	if (lookup === undefined) {
		return importUnreadable(declaration);
	}

	return lookup.kind === "missing"
		? importNotLive(declaration, lookup.otherKind)
		: importedCurrent(declaration, { desired, live: lookup.live });
}

function liveReadFailed(
	cause: OpenCloudError,
	resourceKind: ResourceKind,
): { readonly err: LiveCheckError; readonly success: false } {
	return { err: { cause, kind: "liveCheckFailed", resourceKind }, success: false };
}

async function lookUpAsync(
	registry: Partial<DriverRegistry> | undefined,
	declaration: ImportDeclaration,
): Promise<Result<Lookup | undefined, LiveCheckError>> {
	const driver = registry?.[declaration.kind];
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

	for (const otherKind of OTHER_KINDS) {
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

async function importOneAsync(
	registry: Partial<DriverRegistry> | undefined,
	{
		declaration,
		desired,
	}: {
		readonly declaration: ImportDeclaration;
		readonly desired: GamePassDesiredState;
	},
): Promise<Result<ResourceCurrentState, ImportError>> {
	const lookup = await lookUpAsync(registry, declaration);
	if (!lookup.success) {
		return lookup;
	}

	const recorded = recordLookup(declaration, { desired, lookup: lookup.data });
	return recorded.success ? recorded : buildFailed(recorded.err);
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

function withImportedState(statePort: StatePort, imported: BedrockState | undefined): StatePort {
	let written = false;
	async function readAsync(environment: string): ReturnType<StatePort["read"]> {
		const read = await statePort.read(environment);
		if (written || !read.success) {
			return read;
		}

		// The imports are unsaved; the read version still fences the first write.
		// eslint-disable-next-line ts/no-unsafe-type-assertion -- an absent version may now carry State.
		return { data: { ...read.data, state: imported } as StateRecord, success: true };
	}

	async function writeAsync(
		...args: Parameters<StatePort["write"]>
	): ReturnType<StatePort["write"]> {
		written = true;
		return statePort.write(...args);
	}

	return { read: readAsync, write: writeAsync };
}
