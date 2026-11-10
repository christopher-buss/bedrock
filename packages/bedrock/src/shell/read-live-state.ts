import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";

import {
	compareLiveState,
	type LiveSnapshot,
	type MissingLiveResource,
	type OutOfBandEdit,
	type ResourceLiveState,
} from "../core/live-state.ts";
import type { ResourceCurrentState, ResourceKind } from "../core/resources.ts";
import type { DriverRegistry, ResourceDriver } from "../ports/resource-driver.ts";
import type { RobloxAssetId } from "../types/ids.ts";
import type { MissingCredentialError } from "./build-state-port.ts";

/**
 * Live checking for previews and deployments. Supplied Drivers own their
 * authentication; otherwise an Open Cloud credential enables the check.
 * @since unreleased
 * @example
 * ```ts
 * import type { LiveCheckOptions } from "@bedrock-rbx/core";
 * const audit: LiveCheckOptions = { live: true, failOnOutOfBandEdit: true };
 * expect(audit.live).toBe(true);
 * ```
 */
export interface LiveCheckOptions {
	/**
	 * Refuse before any Operation when a managed field differs from saved
	 * State.
	 */
	readonly failOnOutOfBandEdit?: boolean | undefined;
	/** Automatic when omitted; required when true; disabled when false. */
	readonly live?: boolean | undefined;
}

/**
 * An audit refused to overwrite edits made outside bedrock.
 * @since unreleased
 * @example
 * ```ts
 * import { asResourceKey, type OutOfBandEditsError } from "@bedrock-rbx/core";
 * const refusal: OutOfBandEditsError = {
 *     kind: "outOfBandEdits",
 *     edits: [{ key: asResourceKey("vip"), kind: "gamePass",
 *         fields: [{ field: "price", current: 100, live: 120 }] }],
 * };
 * expect(refusal.edits[0]!.fields[0]!.live).toBe(120);
 * ```
 */
export interface OutOfBandEditsError {
	/** Field-level edits that caused the refusal. */
	readonly edits: ReadonlyArray<OutOfBandEdit>;
	/** Stage discriminator. */
	readonly kind: "outOfBandEdits";
}

/**
 * What a live check found before the Diff.
 * @since unreleased
 */
export interface LiveCheck {
	/** Kinds whose complete list was read. */
	readonly checkedKinds: ReadonlyArray<ResourceKind>;
	/** Field-level edits against saved Current state. */
	readonly edits: ReadonlyArray<OutOfBandEdit>;
	/** Tracked resources absent from a checked Kind. */
	readonly missing: ReadonlyArray<MissingLiveResource>;
	/** Kinds left unchecked and the reason for each. */
	readonly skippedKinds: ReadonlyArray<{
		/** Kind left unchecked. */
		readonly kind: ResourceKind;
		/** Why the Kind was skipped. */
		readonly reason: "disabled" | "noCredential" | "unsupported";
	}>;
}

/**
 * A Kind's live list could not be read completely.
 * @since unreleased
 */
export interface LiveCheckError {
	/** The read failure returned by the Driver. */
	readonly cause: OpenCloudError;
	/** Stage discriminator. */
	readonly kind: "liveCheckFailed";
	/** Kind whose list could not be completed. */
	readonly resourceKind: ResourceKind;
}

/**
 * Read Live state once, then compare it with the saved baseline.
 * @param registry - Authenticated Drivers, absent when no credential is available.
 * @param current - Saved Current state after Key renames, optionally with live-check controls.
 * @returns The check report and live comparison baseline, or a read failure.
 * @since unreleased
 */
export async function readLiveStateAsync(
	registry: Partial<DriverRegistry> | undefined,
	current:
		| (LiveCheckOptions & { readonly resources: ReadonlyArray<ResourceCurrentState> })
		| ReadonlyArray<ResourceCurrentState>,
): Promise<
	Result<
		{ readonly check: LiveCheck; readonly resources: ReadonlyArray<ResourceCurrentState> },
		LiveCheckError | MissingCredentialError | OutOfBandEditsError
	>
> {
	const options = "resources" in current ? current : { resources: current };
	if (registry === undefined && options.live === true) {
		return {
			err: { kind: "missingCredential", purpose: "registry", variable: "BEDROCK_API_KEY" },
			success: false,
		};
	}

	const snapshot = await readSnapshotAsync(
		options.live === false ? undefined : registry,
		options.resources,
	);
	if (!snapshot.success) {
		return snapshot;
	}

	const report = liveReport(options.resources, {
		disabled: options.live === false,
		noCredential: registry === undefined,
		snapshot: snapshot.data,
	});
	if (options.failOnOutOfBandEdit === true && report.check.edits.length > 0) {
		return { err: { edits: report.check.edits, kind: "outOfBandEdits" }, success: false };
	}

	return {
		data: report,
		success: true,
	};
}

async function readBadgesAsync(
	driver: ResourceDriver<"badge"> | undefined,
	current: ReadonlyArray<ResourceCurrentState>,
): Promise<
	Result<ReadonlyMap<RobloxAssetId, ResourceLiveState<"badge">>, OpenCloudError> | undefined
> {
	if (driver?.list === undefined) {
		return undefined;
	}

	const listed = await driver.list();
	if (!listed.success) {
		return listed;
	}

	const badges = new Map(listed.data);
	for (const saved of current) {
		if (saved.kind !== "badge" || badges.has(saved.outputs.badgeId)) {
			continue;
		}

		const read = await driver.read?.(saved.outputs.badgeId);
		if (read === undefined) {
			continue;
		}

		if (!read.success) {
			return read;
		}

		if (read.data !== undefined) {
			badges.set(saved.outputs.badgeId, read.data);
		}
	}

	return { data: badges, success: true };
}

function liveReadFailure(
	cause: OpenCloudError,
	resourceKind: ResourceKind,
): Result<never, LiveCheckError> {
	return { err: { cause, kind: "liveCheckFailed", resourceKind }, success: false };
}

async function readSnapshotAsync(
	registry: Partial<DriverRegistry> | undefined,
	current: ReadonlyArray<ResourceCurrentState>,
): Promise<Result<LiveSnapshot, LiveCheckError>> {
	const listed = await registry?.gamePass?.list?.();
	if (listed !== undefined && !listed.success) {
		return liveReadFailure(listed.err, "gamePass");
	}

	const products = await registry?.developerProduct?.list?.();
	if (products !== undefined && !products.success) {
		return liveReadFailure(products.err, "developerProduct");
	}

	const badges = await readBadgesAsync(registry?.badge, current);
	if (badges !== undefined && !badges.success) {
		return liveReadFailure(badges.err, "badge");
	}

	return {
		data: {
			...(listed === undefined ? {} : { gamePass: listed.data }),
			...(products === undefined ? {} : { developerProduct: products.data }),
			...(badges === undefined ? {} : { badge: badges.data }),
		},
		success: true,
	};
}

function skipReason({
	disabled,
	noCredential,
}: {
	readonly disabled: boolean;
	readonly noCredential: boolean;
}): LiveCheck["skippedKinds"][number]["reason"] {
	if (disabled) {
		return "disabled";
	}

	return noCredential ? "noCredential" : "unsupported";
}

function liveReport(
	current: ReadonlyArray<ResourceCurrentState>,
	{
		disabled,
		noCredential,
		snapshot,
	}: {
		readonly disabled: boolean;
		readonly noCredential: boolean;
		readonly snapshot: LiveSnapshot;
	},
): { readonly check: LiveCheck; readonly resources: ReadonlyArray<ResourceCurrentState> } {
	const kinds = ["badge", "developerProduct", "gamePass", "place", "universe"] as const;
	const compared = compareLiveState(current, snapshot);
	return {
		check: {
			checkedKinds: kinds.filter((kind) => snapshot[kind] !== undefined),
			edits: compared.edits,
			missing: compared.missing,
			skippedKinds: kinds
				.filter((kind) => snapshot[kind] === undefined)
				.map((kind) => {
					return {
						kind,
						reason: skipReason({ disabled, noCredential }),
					};
				}),
		},
		resources: compared.resources,
	};
}
