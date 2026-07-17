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

const TITLE_PATTERN = /<title[^>]*>([\S\s]*?)<\/title>/i;
const H1_PATTERN = /<h1[^>]*>([\S\s]*?)<\/h1>/i;
const TAG_PATTERN = /<[^>]*>/g;
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

	return firstTagText(rawText, TITLE_PATTERN) ?? firstTagText(rawText, H1_PATTERN);
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

function firstTagText(html: string, pattern: RegExp): string | undefined {
	const match = pattern.exec(html);
	if (!match) {
		return undefined;
	}

	const inner = match[1] ?? "";
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
