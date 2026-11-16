import type { BuildDesiredError } from "../shell/build-desired.ts";

/**
 * Describe why building the desired state failed.
 *
 * @param cause - The build-desired failure.
 * @returns The detail that follows "build desired state failed".
 */
export function buildDesiredDetail(cause: BuildDesiredError): string {
	switch (cause.kind) {
		case "fileReadFailed": {
			return `for '${cause.key}' (${cause.filePath}): ${cause.reason}`;
		}
		case "iconRemovalRejected":
		case "retirementRejected": {
			return `for '${cause.key}': ${cause.message}`;
		}
		case "importRejected":
		case "orphanRejected":
		case "renameRejected":
		case "untrackedNameMatch": {
			return cause.message;
		}
		case "redactedNameCollision": {
			const [first, second] = cause.keys;
			return `for '${first}' and '${second}': ${cause.message}`;
		}
	}
}
