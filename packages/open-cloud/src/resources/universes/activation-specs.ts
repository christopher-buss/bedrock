import { buildGetRequest } from "../../domains/cloud-v2/universes/builders.ts";
import { GET_OPERATION_LIMIT } from "../../domains/cloud-v2/universes/operations.ts";
import { parseUniverseResponse } from "../../domains/cloud-v2/universes/parsers.ts";
import type { GetUniverseParameters, Universe } from "../../domains/cloud-v2/universes/types.ts";
import type { ResourceMethodSpec } from "../../internal/resource-client.ts";

export const GET_SPEC: ResourceMethodSpec<GetUniverseParameters, Universe> = Object.freeze({
	buildRequest: buildGetRequest,
	methodDefaults: {},
	methodKind: "idempotent",
	operationLimit: GET_OPERATION_LIMIT,
	parse: parseUniverseResponse,
});
