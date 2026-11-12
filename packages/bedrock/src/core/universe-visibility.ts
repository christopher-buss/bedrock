import { createHash } from "node:crypto";

import type { flattenConfig } from "./flatten.ts";
import type { ResourceCurrentState } from "./resources.ts";
import type { ResolvedConfig } from "./schema.ts";
import type { BedrockState } from "./state.ts";

/**
 * Identify declarative preparation work without opaque backend or plugin I/O.
 * @param work - Resolved resource and codegen declarations.
 * @returns A fingerprint for matching successful preparation to later work.
 */
export function preparationFingerprint(work: {
	readonly codegen: ResolvedConfig["codegen"];
	readonly resources: ReturnType<typeof flattenConfig>;
}): string {
	return createHash("sha256").update(JSON.stringify(work)).digest("hex");
}

/**
 * Match successful public preparation to its universe and resolved configuration.
 * @param journal - Durable visibility bookkeeping.
 * @param expected - Current universe and configuration fingerprint.
 * @returns Whether that exact preparation is available.
 */
export function matchesVisibilityPreparation(
	journal: BedrockState["universeVisibility"],
	{ fingerprint, universeId }: { fingerprint: string; universeId: string },
): boolean {
	return (
		journal?.universeId === universeId &&
		journal.target === "public" &&
		journal.preparation === fingerprint
	);
}

/**
 * Remove visibility ownership without changing any other managed field.
 * @param resource - A confirmed resource snapshot.
 * @returns The resource with visibility ownership removed.
 */
export function withoutVisibility(resource: ResourceCurrentState): ResourceCurrentState {
	if (resource.kind !== "universe") {
		return resource;
	}

	const { visibility: _visibility, ...rest } = resource;
	return rest;
}

/**
 * Forget an uncertain historical universe before replacing its journal.
 * @param resource - A resource retained in the cumulative snapshot.
 * @param universeId - The universe whose previous transition was unresolved.
 * @returns The resource without an untrustworthy visibility classification.
 */
export function withoutUncertainVisibility(
	resource: ResourceCurrentState,
	universeId: string | undefined,
): ResourceCurrentState {
	return resource.kind === "universe" && resource.universeId === universeId
		? withoutVisibility(resource)
		: resource;
}

/**
 * Replace visibility bookkeeping without leaving an explicit undefined key.
 * @param state - The cumulative environment snapshot.
 * @param journal - Work to retain, or undefined to remove it.
 * @returns A snapshot carrying exactly that journal.
 */
export function withVisibilityJournal(
	{ universeVisibility: _journal, ...rest }: BedrockState,
	journal: BedrockState["universeVisibility"],
): BedrockState {
	return { ...rest, ...(journal === undefined ? {} : { universeVisibility: journal }) };
}

/**
 * Resolve managed visibility using Live classification while preserving intent.
 * @param saved - Saved resources and visibility bookkeeping.
 * @param observation - Live comparison resources and the managed universe.
 * @returns The confirmed classification and retained visibility journal.
 */
export function visibilityBaseline(
	saved: Pick<BedrockState, "resources" | "universeVisibility">,
	{
		liveResources,
		universeId,
	}: {
		readonly liveResources: ReadonlyArray<ResourceCurrentState> | undefined;
		readonly universeId: string;
	},
): {
	readonly confirmed: "private" | "public" | undefined;
	readonly journal: BedrockState["universeVisibility"];
} {
	const live = liveResources?.find(
		(resource) => resource.kind === "universe" && resource.universeId === universeId,
	);
	const current =
		live ??
		saved.resources.find(
			(resource) => resource.kind === "universe" && resource.universeId === universeId,
		);
	const journal = reconcileConfirmedJournal(saved.universeVisibility, live);
	return { confirmed: lastConfirmedVisibility(current, { journal, universeId }), journal };
}

/**
 * Read only confirmed visibility, fencing old snapshots behind unresolved
 * intent.
 *
 * @param current - Last-known universe snapshot, if adopted.
 * @param context - The journal and universe identity being reconciled.
 * @returns Its trusted classification, or undefined when it needs reconciliation.
 */
function lastConfirmedVisibility(
	current: ResourceCurrentState | undefined,
	{ journal, universeId }: { journal: BedrockState["universeVisibility"]; universeId: string },
): "private" | "public" | undefined {
	if (journal?.universeId === universeId) {
		if (journal.status === "intent") {
			return undefined;
		}

		if (journal.status === "confirmed") {
			return journal.target;
		}
	}

	return current?.kind === "universe" ? current.visibility : undefined;
}

/**
 * Replace old confirmations once classified Live visibility is available.
 * @param journal - Saved visibility bookkeeping, including unresolved intent.
 * @param current - The universe with its classified Live visibility.
 * @returns The retained journal, or undefined for an obsolete confirmation.
 */
function reconcileConfirmedJournal(
	journal: BedrockState["universeVisibility"],
	current: ResourceCurrentState | undefined,
): BedrockState["universeVisibility"] {
	if (
		journal?.status === "confirmed" &&
		current?.kind === "universe" &&
		current.visibility !== undefined
	) {
		return undefined;
	}

	return journal;
}
