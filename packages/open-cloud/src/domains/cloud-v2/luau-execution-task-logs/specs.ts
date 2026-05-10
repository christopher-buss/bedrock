import { IDEMPOTENT_METHOD_DEFAULTS } from "../../../internal/http/retry.ts";
import type { ResourceMethodSpec } from "../../../internal/resource-client.ts";
import { buildListLogsRequest } from "./builders.ts";
import { LIST_LOGS_OPERATION_LIMIT, LIST_LOGS_REQUIRED_SCOPES } from "./operations.ts";
import { parseListLogsResponse } from "./parsers.ts";
import type { ListLogsParameters, LogPage } from "./types.ts";

function makeSpec<P>(spec: ResourceMethodSpec<P, LogPage>): ResourceMethodSpec<P, LogPage> {
	return Object.freeze(spec);
}

/**
 * Per-method dispatch spec for listing the structured log messages
 * produced by a Luau execution task. Frozen at module scope so both
 * the top-level `LuauExecutionClient` and the `luauExecution` Operation
 * Group on `PlacesClient` share the same instance reference.
 */
export const LIST_LOGS_SPEC = makeSpec<ListLogsParameters>({
	buildRequest: buildListLogsRequest,
	methodDefaults: IDEMPOTENT_METHOD_DEFAULTS,
	methodKind: "idempotent",
	operationLimit: LIST_LOGS_OPERATION_LIMIT,
	parse: parseListLogsResponse,
	requiredScopes: LIST_LOGS_REQUIRED_SCOPES,
});
