import type { HttpRequest } from "../../../internal/http/types.ts";
import { toBlob } from "../../../internal/utils/to-blob.ts";
import type { BadgePaymentSource, CreateBadgeParameters, UpdateBadgeParameters } from "./types.ts";

/**
 * Builds a `POST` request for the legacy "create badge" endpoint.
 *
 * @param parameters - Fields describing the new badge; optional values
 *   omitted here are left off the multipart payload entirely.
 * @returns A pure {@link HttpRequest} describing the create call.
 */
export function buildCreateRequest(parameters: CreateBadgeParameters): HttpRequest {
	const body = new FormData();
	body.append("name", parameters.name);
	body.append("files", toBlob(parameters.icon));
	if (parameters.description !== undefined) {
		body.append("description", parameters.description);
	}

	if (parameters.isActive !== undefined) {
		body.append("isActive", String(parameters.isActive));
	}

	if (parameters.expectedCost !== undefined) {
		body.append("expectedCost", String(parameters.expectedCost));
	}

	if (parameters.paymentSource !== undefined) {
		body.append("paymentSourceType", String(toPaymentSourceWire(parameters.paymentSource)));
	}

	return {
		body,
		method: "POST",
		url: `/legacy-badges/v1/universes/${parameters.universeId}/badges`,
	};
}

/**
 * Builds a `PATCH` request for the legacy "update badge" endpoint. Every
 * field on `parameters` except the identifier is optional; omitted fields
 * are not appended to the JSON body so the server leaves them unchanged.
 *
 * @param parameters - Identifier plus fields to update.
 * @returns A pure {@link HttpRequest} describing the update call.
 */
export function buildUpdateRequest(parameters: UpdateBadgeParameters): HttpRequest {
	const body: Record<string, boolean | string> = {};
	if (parameters.name !== undefined) {
		body["name"] = parameters.name;
	}

	if (parameters.description !== undefined) {
		body["description"] = parameters.description;
	}

	if (parameters.enabled !== undefined) {
		body["enabled"] = parameters.enabled;
	}

	return {
		body,
		method: "PATCH",
		url: `/legacy-badges/v1/badges/${parameters.badgeId}`,
	};
}

function toPaymentSourceWire(source: BadgePaymentSource): 1 | 2 {
	return source === "User" ? 1 : 2;
}
