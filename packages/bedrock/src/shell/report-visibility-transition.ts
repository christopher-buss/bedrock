import type { OpenCloudError, Result } from "@bedrock-rbx/ocale";

import type { ResourceKey } from "../types/ids.ts";
import type { ApplyOpsReporting } from "./apply-ops.ts";

interface Reporting {
	readonly key: ResourceKey;
	readonly reporting: ApplyOpsReporting | undefined;
}

const VISIBILITY_OP = { opType: "update", resourceKind: "universe" } as const;

/**
 * Report the start of a transition against its requested resource key.
 * @param input - Resource identity and optional progress sink.
 */
export function reportVisibilityStarted({ key, reporting }: Reporting): void {
	if (reporting !== undefined) {
		reporting.progress.emit({
			...VISIBILITY_OP,
			key,
			environment: reporting.environment,
			kind: "resourceOpStarted",
		});
	}
}

/**
 * Report a confirmed result or unconfirmed failure for that same resource.
 * @param input - Resource identity, optional progress sink, and transition result.
 */
export function reportVisibilityFinished({
	key,
	reporting,
	result,
}: Reporting & { readonly result: Result<undefined, OpenCloudError> }): void {
	if (reporting === undefined) {
		return;
	}

	reporting.progress.emit(
		result.success
			? {
					...VISIBILITY_OP,
					key,
					changedFields: ["visibility"],
					environment: reporting.environment,
					kind: "resourceOpSucceeded",
				}
			: {
					...VISIBILITY_OP,
					key,
					environment: reporting.environment,
					error: { key, cause: result.err, kind: "driverFailure" },
					kind: "resourceOpFailed",
				},
	);
}
