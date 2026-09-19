import { reduceRateLimitTokens } from "./rate-limit-sample.ts";

const ABBREVIATED_WEEKDAYS: ReadonlyArray<string> = [
	"Sun",
	"Mon",
	"Tue",
	"Wed",
	"Thu",
	"Fri",
	"Sat",
];
const ANSI_DATE_PATTERN =
	/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( \d|\d{2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/;
const DELAY_SECONDS_PATTERN = /^\d+$/;
const FIXED_DATE_PATTERN =
	/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
const FULL_WEEKDAY_TO_ABBREVIATED: Readonly<Record<string, string>> = {
	Friday: "Fri",
	Monday: "Mon",
	Saturday: "Sat",
	Sunday: "Sun",
	Thursday: "Thu",
	Tuesday: "Tue",
	Wednesday: "Wed",
};
const MONTHS: ReadonlyArray<string> = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
const OBSOLETE_DATE_PATTERN =
	/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/;

interface HttpDateParts {
	readonly day: number;
	readonly hour: number;
	readonly minute: number;
	readonly month: number;
	readonly second: number;
	readonly weekday: string;
	readonly year: number;
}

interface ResolveRetryGuidanceOptions {
	readonly headers: Readonly<Record<string, string>>;
	readonly nowMs?: number;
	readonly remaining: number | undefined;
}

/**
 * Parses `x-ratelimit-reset` as seconds until quota replenishment. Roblox can
 * report multiple comma-separated windows; the longest valid window is the
 * earliest safe quota retry.
 *
 * @param headerValue - The raw reset value, or `undefined` if missing.
 * @returns The longest reset delay, or `undefined` when absent or invalid.
 */
export function parseQuotaResetSeconds(headerValue: string | undefined): number | undefined {
	return reduceRateLimitTokens(headerValue, (a, b) => Math.max(a, b));
}

/**
 * Parses the standard `Retry-After` header. RFC 9110 permits either a
 * non-negative integer number of seconds or any HTTP-date form. A date is
 * rounded up so a retry never starts before the server's stated instant.
 *
 * @param headerValue - The raw `Retry-After` value, or `undefined` if missing.
 * @param nowMs - Current Unix time in milliseconds, injectable for tests.
 * @returns The delay in seconds, or `undefined` when absent or invalid.
 */
export function parseRetryAfterSeconds(
	headerValue: string | undefined,
	nowMs = Date.now(),
): number | undefined {
	if (headerValue === undefined) {
		return undefined;
	}

	const value = headerValue.trim();
	if (DELAY_SECONDS_PATTERN.test(value)) {
		const seconds = Number(value);
		return Number.isFinite(seconds) ? seconds : undefined;
	}

	const retryAt = parseHttpDate(value, nowMs);
	return retryAt === undefined ? undefined : Math.max(0, Math.ceil((retryAt - nowMs) / 1000));
}

/**
 * Chooses the applicable server-directed delay for one 429 response.
 *
 * @param options - Response headers, remaining quota, and optional clock.
 * @returns The delay in seconds, or `undefined` when caller backoff applies.
 */
export function resolveRetryGuidance({
	headers,
	nowMs,
	remaining,
}: ResolveRetryGuidanceOptions): number | undefined {
	const retryAfter = parseRetryAfterSeconds(headers["retry-after"], nowMs);
	if (remaining !== 0) {
		return retryAfter;
	}

	const quotaReset = parseQuotaResetSeconds(headers["x-ratelimit-reset"]);
	return quotaReset === undefined ? retryAfter : Math.max(retryAfter ?? 0, quotaReset);
}

function httpDateTimestamp(parts: HttpDateParts): number | undefined {
	if (parts.minute > 59 || parts.second > 59) {
		return undefined;
	}

	const date = new Date(0);
	date.setUTCFullYear(parts.year, parts.month, parts.day);
	date.setUTCHours(parts.hour, parts.minute, parts.second, 0);

	const isExactDate =
		date.getUTCDate() === parts.day && ABBREVIATED_WEEKDAYS[date.getUTCDay()] === parts.weekday;
	return isExactDate ? date.getTime() : undefined;
}

function parseAnsiDate(value: string): number | undefined {
	const match = ANSI_DATE_PATTERN.exec(value);
	return match === null
		? undefined
		: httpDateTimestamp({
				day: Number(match[3]),
				hour: Number(match[4]),
				minute: Number(match[5]),
				month: MONTHS.indexOf(String(match[2])),
				second: Number(match[6]),
				weekday: String(match[1]),
				year: Number(match[7]),
			});
}

function parseFixedDate(value: string): number | undefined {
	const match = FIXED_DATE_PATTERN.exec(value);
	return match === null
		? undefined
		: httpDateTimestamp({
				day: Number(match[2]),
				hour: Number(match[5]),
				minute: Number(match[6]),
				month: MONTHS.indexOf(String(match[3])),
				second: Number(match[7]),
				weekday: String(match[1]),
				year: Number(match[4]),
			});
}

function parseObsoleteDate(value: string, nowMs: number): number | undefined {
	const match = OBSOLETE_DATE_PATTERN.exec(value);
	if (match === null) {
		return undefined;
	}

	const currentDate = new Date(nowMs);
	const currentYear = currentDate.getUTCFullYear();
	let year = Math.floor(currentYear / 100) * 100 + Number(match[4]);
	if (year > currentYear + 50) {
		year -= 100;
	}

	return httpDateTimestamp({
		day: Number(match[2]),
		hour: Number(match[5]),
		minute: Number(match[6]),
		month: MONTHS.indexOf(String(match[3])),
		second: Number(match[7]),
		weekday: String(FULL_WEEKDAY_TO_ABBREVIATED[String(match[1])]),
		year,
	});
}

function parseHttpDate(value: string, nowMs: number): number | undefined {
	return parseFixedDate(value) ?? parseObsoleteDate(value, nowMs) ?? parseAnsiDate(value);
}
