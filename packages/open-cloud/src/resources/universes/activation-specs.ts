import { buildGetRequest } from "../../domains/cloud-v2/universes/builders.ts";
import { GET_OPERATION_LIMIT } from "../../domains/cloud-v2/universes/operations.ts";
import { parseUniverseResponse } from "../../domains/cloud-v2/universes/parsers.ts";
import type { GetUniverseParameters, Universe } from "../../domains/cloud-v2/universes/types.ts";
import {
	buildActivateRequest,
	buildDeactivateRequest,
} from "../../domains/develop/universes/builders.ts";
import {
	ACTIVATE_OPERATION_LIMIT,
	ACTIVATION_REQUIRED_SCOPES,
	DEACTIVATE_OPERATION_LIMIT,
} from "../../domains/develop/universes/operations.ts";
import type {
	ActivateUniverseParameters,
	DeactivateUniverseParameters,
} from "../../domains/develop/universes/types.ts";
import { CREATE_METHOD_DEFAULTS } from "../../internal/http/retry.ts";
import { parseEmptyResponse, type ResourceMethodSpec } from "../../internal/resource-client.ts";

export const GET_SPEC: ResourceMethodSpec<GetUniverseParameters, Universe> = Object.freeze({
	buildRequest: buildGetRequest,
	methodDefaults: {},
	methodKind: "idempotent",
	operationLimit: GET_OPERATION_LIMIT,
	parse: parseUniverseResponse,
});

export const ACTIVATE_SPEC: ResourceMethodSpec<ActivateUniverseParameters, undefined> =
	Object.freeze({
		buildRequest: buildActivateRequest,
		methodDefaults: CREATE_METHOD_DEFAULTS,
		methodKind: "create",
		operationLimit: ACTIVATE_OPERATION_LIMIT,
		parse: parseEmptyResponse,
		requiredScopes: ACTIVATION_REQUIRED_SCOPES,
	});

export const DEACTIVATE_SPEC: ResourceMethodSpec<DeactivateUniverseParameters, undefined> =
	Object.freeze({
		buildRequest: buildDeactivateRequest,
		methodDefaults: CREATE_METHOD_DEFAULTS,
		methodKind: "create",
		operationLimit: DEACTIVATE_OPERATION_LIMIT,
		parse: parseEmptyResponse,
		requiredScopes: ACTIVATION_REQUIRED_SCOPES,
	});
