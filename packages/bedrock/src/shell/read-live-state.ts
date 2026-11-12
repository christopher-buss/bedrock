import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";

import {
	compareLiveState,
	type LiveSnapshot,
	type MissingLiveResource,
	type OutOfBandEdit,
} from "../core/live-state.ts";
import type { ResourceCurrentState, ResourceKind } from "../core/resources.ts";
import type { DriverRegistry } from "../ports/resource-driver.ts";

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
		readonly reason: "noCredential" | "unsupported";
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
 * @param current - Saved Current state after Key renames.
 * @returns The check report and live comparison baseline, or a read failure.
 * @since unreleased
 */
export async function readLiveStateAsync(
	registry: Partial<DriverRegistry> | undefined,
	current: ReadonlyArray<ResourceCurrentState>,
): Promise<
	Result<
		{ readonly check: LiveCheck; readonly resources: ReadonlyArray<ResourceCurrentState> },
		LiveCheckError
	>
> {
	const snapshot: LiveSnapshot = {};
	const listed = await registry?.gamePass?.list?.();
	if (listed !== undefined) {
		if (!listed.success) {
			return {
				err: { cause: listed.err, kind: "liveCheckFailed", resourceKind: "gamePass" },
				success: false,
			};
		}

		snapshot.gamePass = listed.data;
	}

	return {
		data: liveReport(current, { noCredential: registry === undefined, snapshot }),
		success: true,
	};
}

function liveReport(
	current: ReadonlyArray<ResourceCurrentState>,
	{ noCredential, snapshot }: { readonly noCredential: boolean; readonly snapshot: LiveSnapshot },
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
						reason: noCredential ? "noCredential" : "unsupported",
					};
				}),
		},
		resources: compared.resources,
	};
}
