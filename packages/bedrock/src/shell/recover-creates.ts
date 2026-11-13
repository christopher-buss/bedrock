import {
	ApiError,
	NetworkError,
	type OpenCloudError,
	RequestDeadlineExceededError,
	type Result,
} from "@bedrock-rbx/ocale";

import type { Except } from "type-fest";

import type { LiveSnapshot } from "../core/live-state.ts";
import {
	recoverBadge,
	recoverDeveloperProduct,
	recoverGamePass,
	type RecoveryLists,
} from "../core/recover-create.ts";
import type { ResourceCurrentState, ResourceDesiredState } from "../core/resources.ts";
import type { ProgressPort } from "../ports/progress-port.ts";
import type {
	DriverRegistry,
	ResourceApplyContext,
	ResourceDriver,
} from "../ports/resource-driver.ts";
import type { RobloxAssetId } from "../types/ids.ts";

/** What create recovery needs from the run. */
export interface CreateRecoveryInputs {
	/** Environment stamped on the recovery event. */
	readonly environment: string;
	/** Sink for the recovery event. */
	readonly progress: ProgressPort;
	/** Live lists read before Apply; a Kind absent here is never recovered. */
	readonly snapshot: LiveSnapshot;
}

type RecoverableKind = "badge" | "developerProduct" | "gamePass";

type Recoverable = Extract<ResourceDesiredState, { kind: RecoverableKind }>;

interface KindRecovery<K extends RecoverableKind> {
	readonly before: RecoveryLists<K>["before"] | undefined;
	readonly idOf: (state: ResourceCurrentState<K>) => RobloxAssetId;
	readonly recover: (
		desired: Extract<ResourceDesiredState, { kind: K }>,
		lists: RecoveryLists<K>,
	) => ResourceCurrentState<K> | undefined;
}

interface Recovery<K extends RecoverableKind>
	extends Except<CreateRecoveryInputs, "snapshot">, Except<KindRecovery<K>, "before"> {
	readonly before: RecoveryLists<K>["before"];
	readonly claimed: Set<RobloxAssetId>;
	readonly driver: ResourceDriver<K>;
	readonly list: NonNullable<ResourceDriver<K>["list"]>;
}

type Created<K extends RecoverableKind> = Result<ResourceCurrentState<K>, OpenCloudError>;

/**
 * Wrap the badge, developer-product and game-pass Drivers so a create that
 * failed with a 5xx, a network failure or a timeout lists its Kind again.
 * When exactly one item with the desired name appeared since the list read
 * before Apply, that item is the create's result and a `createRecovered`
 * event reports it. When the Kind has no list from before Apply, such a
 * failure is returned with a `createRecoveryUnavailable` event. Every other
 * failure is returned unchanged.
 * @param registry - The Drivers Apply will call.
 * @param inputs - The pre-Apply live lists and the progress sink.
 * @returns The registry with recovering creates.
 */
export function recoverCreates(
	registry: DriverRegistry,
	{ environment, progress, snapshot }: CreateRecoveryInputs,
): DriverRegistry {
	const run = { environment, progress };
	return {
		...registry,
		badge: recovering(registry.badge, {
			...run,
			before: snapshot.badge,
			idOf: (state) => state.outputs.badgeId,
			recover: recoverBadge,
		}),
		developerProduct: recovering(registry.developerProduct, {
			...run,
			before: snapshot.developerProduct,
			idOf: (state) => state.outputs.productId,
			recover: recoverDeveloperProduct,
		}),
		gamePass: recovering(registry.gamePass, {
			...run,
			before: snapshot.gamePass,
			idOf: (state) => state.outputs.assetId,
			recover: recoverGamePass,
		}),
	};
}

function isRecoverable(err: OpenCloudError): boolean {
	if (err instanceof ApiError) {
		return err.statusCode >= 500;
	}

	return err instanceof NetworkError || err instanceof RequestDeadlineExceededError;
}

function recovered<K extends RecoverableKind>(
	{ claimed, environment, idOf, progress }: Recovery<K>,
	{ cause, state }: { readonly cause: OpenCloudError; readonly state: ResourceCurrentState<K> },
): Created<K> {
	const robloxId = idOf(state);
	claimed.add(robloxId);
	progress.emit({
		key: state.key,
		cause,
		environment,
		kind: "createRecovered",
		resourceKind: state.kind,
		robloxId,
	});
	return { data: state, success: true };
}

async function createRecoveringAsync<K extends RecoverableKind>(
	recovery: Recovery<K>,
	{
		context,
		desired,
	}: {
		readonly context: ResourceApplyContext | undefined;
		readonly desired: Extract<ResourceDesiredState, { kind: K }>;
	},
): Promise<Created<K>> {
	const { claimed, driver, idOf } = recovery;
	const created = await (context === undefined
		? driver.create(desired)
		: driver.create(desired, context));
	if (created.success) {
		claimed.add(idOf(created.data));
		return created;
	}

	if (!isRecoverable(created.err)) {
		return created;
	}

	const after = await recovery.list();
	const state = after.success
		? recovery.recover(desired, { after: after.data, before: recovery.before, claimed })
		: undefined;
	return state === undefined ? created : recovered(recovery, { cause: created.err, state });
}

function reportingSkippedRecovery<K extends RecoverableKind>(
	driver: ResourceDriver<K>,
	{ environment, progress }: Except<CreateRecoveryInputs, "snapshot">,
): ResourceDriver<K> {
	return {
		...driver,
		create: async (desired, context) => {
			const created = await (context === undefined
				? driver.create(desired)
				: driver.create(desired, context));
			if (!created.success && isRecoverable(created.err)) {
				const { key, kind }: Pick<Recoverable, "key" | "kind"> = desired;
				progress.emit({
					key,
					cause: created.err,
					environment,
					kind: "createRecoveryUnavailable",
					resourceKind: kind,
				});
			}

			return created;
		},
	};
}

function recovering<K extends RecoverableKind>(
	driver: ResourceDriver<K>,
	options: Except<CreateRecoveryInputs, "snapshot"> & KindRecovery<K>,
): ResourceDriver<K> {
	const list = driver.list?.bind(driver);
	const { before } = options;
	if (before === undefined || list === undefined) {
		return reportingSkippedRecovery(driver, options);
	}

	const recovery: Recovery<K> = { ...options, before, claimed: new Set(), driver, list };
	return {
		...driver,
		create: async (desired, context) => createRecoveringAsync(recovery, { context, desired }),
	};
}
