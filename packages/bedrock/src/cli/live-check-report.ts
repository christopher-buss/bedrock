import { safeStringify } from "../core/error-chain.ts";
import { NAME_GUARDED_KINDS } from "../core/name-guard.ts";
import type { DiffPreview } from "../shell/preview-diff.ts";
import type { ClackPort } from "./render.ts";

/**
 * Render Out-of-band edits independently of ordinary Drift.
 * @param preview - Read-only diff result.
 * @param clack - Output port.
 * @returns Whether the live check found edits.
 * @since 0.5.0
 */
export function renderLiveCheck(
	preview: Pick<DiffPreview, "environment" | "liveCheck">,
	clack: ClackPort,
): boolean {
	const check = preview.liveCheck;
	if (check === undefined) {
		return false;
	}

	if (check.edits.length > 0) {
		clack.logMessage(`Out-of-band edits for "${preview.environment}":`);
		for (const edit of check.edits) {
			for (const field of edit.fields) {
				clack.logMessage(
					`~ ${edit.kind}:${edit.key} ${field.field}: ${safeStringify(field.current)} -> ${safeStringify(field.live)}`,
				);
			}
		}
	} else if (check.checkedKinds.length > 0 && check.missing.length === 0) {
		clack.logSuccess(`No out-of-band edits for "${preview.environment}"`);
	}

	for (const missing of check.missing) {
		clack.logMessage(
			`! ${missing.kind}:${missing.key} missing on Roblox (id ${missing.robloxId}); saved Current state retained`,
		);
	}

	renderCheckedKinds(check, clack);
	return check.edits.length > 0 || check.missing.length > 0;
}

function skipDescription({
	kind,
	reason,
}: NonNullable<DiffPreview["liveCheck"]>["skippedKinds"][number]): string {
	if (reason === "disabled") {
		return "disabled";
	}

	if (reason === "noCredential") {
		return "no Open Cloud credential";
	}

	return kind === "place" || kind === "universe" ? "no metadata read" : "no list";
}

function nameCheckNote(check: NonNullable<DiffPreview["liveCheck"]>): string {
	const guarded = new Set<string>(NAME_GUARDED_KINDS);
	const unguarded = check.skippedKinds
		.map(({ kind }) => kind)
		.filter((kind) => guarded.has(kind));
	return unguarded.length === 0
		? ""
		: ` Name check skipped for ${unguarded.join(", ")}: planned creates are not checked against untracked live items.`;
}

function renderCheckedKinds(check: NonNullable<DiffPreview["liveCheck"]>, clack: ClackPort): void {
	const checked =
		check.checkedKinds
			.map((kind) => {
				return kind === "place"
					? "place (metadata only; published content not checked)"
					: kind;
			})
			.join(", ") || "none";
	const skipped =
		check.skippedKinds
			.map(({ kind, reason }) => `${kind} (${skipDescription({ kind, reason })})`)
			.join(", ") || "none";
	clack.logMessage(`Live check: checked ${checked}; skipped ${skipped}.${nameCheckNote(check)}`);
}
