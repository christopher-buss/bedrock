import { ApiError } from "../../errors/api-error.ts";
import type { Result } from "../../types.ts";

// Caps the raw body retained when a response cannot be parsed, so a multi-KB
// HTML error page is not surfaced or logged whole.
const MAX_DETAIL_LENGTH = 500;

const CONTENT_TYPE_HEADER = "content-type";

/**
 * The request-level context threaded from the transport into error
 * construction: which call failed and how long it was in flight.
 */
export interface RequestContext {
	/** Wall-clock time the request was in flight, in milliseconds. */
	readonly elapsedMs: number;
	/** HTTP method of the request. */
	readonly method: string;
	/** Fully-qualified URL of the request. */
	readonly url: string;
}

/** Inputs to {@link parseFailureError}. */
export interface ParseFailureArgs {
	/** The `SyntaxError` thrown by the failed `JSON.parse`. */
	readonly cause: Error;
	/** The request that produced the unusable response. */
	readonly context: RequestContext;
	/** The 2xx response whose body would not parse. */
	readonly response: Response;
	/** The raw body text, read once by the transport. */
	readonly text: string;
}

// A small allowlist of response headers worth retaining on an ApiError for
// diagnosis and escalation to Roblox. apis.roblox.com returns `server` (e.g.
// `public-gateway`, or `haproxy` on a load-balancer error page) and
// `x-roblox-edge` on every response; `via`, `x-request-id`, and `cf-ray` are
// standard proxy/CDN request-id headers kept in case an edge adds them. The
// full header set is never retained, to avoid surfacing anything sensitive.
const DIAGNOSTIC_HEADER_ALLOWLIST: ReadonlySet<string> = new Set([
	"cf-ray",
	"server",
	"via",
	"x-request-id",
]);

const DIAGNOSTIC_HEADER_PREFIX = "x-roblox-";

// Only the opening tag is matched; the closing tag is located with indexOf so
// the inner text needs no unbounded pattern, which would backtrack
// super-linearly on a hostile error page.
const TITLE_OPEN_PATTERN = /<title[^>]*>/i;
const H1_OPEN_PATTERN = /<h1[^>]*>/i;
const TAG_PATTERN = /<[^<>]*>/g;
const WHITESPACE_PATTERN = /\s+/g;

/**
 * Extracts a one-line human summary from an HTML gateway error page, or returns
 * `undefined` when the body is not such a page. A load balancer (HAProxy-style)
 * rejects a request before it reaches Open Cloud and answers with an HTML page,
 * not a JSON Open Cloud error; dumping that HTML whole is noise. The body is
 * treated as HTML when the content-type is `text/html` or the trimmed body is
 * tag-led (`<html`/`<!doctype html`), and the summary is taken from the
 * `<title>` (falling back to the first `<h1>`), tags stripped and whitespace
 * collapsed.
 *
 * @param contentType - The response `content-type` header, if present.
 * @param rawText - The raw response body text.
 * @returns The extracted summary, or `undefined` when the body is not an HTML
 *   gateway page (or carries no title/h1 text).
 */
export function extractGatewaySummary(
	contentType: string | undefined,
	rawText: string,
): string | undefined {
	if (!isHtmlBody(contentType, rawText)) {
		return undefined;
	}

	return (
		firstTagText(rawText, { close: "</title>", open: TITLE_OPEN_PATTERN }) ??
		firstTagText(rawText, { close: "</h1>", open: H1_OPEN_PATTERN })
	);
}

/**
 * Filters a lowercased header record down to the diagnostic allowlist: a few
 * named escalation headers plus any `x-roblox-*` header. Keeps errors light and
 * avoids retaining anything sensitive from the full response header set.
 *
 * @param headers - The full header record (lowercased keys).
 * @returns A record containing only the allowlisted headers that were present.
 */
export function pickDiagnosticHeaders(headers: Record<string, string>): Record<string, string> {
	const picked: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (DIAGNOSTIC_HEADER_ALLOWLIST.has(name) || name.startsWith(DIAGNOSTIC_HEADER_PREFIX)) {
			picked[name] = value;
		}
	}

	return picked;
}

/**
 * Converts a `Headers` object to a plain record with lowercased keys.
 *
 * @param headers - The `Headers` instance to convert.
 * @returns A record mapping lowercased header names to their values.
 */
export function headersToRecord(headers: Headers): Record<string, string> {
	return Object.fromEntries(headers);
}

/**
 * Projects a read body to the detail carried on an error: the parsed JSON when
 * it parsed, otherwise the raw text truncated to {@link MAX_DETAIL_LENGTH}.
 *
 * @param text - The raw response body text.
 * @param parsed - The best-effort parse result from the transport's body read.
 * @returns The parsed body, or the truncated raw text on a parse failure.
 */
export function bodyDetail(
	text: string,
	parsed: Result<JSONValue | undefined>,
): JSONValue | undefined {
	return parsed.success ? parsed.data : text.slice(0, MAX_DETAIL_LENGTH);
}

/**
 * Builds the error for a 2xx response whose body could not be parsed as JSON,
 * preserving the parse `cause`, the (truncated) raw body, the declared
 * content-type, and the request that produced it so the failure can be
 * diagnosed after the fact.
 *
 * The received length is on the message rather than only on the error, because
 * `details` retains just the first {@link MAX_DETAIL_LENGTH} characters: for a
 * body that stopped mid-token the head says nothing and the length says
 * everything. A `SyntaxError` position equal to this number is a body the edge
 * cut short, not one the API mis-serialized.
 *
 * @param args - The Response, raw body text, request context, and underlying
 *   parse error.
 * @returns An ApiError carrying the diagnostic context.
 */
export function parseFailureError({ cause, context, response, text }: ParseFailureArgs): ApiError {
	const contentType = response.headers.get(CONTENT_TYPE_HEADER) ?? "unknown";
	return new ApiError(
		`Failed to parse response body (content-type: ${contentType}, ${String(text.length)} chars read)`,
		{
			cause,
			details: text.slice(0, MAX_DETAIL_LENGTH),
			elapsedMs: context.elapsedMs,
			method: context.method,
			responseHeaders: pickDiagnosticHeaders(headersToRecord(response.headers)),
			statusCode: response.status,
			unparsedBodyLength: text.length,
			url: context.url,
		},
	);
}

function firstTagText(html: string, tag: { close: string; open: RegExp }): string | undefined {
	const open = tag.open.exec(html);
	if (open === null) {
		return undefined;
	}

	const start = open.index + open[0].length;
	const end = html.toLowerCase().indexOf(tag.close, start);
	if (end === -1) {
		return undefined;
	}

	const inner = html.slice(start, end);

	const text = inner.replace(TAG_PATTERN, " ").replace(WHITESPACE_PATTERN, " ").trim();
	return text === "" ? undefined : text;
}

function isHtmlBody(contentType: string | undefined, rawText: string): boolean {
	if (contentType?.toLowerCase().includes("text/html") === true) {
		return true;
	}

	const head = rawText.trimStart().toLowerCase();
	return head.startsWith("<html") || head.startsWith("<!doctype html");
}
