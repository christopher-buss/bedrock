import { buildGetOperationRequest } from "../../domains/assets/assets/builders.ts";
import {
	GET_ASSET_OPERATION_LIMIT,
	WRITE_REQUIRED_SCOPES,
} from "../../domains/assets/assets/operations.ts";
import { parseAssetOperationResponse } from "../../domains/assets/assets/parsers.ts";
import type { GetAssetOperationParameters } from "../../domains/assets/assets/types.ts";
import type { AssetOperation } from "../../domains/assets/assets/wire.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { IDEMPOTENT_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import {
	okRequest,
	type ResourceClient,
	type ResourceMethodSpec,
} from "../../internal/resource-client.ts";
import type { Result } from "../../types.ts";
import { withRequestDeadline } from "../luau-execution/polling-helpers.ts";
import { pollUntilDoneCoreAsync, type PollUntilDoneOptions } from "../luau-execution/polling.ts";
import { AssetOperationError } from "./operation-error.ts";

const GET_OPERATION_SPEC: ResourceMethodSpec<GetAssetOperationParameters, AssetOperation> =
	Object.freeze({
		buildRequest: (parameters: GetAssetOperationParameters) => {
			return okRequest(buildGetOperationRequest(parameters));
		},
		methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
		methodKind: "idempotent",
		operationLimit: GET_ASSET_OPERATION_LIMIT,
		parse: parseAssetOperationResponse,
		requiredScopes: WRITE_REQUIRED_SCOPES,
	});

/**
 * Polls an asset operation until it is done. The poll budget opens once the
 * request that started the operation has answered.
 *
 * @param inner - The client that issues each poll.
 * @param call - The operation the starting request returned and the
 *   caller's poll and per-request options.
 * @param call.options - The caller's poll and per-request options.
 * @param call.started - The operation the starting request returned.
 * @returns The done operation, an {@link AssetOperationError} when it failed,
 *   or the poll failure.
 */
export async function finishAssetOperationAsync(
	inner: ResourceClient,
	{ options, started }: { options: PollUntilDoneOptions; started: AssetOperation },
): Promise<Result<AssetOperation, OpenCloudError>> {
	const finished = started.done
		? { data: started, success: true as const }
		: await pollUntilDoneCoreAsync(
				{
					fetch: async (deadlineMs) => {
						return inner.executeAsync({
							options: withRequestDeadline(options, deadlineMs),
							parameters: { operationId: started.operationId },
							spec: GET_OPERATION_SPEC,
						});
					},
					isDone: (operation) => operation.done,
					now: Date.now,
					sleep: inner.sleep,
				},
				options,
			);
	if (!finished.success || finished.data.error === undefined) {
		return finished;
	}

	const { error, operationId } = finished.data;
	return { err: new AssetOperationError({ ...error, operationId }), success: false };
}
