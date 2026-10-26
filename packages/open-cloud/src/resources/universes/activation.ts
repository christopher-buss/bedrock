import type { RequestOptions } from "../../client/types.ts";
import type { ActivateUniverseParameters } from "../../domains/develop/universes/types.ts";
import { ApiError } from "../../errors/api-error.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { CREATE_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import type { ResourceClient } from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";
import { explainActivationError } from "./activation-error.ts";
import { ACTIVATE_SPEC, DEACTIVATE_SPEC, GET_SPEC } from "./activation-specs.ts";

interface VisibilityCall {
	readonly options: RequestOptions | undefined;
	readonly parameters: ActivateUniverseParameters;
	readonly visibility: "private" | "public";
}

/**
 * Changes visibility and verifies an ambiguous gateway timeout through a read.
 * @param inner - The universe client's shared request pipeline.
 * @param call - The universe, desired visibility and request overrides.
 * @returns A success only when the write or verification confirms it.
 */
export async function setVisibilityAsync(
	inner: ResourceClient,
	{ options, parameters, visibility }: VisibilityCall,
): Promise<Result<undefined, OpenCloudError>> {
	const activating = visibility === "public";
	const result = await inner.executeAsync({
		options: {
			...options,
			retryableStatuses:
				options?.retryableStatuses?.filter((status) => status !== 504) ??
				CREATE_METHOD_DEFAULTS.retryableStatuses,
		},
		parameters,
		refineError: activating ? explainActivationError : undefined,
		spec: activating ? ACTIVATE_SPEC : DEACTIVATE_SPEC,
	});
	if (result.success || !(result.err instanceof ApiError) || result.err.statusCode !== 504) {
		return result;
	}

	const observed = await inner.executeAsync({ options, parameters, spec: GET_SPEC });
	if (observed.success && observed.data.visibility === visibility) {
		return { data: undefined, success: true };
	}

	return result;
}
