import type {
	LuauExecutionTaskRef,
	SubmitAtHeadParameters,
	SubmitAtVersionParameters,
} from "../../domains/cloud-v2/luau-execution-tasks/types.ts";
import { OpenCloudError } from "../../errors/base.ts";
import { RateLimitError } from "../../errors/rate-limit.ts";

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

/**
 * A Luau task submission refused because validated tasks occupy the target
 * place's execution capacity.
 *
 * @since unreleased
 */
export class LuauExecutionCapacityError extends OpenCloudError {
	/** Validated task references reported as occupying the target place. */
	public readonly blockers: ReadonlyArray<LuauExecutionTaskRef>;
	public override readonly name = "LuauExecutionCapacityError";

	/**
	 * Creates a capacity failure from validated blocker references.
	 *
	 * @param blockers - Tasks reported as occupying the submitted place.
	 */
	constructor(blockers: ReadonlyArray<LuauExecutionTaskRef>) {
		super("Luau execution capacity is occupied", { code: "RESOURCE_EXHAUSTED" });
		this.blockers = Object.freeze([...blockers]);
	}
}

/**
 * Converts a positively identified Luau capacity response into its typed
 * error.
 *
 * @param error - The response error to inspect.
 * @param parameters - The submitted target used to validate blocker refs.
 * @returns A typed capacity error, or `undefined` without positive evidence.
 */
export function capacityErrorFrom(
	error: OpenCloudError,
	parameters: SubmitAtHeadParameters | SubmitAtVersionParameters,
): LuauExecutionCapacityError | undefined {
	if (!(error instanceof RateLimitError) || error.code !== "RESOURCE_EXHAUSTED") {
		return undefined;
	}

	const message = capacityMessage(error.details);
	if (message === undefined) {
		return undefined;
	}

	const blockers = blockerRefsFrom(message, parameters);
	return blockers.length === 0 ? undefined : new LuauExecutionCapacityError(blockers);
}

function capacityMessage(details: JSONValue | undefined): string | undefined {
	if (details === null || typeof details !== "object" || Array.isArray(details)) {
		return undefined;
	}

	const code = Reflect.get(details, "code");
	const message = Reflect.get(details, "message");
	return code === "RESOURCE_EXHAUSTED" && typeof message === "string" ? message : undefined;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function taskRefKey(ref: LuauExecutionTaskRef): string {
	return `${ref.versionId}/${ref.sessionId}/${ref.taskId}`;
}

function compareTaskRefs(left: LuauExecutionTaskRef, right: LuauExecutionTaskRef): number {
	return taskRefKey(left).localeCompare(taskRefKey(right));
}

function blockerRefsFrom(
	message: string,
	parameters: SubmitAtHeadParameters | SubmitAtVersionParameters,
): ReadonlyArray<LuauExecutionTaskRef> {
	const universeId = escapeRegExp(parameters.universeId);
	const placeId = escapeRegExp(parameters.placeId);
	const pattern = new RegExp(
		`universes/(${universeId})/places/(${placeId})/versions/([1-9][0-9]*)/luau-execution-sessions/(${UUID_PATTERN})/tasks/(${UUID_PATTERN})`,
		"giu",
	);
	const unique = new Map<string, LuauExecutionTaskRef>();
	for (const match of message.matchAll(pattern)) {
		const [, matchedUniverseId, matchedPlaceId, versionId, sessionId, taskId] = match;
		if (
			matchedUniverseId === undefined ||
			matchedPlaceId === undefined ||
			versionId === undefined ||
			sessionId === undefined ||
			taskId === undefined
		) {
			continue;
		}

		const ref = Object.freeze({
			placeId: matchedPlaceId,
			sessionId,
			taskId,
			universeId: matchedUniverseId,
			versionId,
		});
		unique.set(taskRefKey(ref), ref);
	}

	return Object.freeze([...unique.values()].toSorted(compareTaskRefs));
}
