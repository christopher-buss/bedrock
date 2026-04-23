import type { HttpRequest, HttpResponse } from "#src/internal/http/types";
import { isRecord } from "#src/internal/utils/is-record";
import { getAjv, type OpenApiValidationMode } from "#tests/conformance/_helpers";
import type { ErrorObject, ValidateFunction } from "ajv";

import { findOperation, type OperationMatch } from "./openapi-operations.ts";

const JSON_MEDIA_TYPE = "application/json";

/**
 * Schema-validation mode for the fake HTTP client. `"off"` (the
 * default) preserves the fake's pre-schema behavior. `"strict"`
 * throws a contract error on the first violation. `"warn"` records
 * violations on `fake.schemaViolations` without throwing, so an
 * existing test can opt in to assertions incrementally.
 */
export type SchemaValidationMode = "off" | "strict" | "warn";

/**
 * A single schema violation surfaced by the fake under `"warn"` mode.
 */
export interface SchemaViolation {
	/** Which side of the exchange failed. */
	readonly direction: "request" | "response";
	/** Human-readable Ajv error messages, or a single reason string. */
	readonly errors: ReadonlyArray<string>;
	/** The HTTP method of the offending request. */
	readonly method: string;
	/** The matched OpenAPI path template, or `undefined` if none matched. */
	readonly pathTemplate: string | undefined;
	/** The concrete request URL. */
	readonly url: string;
}

/**
 * Thrown from the fake client under `"strict"` mode when an outbound
 * request or queued response diverges from the vendored OpenAPI spec.
 * The offending {@link SchemaViolation} is attached for assertion.
 */
export class FakeHttpClientContractError extends Error {
	public override readonly name: string = "FakeHttpClientContractError";
	public readonly violation: SchemaViolation;

	/**
	 * Builds a contract error from the violation it describes.
	 *
	 * @param violation - The schema violation to wrap.
	 */
	constructor(violation: SchemaViolation) {
		super(formatMessage(violation));
		this.violation = violation;
	}
}

/**
 * Validates an outbound request against the matched OpenAPI operation.
 * Currently covers JSON request bodies (`Record<string, unknown>`);
 * FormData and binary bodies are not validated.
 *
 * @param request - The outbound HTTP request.
 * @returns Violations found on the request side.
 */
export function validateRequestContract(request: HttpRequest): Array<SchemaViolation> {
	const match = findOperation(request.method, request.url);
	if (match === undefined) {
		return [noOperationViolation(request)];
	}

	if (!isRecord(request.body)) {
		return [];
	}

	const validator = getValidatorAt({
		keys: ["requestBody", "content", JSON_MEDIA_TYPE, "schema"],
		match,
		method: request.method.toLowerCase(),
		mode: "request",
	});
	return runValidator({ data: request.body, direction: "request", match, request, validator });
}

/**
 * Validates a queued response body against the matched OpenAPI
 * operation's response schema for the response status code (falling
 * back to `default`).
 *
 * @param request - The outbound request the response answers.
 * @param response - The response being validated.
 * @returns Violations found on the response side.
 */
export function validateResponseContract(
	request: HttpRequest,
	response: HttpResponse,
): Array<SchemaViolation> {
	const match = findOperation(request.method, request.url);
	if (match === undefined) {
		return [];
	}

	const validator = pickResponseValidator({
		match,
		method: request.method.toLowerCase(),
		status: response.status,
	});
	return runValidator({
		data: response.body,
		direction: "response",
		match,
		request,
		validator,
	});
}

function formatMessage(violation: SchemaViolation): string {
	const where = violation.pathTemplate ?? "no matching path";
	const head = `${violation.direction} contract violated: ${violation.method} ${where}`;
	return `${head} - ${violation.errors.join("; ")}`;
}

function encodeJsonPointerSegment(segment: string): string {
	return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function getValidatorAt(options: {
	readonly keys: ReadonlyArray<string>;
	readonly match: OperationMatch;
	readonly method: string;
	readonly mode: OpenApiValidationMode;
}): undefined | ValidateFunction {
	const segments = ["paths", options.match.pathTemplate, options.method, ...options.keys].map(
		encodeJsonPointerSegment,
	);
	const pointer = `roblox-openapi#/${segments.join("/")}`;
	return getAjv(options.mode).getSchema(pointer);
}

function violationAt(options: {
	readonly direction: "request" | "response";
	readonly errors: ReadonlyArray<string>;
	readonly pathTemplate: string;
	readonly request: HttpRequest;
}): SchemaViolation {
	return {
		direction: options.direction,
		errors: options.errors,
		method: options.request.method,
		pathTemplate: options.pathTemplate,
		url: options.request.url,
	};
}

function formatError(error: ErrorObject): string {
	const path = error.instancePath === "" ? "(root)" : error.instancePath;
	return `${path} ${error.message ?? "validation failed"}`;
}

function runValidator(options: {
	readonly data: unknown;
	readonly direction: "request" | "response";
	readonly match: OperationMatch;
	readonly request: HttpRequest;
	readonly validator: undefined | ValidateFunction;
}): Array<SchemaViolation> {
	if (options.validator === undefined) {
		return [];
	}

	if (options.validator(options.data)) {
		return [];
	}

	return [
		violationAt({
			direction: options.direction,
			errors: (options.validator.errors ?? []).map(formatError),
			pathTemplate: options.match.pathTemplate,
			request: options.request,
		}),
	];
}

function noOperationViolation(request: HttpRequest): SchemaViolation {
	return {
		direction: "request",
		errors: [`no operation matches ${request.method} ${request.url}`],
		method: request.method,
		pathTemplate: undefined,
		url: request.url,
	};
}

function pickResponseValidator(options: {
	readonly match: OperationMatch;
	readonly method: string;
	readonly status: number;
}): undefined | ValidateFunction {
	const { match, method } = options;
	return (
		getValidatorAt({
			keys: ["responses", String(options.status), "content", JSON_MEDIA_TYPE, "schema"],
			match,
			method,
			mode: "response",
		}) ??
		getValidatorAt({
			keys: ["responses", "default", "content", JSON_MEDIA_TYPE, "schema"],
			match,
			method,
			mode: "response",
		})
	);
}
