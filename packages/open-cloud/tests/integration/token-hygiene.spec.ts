import { fromAny } from "@total-typescript/shoehorn";

import { inspect } from "node:util";
import { assert, describe, it } from "vitest";

import { createFetchHttpClient } from "#src/client/fetch-http-client";
import type {
	AdmissionWaitEvent,
	Credential,
	HttpClient,
	OpenCloudHooks,
	RequestOptions,
} from "#src/client/types";
import { ApiError } from "#src/errors/api-error";
import type { OpenCloudError } from "#src/errors/base";
import { CredentialError } from "#src/errors/credential-error";
import { CredentialNotSupportedError } from "#src/errors/credential-not-supported";
import { CredentialRejectedError } from "#src/errors/credential-rejected";
import { NetworkError } from "#src/errors/network-error";
import { PermissionError } from "#src/errors/permission-error";
import { PollAbortedError } from "#src/errors/poll-aborted";
import { PollTimeoutError } from "#src/errors/poll-timeout";
import { RateLimitError } from "#src/errors/rate-limit";
import { RateLimitWaitRefusedError } from "#src/errors/rate-limit-wait-refused";
import { RequestAbortedError } from "#src/errors/request-aborted";
import { RequestDeadlineExceededError } from "#src/errors/request-deadline-exceeded";
import { RetryDelayExceededError } from "#src/errors/retry-delay-exceeded";
import { ValidationError } from "#src/errors/validation";
import { LuauExecutionClient } from "#src/resources/luau-execution/index";
import { PlacesClient } from "#src/resources/places/index";
import { UniversesClient } from "#src/resources/universes/index";
import type { Result } from "#src/types";
import { createFakeSleep } from "#tests/helpers/fake-sleep";
import { rbxlBody } from "#tests/helpers/places";

const TOKEN = "canary-oauth-token-7f3a9c";
const API_KEY = "canary-api-key-2d81be";

const OAUTH: Credential = {
	getAccessToken: () => TOKEN,
	identity: "canary-user",
	kind: "oauth",
};
const KEY: Credential = { apiKey: API_KEY, kind: "apiKey" };

type Respond = (call: number) => Response;

interface Clients {
	readonly luau: LuauExecutionClient;
	readonly places: PlacesClient;
	readonly universes: UniversesClient;
}

type Run = (clients: Clients, options: RequestOptions) => Promise<Result<unknown, OpenCloudError>>;

interface Harness {
	readonly hooks: OpenCloudHooks;
	readonly httpClient: HttpClient;
	readonly onAdmissionWait: (event: AdmissionWaitEvent) => void;
	readonly payloads: Array<unknown>;
	readonly sentHeaders: Array<Headers>;
}

interface Scenario {
	readonly name: string;
	readonly credential?: Credential;
	readonly expected: abstract new (...args: never) => OpenCloudError;
	readonly respond: Respond;
	readonly run: Run;
}

function json(status: number, init: { body: unknown; headers?: Record<string, string> }): Response {
	return new Response(JSON.stringify(init.body), {
		headers: { "content-type": "application/json", ...init.headers },
		status,
	});
}

function notFound(): Response {
	return json(404, { body: { code: "NOT_FOUND", message: "missing" } });
}

function tooManyRequests(retryAfterSeconds: number): Response {
	return json(429, {
		body: { message: "slow down" },
		headers: { "retry-after": String(retryAfterSeconds) },
	});
}

function unreachable(): never {
	throw new Error("fetch must not be called");
}

function createHarness(respond: Respond): Harness {
	const payloads: Array<unknown> = [];
	const sentHeaders: Array<Headers> = [];

	async function fetchAsync(_url: string, init: RequestInit): Promise<Response> {
		sentHeaders.push(new Headers(init.headers));
		return respond(sentHeaders.length - 1);
	}

	return {
		hooks: {
			onRateLimit: (waitMs) => {
				payloads.push(waitMs);
			},
			onRequest: (request) => {
				payloads.push(request);
			},
			onRetry: (attempt, error) => {
				payloads.push(attempt, error);
			},
		},
		httpClient: createFetchHttpClient({ fetch: fromAny(fetchAsync) }),
		onAdmissionWait: (event) => {
			payloads.push(event);
		},
		payloads,
		sentHeaders,
	};
}

/**
 * Renders a value every way a consumer might surface it: `util.inspect`
 * (own properties, stack and the full `cause` chain), JSON, and each
 * message and stack along the `cause` chain.
 *
 * @param value - The error or hook argument to render.
 * @returns All renderings joined into one string.
 */
function render(value: unknown): string {
	const parts = [inspect(value, { depth: Infinity, showHidden: true })];
	try {
		parts.push(JSON.stringify(value) ?? "");
	} catch {
		// `inspect` already covers payloads JSON cannot serialize.
	}

	let current = value;
	while (current instanceof Error) {
		parts.push(current.message, current.stack ?? "", String(current));
		current = current.cause;
	}

	return parts.join("\n");
}

async function getUniverseAsync(
	{ universes }: Clients,
	options: RequestOptions,
): Promise<Result<unknown, OpenCloudError>> {
	return universes.get({ universeId: "1" }, options);
}

async function updateUniverseAsync(
	{ universes }: Clients,
	options: RequestOptions,
): Promise<Result<unknown, OpenCloudError>> {
	return universes.update({ consoleEnabled: true, universeId: "1" }, options);
}

async function pollTaskAsync(
	{ luau }: Clients,
	options: RequestOptions,
): Promise<Result<unknown, OpenCloudError>> {
	return luau.tasks.pollUntilDone(
		{ placeId: "2", sessionId: "s", taskId: "t", universeId: "1", versionId: "3" },
		{ ...options, pollDelay: () => 0, timeoutMs: 0 },
	);
}

const SCENARIOS: ReadonlyArray<Scenario> = [
	{ name: "ApiError", expected: ApiError, respond: notFound, run: getUniverseAsync },
	{
		name: "ApiError after a guided retry",
		expected: ApiError,
		respond: (call) => (call === 0 ? tooManyRequests(1) : notFound()),
		run: getUniverseAsync,
	},
	{
		name: "ApiError on a malformed body",
		expected: ApiError,
		respond: () => json(200, { body: { unexpected: true } }),
		run: getUniverseAsync,
	},
	{
		name: "RateLimitError",
		expected: RateLimitError,
		respond: () => tooManyRequests(1),
		run: async (clients, options) => {
			return getUniverseAsync(clients, { ...options, retryableStatuses: [] });
		},
	},
	{
		name: "RateLimitWaitRefusedError",
		expected: RateLimitWaitRefusedError,
		respond: () => tooManyRequests(3600),
		run: getUniverseAsync,
	},
	{
		name: "RetryDelayExceededError",
		expected: RetryDelayExceededError,
		respond: () => tooManyRequests(30),
		run: async (clients, options) => {
			return getUniverseAsync(clients, { ...options, deadlineMs: Date.now() + 1000 });
		},
	},
	{
		name: "NetworkError",
		expected: NetworkError,
		respond: () => {
			throw new TypeError("fetch failed");
		},
		run: async (clients, options) => getUniverseAsync(clients, { ...options, maxRetries: 0 }),
	},
	{
		name: "ValidationError",
		expected: ValidationError,
		respond: unreachable,
		run: async ({ universes }, options) => universes.update({ universeId: "1" }, options),
	},
	{
		name: "PermissionError",
		credential: KEY,
		expected: PermissionError,
		respond: () => json(403, { body: { code: "PERMISSION_DENIED", message: "denied" } }),
		run: updateUniverseAsync,
	},
	{
		name: "CredentialRejectedError",
		credential: OAUTH,
		expected: CredentialRejectedError,
		respond: () => json(401, { body: { code: "UNAUTHENTICATED", message: "Invalid Token." } }),
		run: updateUniverseAsync,
	},
	{
		name: "CredentialError",
		credential: {
			getAccessToken: () => {
				throw new Error("provider failed");
			},
			identity: "canary-user",
			kind: "oauth",
		},
		expected: CredentialError,
		respond: unreachable,
		run: getUniverseAsync,
	},
	{
		name: "CredentialNotSupportedError",
		credential: OAUTH,
		expected: CredentialNotSupportedError,
		respond: unreachable,
		run: async ({ places }, options) => {
			return places.publish(
				{ body: rbxlBody(), format: "rbxl", placeId: "2", universeId: "1" },
				options,
			);
		},
	},
	{
		name: "RequestAbortedError",
		expected: RequestAbortedError,
		respond: unreachable,
		run: async (clients, options) => {
			return getUniverseAsync(clients, { ...options, signal: AbortSignal.abort() });
		},
	},
	{
		name: "RequestDeadlineExceededError",
		expected: RequestDeadlineExceededError,
		respond: unreachable,
		run: async (clients, options) => getUniverseAsync(clients, { ...options, deadlineMs: 0 }),
	},
	{
		name: "PollTimeoutError",
		credential: KEY,
		expected: PollTimeoutError,
		respond: () => {
			return json(200, {
				body: {
					path: "universes/1/places/2/versions/3/luau-execution-sessions/s/tasks/t",
					state: "PROCESSING",
				},
			});
		},
		run: pollTaskAsync,
	},
	{
		name: "PollAbortedError",
		credential: KEY,
		expected: PollAbortedError,
		respond: unreachable,
		run: async (clients, options) => {
			return pollTaskAsync(clients, { ...options, signal: AbortSignal.abort() });
		},
	},
];

const CASES = SCENARIOS.flatMap((scenario) => {
	const credentials = scenario.credential === undefined ? [OAUTH, KEY] : [scenario.credential];
	return credentials.map((credential) => {
		return { ...scenario, credential, label: `${scenario.name} (${credential.kind})` };
	});
});

describe("token hygiene canary", () => {
	it.for(CASES)(
		"should keep the token and the api key out of $label and every hook payload",
		async (scenario, { expect }) => {
			expect.assertions(3);

			const harness = createHarness(scenario.respond);
			const options = {
				credential: scenario.credential,
				hooks: harness.hooks,
				httpClient: harness.httpClient,
				sleep: createFakeSleep(),
			};
			const clients: Clients = {
				luau: new LuauExecutionClient(options),
				places: new PlacesClient(options),
				universes: new UniversesClient(options),
			};

			const result = await scenario.run(clients, {
				onAdmissionWait: harness.onAdmissionWait,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(scenario.expected);

			const rendered = [result.err, ...harness.payloads].map(render).join("\n");

			expect(rendered).not.toContain(TOKEN);
			expect(rendered).not.toContain(API_KEY);
		},
	);

	it("should send the canary secrets on the wire, so the scan can see a leak", async ({
		expect,
	}) => {
		expect.assertions(2);

		const oauth = createHarness(notFound);
		const key = createHarness(notFound);
		const oauthClient = new UniversesClient({
			credential: OAUTH,
			httpClient: oauth.httpClient,
		});
		const keyClient = new UniversesClient({ credential: KEY, httpClient: key.httpClient });
		await oauthClient.get({ universeId: "1" });
		await keyClient.get({ universeId: "1" });

		const [oauthHeaders] = oauth.sentHeaders;
		const [keyHeaders] = key.sentHeaders;
		assert(oauthHeaders !== undefined && keyHeaders !== undefined);

		expect(oauthHeaders.get("authorization")).toBe(`Bearer ${TOKEN}`);
		expect(keyHeaders.get("x-api-key")).toBe(API_KEY);
	});
});
