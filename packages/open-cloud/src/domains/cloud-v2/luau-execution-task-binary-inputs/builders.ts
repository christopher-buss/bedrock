import type { HttpRequest } from "../../../client/types.ts";
import type { CreateBinaryInputParameters } from "./types.ts";

/**
 * Builds a `POST` request for the Open Cloud
 * `Cloud_CreateLuauExecutionSessionTaskBinaryInput` endpoint. The
 * server responds with a presigned `uploadUri` and the resource `path`.
 *
 * @param parameters - Universe identifier and the byte size of the
 *   binary to be uploaded.
 * @returns A pure {@link HttpRequest} describing the create call.
 */
export function buildCreateBinaryInputRequest(
	parameters: CreateBinaryInputParameters,
): HttpRequest {
	const { size, universeId } = parameters;
	return {
		body: { size },
		headers: { "content-type": "application/json" },
		method: "POST",
		url: `/cloud/v2/universes/${universeId}/luau-execution-session-task-binary-inputs`,
	};
}
