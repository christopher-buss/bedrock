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
 * Read only confirmed visibility, fencing old snapshots behind unresolved
 * intent.
 *
 * @param current - Last-known universe snapshot, if adopted.
 * @param context - The journal and universe identity being reconciled.
 * @returns Its trusted classification, or undefined when it needs reconciliation.
 */
export function lastConfirmedVisibility(
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
