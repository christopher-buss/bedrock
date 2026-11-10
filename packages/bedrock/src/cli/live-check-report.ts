import { safeStringify } from "../core/error-chain.ts";
import type { DiffPreview } from "../shell/preview-diff.ts";
import type { ClackPort } from "./render.ts";

/**
 * Render Out-of-band edits independently of ordinary Drift.
 * @param preview - Read-only diff result.
 * @param clack - Output port.
 * @returns Whether the live check found edits.
 * @since unreleased
 */
export function renderLiveCheck(preview: DiffPreview, clack: ClackPort): boolean {
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

function renderCheckedKinds(check: NonNullable<DiffPreview["liveCheck"]>, clack: ClackPort): void {
	const checked = check.checkedKinds.join(", ") || "none";
	const skipped =
		check.skippedKinds
			.map(({ kind, reason }) => {
				return `${kind} (${reason === "noCredential" ? "no Open Cloud credential" : "no list"})`;
			})
			.join(", ") || "none";
	clack.logMessage(`Live check: checked ${checked}; skipped ${skipped}.`);
}
