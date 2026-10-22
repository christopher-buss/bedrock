import { it as base, describe, vi } from "vitest";

import { RequestAbortedError } from "../errors/request-aborted.ts";
import { TokenRefreshError } from "../errors/token-refresh-error.ts";
import {
	createOAuthTokenRefresher,
	type OAuthTokenRefresherOptions,
} from "./oauth-token-refresher.ts";

type FetchSeam = (url: string, init: RequestInit) => Promise<Response>;
type OnRotate = OAuthTokenRefresherOptions["onRotate"];

const TOKEN_URL = "https://apis.roblox.com/oauth/v1/token";
const SECOND = 1000;

/** Every test runs on fake timers that start at the epoch. */
const it = base.extend<{ fakeTime: undefined }>({
	fakeTime: [
		async ({ onTestFinished }, use) => {
			vi.useFakeTimers({ now: 0 });
			onTestFinished(() => {
				vi.useRealTimers();
			});
			await use(undefined);
		},
		{ auto: true },
	],
});

/**
 * A token response whose refresh token mirrors the access token name.
 *
 * @param accessToken - The access token, for example `access-1`.
 * @param expiresIn - Lifetime in seconds.
 * @returns The token endpoint response.
 */
function tokenResponse(accessToken: string, expiresIn = 900): Response {
	return Response.json({
		access_token: accessToken,
		expires_in: expiresIn,
		refresh_token: accessToken.replace("access", "refresh"),
		token_type: "Bearer",
	});
}

/**
 * A fetch that answers each call with the next response factory in order.
 *
 * @param responses - One factory per expected token request.
 * @returns The fake fetch.
 */
function scriptedFetch(...responses: ReadonlyArray<() => Promise<Response> | Response>) {
	let index = 0;
	return vi.fn<FetchSeam>(async () => {
		const next = responses[index];
		index += 1;
		if (next === undefined) {
			throw new Error("unexpected token request");
		}

		return next();
	});
}

function sentForm(fetchMock: ReturnType<typeof scriptedFetch>, call: number): URLSearchParams {
	const init = fetchMock.mock.calls[call]![1];
	return new URLSearchParams(typeof init.body === "string" ? init.body : "");
}

function requestCount(mock: { readonly mock: { readonly calls: ReadonlyArray<unknown> } }): number {
	return mock.mock.calls.length;
}

function signal(): AbortSignal {
	const controller = new AbortController();
	return controller.signal;
}

async function delayAsync(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function noop(): void {}

function refresher(
	fetchMock: FetchSeam,
	onRotate: OnRotate = noop,
): ReturnType<typeof createOAuthTokenRefresher> {
	return createOAuthTokenRefresher({
		clientId: "client-id",
		fetch: fetchMock,
		onRotate,
		refreshToken: "refresh-0",
	});
}

describe(createOAuthTokenRefresher, () => {
	it("should exchange the refresh token on the first call", async ({ expect }) => {
		expect.assertions(5);

		const fetchMock = scriptedFetch(() => tokenResponse("access-1"));
		const getAccessToken = createOAuthTokenRefresher({
			clientId: "client-id",
			clientSecret: "secret",
			fetch: fetchMock,
			onRotate: noop,
			refreshToken: "refresh-0",
		});

		await expect(getAccessToken({ signal: signal() })).resolves.toBe("access-1");

		const [url, init] = fetchMock.mock.calls[0]!;

		expect(url).toBe(TOKEN_URL);
		expect(init.method).toBe("POST");
		expect(init.headers).toStrictEqual({ "content-type": "application/x-www-form-urlencoded" });
		expect(Object.fromEntries(sentForm(fetchMock, 0))).toStrictEqual({
			client_id: "client-id",
			client_secret: "secret",
			grant_type: "refresh_token",
			refresh_token: "refresh-0",
		});
	});

	it("should omit client_secret for a public client", async ({ expect }) => {
		expect.assertions(1);

		const fetchMock = scriptedFetch(() => tokenResponse("access-1"));

		await refresher(fetchMock)({ signal: signal() });

		expect(sentForm(fetchMock, 0).has("client_secret")).toBe(false);
	});

	it("should use the global fetch when none is given", async ({ expect }) => {
		expect.assertions(2);

		const globalFetch = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(tokenResponse("access-1"));
		const getAccessToken = createOAuthTokenRefresher({
			clientId: "client-id",
			onRotate: noop,
			refreshToken: "refresh-0",
		});

		await expect(getAccessToken({ signal: signal() })).resolves.toBe("access-1");
		expect(requestCount(globalFetch)).toBe(1);

		globalFetch.mockRestore();
	});

	it("should reuse the token while 120 s or more remain and refresh with the rotated token below that", async ({
		expect,
	}) => {
		expect.assertions(5);

		const fetchMock = scriptedFetch(
			() => tokenResponse("access-1", 900),
			() => tokenResponse("access-2", 900),
		);
		const getAccessToken = refresher(fetchMock);

		await getAccessToken({ signal: signal() });
		vi.advanceTimersByTime(780 * SECOND);

		await expect(getAccessToken({ signal: signal() })).resolves.toBe("access-1");
		expect(requestCount(fetchMock)).toBe(1);

		vi.advanceTimersByTime(1);

		await expect(getAccessToken({ signal: signal() })).resolves.toBe("access-2");
		expect(requestCount(fetchMock)).toBe(2);
		expect(sentForm(fetchMock, 1).get("refresh_token")).toBe("refresh-1");
	});

	it("should measure expiry from the local clock at receipt", async ({ expect }) => {
		expect.assertions(1);

		const fetchMock = scriptedFetch(async () => {
			await delayAsync(10 * SECOND);
			return tokenResponse("access-1", 130);
		});
		const getAccessToken = refresher(fetchMock);

		const first = getAccessToken({ signal: signal() });
		await vi.advanceTimersByTimeAsync(10 * SECOND);
		await first;
		vi.advanceTimersByTime(10 * SECOND);
		await getAccessToken({ signal: signal() });

		expect(requestCount(fetchMock)).toBe(1);
	});

	it("should use the new access token only after onRotate resolves", async ({ expect }) => {
		expect.assertions(3);

		const { promise: saved, resolve: save } = Promise.withResolvers<undefined>();
		const onRotate = vi.fn<OnRotate>(async () => saved);
		const getAccessToken = refresher(
			scriptedFetch(() => tokenResponse("access-1")),
			onRotate,
		);

		let settled = false;
		const call = getAccessToken({ signal: signal() }).finally(() => {
			settled = true;
		});
		await vi.advanceTimersByTimeAsync(0);

		expect(onRotate).toHaveBeenCalledExactlyOnceWith("refresh-1");
		expect(settled).toBe(false);

		save(undefined);

		await expect(call).resolves.toBe("access-1");
	});

	it("should retry onRotate with the kept pair and no exchange after onRotate throws", async ({
		expect,
	}) => {
		expect.assertions(4);

		const saveFailure = new Error("disk full");
		const onRotate = vi.fn<OnRotate>().mockThrowOnce(saveFailure).mockImplementation(noop);
		const fetchMock = scriptedFetch(() => tokenResponse("access-1"));
		const getAccessToken = refresher(fetchMock, onRotate);

		await expect(getAccessToken({ signal: signal() })).rejects.toBe(saveFailure);
		await expect(getAccessToken({ signal: signal() })).resolves.toBe("access-1");
		expect(onRotate.mock.calls).toStrictEqual([["refresh-1"], ["refresh-1"]]);
		expect(requestCount(fetchMock)).toBe(1);
	});

	describe("delayed saves", () => {
		it("should exchange again with the saved token when a retried save returns an expired pair", async ({
			expect,
		}) => {
			expect.assertions(4);

			const saveFailure = new Error("disk full");
			const onRotate = vi.fn<OnRotate>().mockThrowOnce(saveFailure).mockImplementation(noop);
			const fetchMock = scriptedFetch(
				() => tokenResponse("access-1", 900),
				() => tokenResponse("access-2", 900),
			);
			const getAccessToken = refresher(fetchMock, onRotate);

			await expect(getAccessToken({ signal: signal() })).rejects.toBe(saveFailure);

			vi.advanceTimersByTime(900 * SECOND);

			await expect(getAccessToken({ signal: signal() })).resolves.toBe("access-2");
			expect(sentForm(fetchMock, 1).get("refresh_token")).toBe("refresh-1");
			expect(onRotate.mock.calls).toStrictEqual([
				["refresh-1"],
				["refresh-1"],
				["refresh-2"],
			]);
		});

		it("should exchange again when a slow save leaves under 60 s", async ({ expect }) => {
			expect.assertions(2);

			const fetchMock = scriptedFetch(
				() => tokenResponse("access-1", 100),
				() => tokenResponse("access-2", 900),
			);
			const getAccessToken = refresher(fetchMock, async () => delayAsync(40 * SECOND + 1));

			const call = getAccessToken({ signal: signal() });
			await vi.advanceTimersByTimeAsync(90 * SECOND);

			await expect(call).resolves.toBe("access-2");
			expect(requestCount(fetchMock)).toBe(2);
		});

		it("should return the saved token when a slow save leaves 60 s", async ({ expect }) => {
			expect.assertions(2);

			const fetchMock = scriptedFetch(() => tokenResponse("access-1", 100));
			const getAccessToken = refresher(fetchMock, async () => delayAsync(40 * SECOND));

			const call = getAccessToken({ signal: signal() });
			await vi.advanceTimersByTimeAsync(40 * SECOND);

			await expect(call).resolves.toBe("access-1");
			expect(requestCount(fetchMock)).toBe(1);
		});

		it("should exchange at most once more, even when that pair is also delayed", async ({
			expect,
		}) => {
			expect.assertions(2);

			const fetchMock = scriptedFetch(
				() => tokenResponse("access-1", 100),
				() => tokenResponse("access-2", 100),
			);
			const getAccessToken = refresher(fetchMock, async () => delayAsync(50 * SECOND));

			const call = getAccessToken({ signal: signal() });
			await vi.advanceTimersByTimeAsync(100 * SECOND);

			await expect(call).resolves.toBe("access-2");
			expect(requestCount(fetchMock)).toBe(2);
		});

		it("should throw when the second exchange fails transiently", async ({ expect }) => {
			expect.assertions(1);

			const getAccessToken = refresher(
				scriptedFetch(
					() => tokenResponse("access-1", 100),
					() => Response.json({ error: "temporarily_unavailable" }, { status: 503 }),
				),
				async () => delayAsync(50 * SECOND),
			);

			const call = getAccessToken({ signal: signal() }).catch((err: unknown) => err);
			await vi.advanceTimersByTimeAsync(50 * SECOND);

			await expect(call).resolves.toMatchObject({ statusCode: 503 });
		});
	});

	describe("transient failures", () => {
		it.for([
			["a 503", () => new Response("down", { status: 503 })],
			["a 500", () => new Response("down", { status: 500 })],
			["a 429", () => new Response("slow down", { status: 429 })],
			[
				"a network error",
				() => {
					throw new TypeError("fetch failed");
				},
			],
		] as const)(
			"should return the current token on %s while 60 s or more remain",
			async ([, failure], { expect }) => {
				expect.assertions(1);

				const getAccessToken = refresher(
					scriptedFetch(() => tokenResponse("access-1", 900), failure),
				);

				await getAccessToken({ signal: signal() });
				vi.advanceTimersByTime(840 * SECOND);

				await expect(getAccessToken({ signal: signal() })).resolves.toBe("access-1");
			},
		);

		it("should throw a TokenRefreshError on a 5xx below 60 s left", async ({ expect }) => {
			expect.assertions(2);

			const getAccessToken = refresher(
				scriptedFetch(
					() => tokenResponse("access-1", 900),
					() => Response.json({ error: "temporarily_unavailable" }, { status: 503 }),
				),
			);

			await getAccessToken({ signal: signal() });
			vi.advanceTimersByTime(840 * SECOND + 1);

			const error = await getAccessToken({ signal: signal() }).catch((err: unknown) => err);

			expect(error).toBeInstanceOf(TokenRefreshError);
			expect(error).toMatchObject({ code: "temporarily_unavailable", statusCode: 503 });
		});

		it("should throw the network error when there is no current token", async ({ expect }) => {
			expect.assertions(1);

			const networkError = new TypeError("fetch failed");
			const getAccessToken = refresher(
				scriptedFetch(() => {
					throw networkError;
				}),
			);

			await expect(getAccessToken({ signal: signal() })).rejects.toBe(networkError);
		});
	});

	describe("stalled exchanges", () => {
		async function hangingFetchAsync(): Promise<Response> {
			return new Promise(noop);
		}

		function hangingBody(): Response {
			return new Response(new ReadableStream({ start: noop }));
		}

		it.for([
			["request", hangingFetchAsync],
			["body read", hangingBody],
		] as const)(
			"should throw a timeout after 30 s when the %s stalls and there is no current token",
			async ([, stall], { expect }) => {
				expect.assertions(3);

				const getAccessToken = refresher(scriptedFetch(stall));

				let settled = false;
				const call = getAccessToken({ signal: signal() })
					.catch((err: unknown) => err)
					.finally(() => {
						settled = true;
					});
				await vi.advanceTimersByTimeAsync(30 * SECOND - 1);

				expect(settled).toBe(false);

				await vi.advanceTimersByTimeAsync(1);

				await expect(call).resolves.toBeInstanceOf(DOMException);
				await expect(call).resolves.toMatchObject({
					name: "TimeoutError",
					message: "OAuth token exchange timed out",
				});
			},
		);

		it("should return the current token on a stall while 60 s or more remain", async ({
			expect,
		}) => {
			expect.assertions(1);

			const getAccessToken = refresher(
				scriptedFetch(() => tokenResponse("access-1", 900), hangingFetchAsync),
			);

			await getAccessToken({ signal: signal() });
			vi.advanceTimersByTime(800 * SECOND);
			const call = getAccessToken({ signal: signal() });
			await vi.advanceTimersByTimeAsync(30 * SECOND);

			await expect(call).resolves.toBe("access-1");
		});

		it("should abort the request signal and start a new exchange on the next call", async ({
			expect,
		}) => {
			expect.assertions(3);

			const fetchMock = scriptedFetch(hangingFetchAsync, () => tokenResponse("access-1"));
			const getAccessToken = refresher(fetchMock);

			const call = getAccessToken({ signal: signal() }).catch(noop);
			await vi.advanceTimersByTimeAsync(30 * SECOND);
			await call;

			expect(fetchMock.mock.calls[0]![1].signal?.aborted).toBe(true);
			await expect(getAccessToken({ signal: signal() })).resolves.toBe("access-1");
			expect(requestCount(fetchMock)).toBe(2);
		});

		it("should clear the timeout once the exchange settles", async ({ expect }) => {
			expect.assertions(1);

			await refresher(scriptedFetch(() => tokenResponse("access-1")))({ signal: signal() });

			expect(vi.getTimerCount()).toBe(0);
		});

		it("should record a refusal that arrives after the timeout", async ({ expect }) => {
			expect.assertions(2);

			const fetchMock = scriptedFetch(async () => {
				await delayAsync(40 * SECOND);
				return Response.json({ error: "invalid_grant" }, { status: 400 });
			});
			const getAccessToken = refresher(fetchMock);

			const call = getAccessToken({ signal: signal() }).catch((err: unknown) => err);
			await vi.advanceTimersByTimeAsync(40 * SECOND);

			await expect(call).resolves.toMatchObject({ name: "TimeoutError" });
			await expect(getAccessToken({ signal: signal() })).rejects.toMatchObject({
				code: "invalid_grant",
			});
		});
	});

	describe("refused refresh", () => {
		it("should throw a TokenRefreshError with the OAuth error code and status", async ({
			expect,
		}) => {
			expect.assertions(3);

			const getAccessToken = refresher(
				scriptedFetch(
					() => Response.json({ error: "invalid_request" }, { status: 400 }),
					() => tokenResponse("access-1"),
				),
			);

			const error = await getAccessToken({ signal: signal() }).catch((err: unknown) => err);

			expect(error).toBeInstanceOf(TokenRefreshError);
			expect(error).toMatchObject({
				code: "invalid_request",
				message: "OAuth token refresh failed with HTTP 400",
				statusCode: 400,
			});
			await expect(getAccessToken({ signal: signal() })).resolves.toBe("access-1");
		});

		it.for([
			["a body that is not JSON", () => new Response("<html>", { status: 401 }), 401],
			["a JSON array body", () => Response.json([], { status: 400 }), 400],
			["a non-string error field", () => Response.json({ error: 7 }, { status: 400 }), 400],
			["a 2xx body without the token fields", () => Response.json({}), 200],
			["a 2xx array body", () => Response.json([]), 200],
			[
				"a 2xx body without expires_in",
				() => Response.json({ access_token: "a", refresh_token: "r" }),
				200,
			],
			[
				"a 2xx body without refresh_token",
				() => Response.json({ access_token: "a", expires_in: 900 }),
				200,
			],
			[
				"a 2xx body with an empty access_token",
				() => Response.json({ access_token: "", expires_in: 900, refresh_token: "r" }),
				200,
			],
			[
				"a 2xx body with an empty refresh_token",
				() => Response.json({ access_token: "a", expires_in: 900, refresh_token: "" }),
				200,
			],
			[
				"a 2xx body with a zero expires_in",
				() => Response.json({ access_token: "a", expires_in: 0, refresh_token: "r" }),
				200,
			],
			[
				"a 2xx body with a negative expires_in",
				() => Response.json({ access_token: "a", expires_in: -1, refresh_token: "r" }),
				200,
			],
			[
				"a 2xx body with an infinite expires_in",
				() => new Response('{"access_token":"a","expires_in":1e400,"refresh_token":"r"}'),
				200,
			],
		] as const)(
			"should leave the code undefined for %s",
			async ([, response, statusCode], { expect }) => {
				expect.assertions(1);

				const getAccessToken = refresher(scriptedFetch(response));

				await expect(getAccessToken({ signal: signal() })).rejects.toMatchObject({
					code: undefined,
					statusCode,
				});
			},
		);

		it("should stay failed after invalid_grant and send nothing more", async ({ expect }) => {
			expect.assertions(3);

			const fetchMock = scriptedFetch(() => {
				return Response.json({ error: "invalid_grant" }, { status: 400 });
			});
			const getAccessToken = refresher(fetchMock);

			const first = await getAccessToken({ signal: signal() }).catch((err: unknown) => err);

			expect(first).toMatchObject({ code: "invalid_grant", statusCode: 400 });
			await expect(getAccessToken({ signal: signal() })).rejects.toBe(first);
			expect(requestCount(fetchMock)).toBe(1);
		});

		it("should stay failed after a malformed 2xx body and send nothing more", async ({
			expect,
		}) => {
			expect.assertions(3);

			const fetchMock = scriptedFetch(
				() => Response.json({}),
				() => tokenResponse("access-1"),
			);
			const getAccessToken = refresher(fetchMock);

			const first = await getAccessToken({ signal: signal() }).catch((err: unknown) => err);

			expect(first).toMatchObject({ code: undefined, statusCode: 200 });
			await expect(getAccessToken({ signal: signal() })).rejects.toBe(first);
			expect(requestCount(fetchMock)).toBe(1);
		});
	});

	describe("concurrency", () => {
		it("should share one exchange between concurrent callers", async ({ expect }) => {
			expect.assertions(3);

			const fetchMock = scriptedFetch(() => tokenResponse("access-1"));
			const onRotate = vi.fn<OnRotate>();
			const getAccessToken = refresher(fetchMock, onRotate);

			const tokens = await Promise.all([
				getAccessToken({ signal: signal() }),
				getAccessToken({ signal: signal() }),
			]);

			expect(tokens).toStrictEqual(["access-1", "access-1"]);
			expect(requestCount(fetchMock)).toBe(1);
			expect(onRotate).toHaveBeenCalledExactlyOnceWith("refresh-1");
		});

		it("should stop only the aborted caller's wait and finish the exchange", async ({
			expect,
		}) => {
			expect.assertions(4);

			const fetchMock = scriptedFetch(async () => {
				await delayAsync(SECOND);
				return tokenResponse("access-1");
			});
			const onRotate = vi.fn<OnRotate>();
			const getAccessToken = refresher(fetchMock, onRotate);
			const controller = new AbortController();

			const aborted = getAccessToken({ signal: controller.signal });
			const kept = getAccessToken({ signal: signal() });
			controller.abort("superseded");

			await expect(aborted).rejects.toStrictEqual(
				new RequestAbortedError("Access token wait was aborted", { reason: "superseded" }),
			);

			await vi.advanceTimersByTimeAsync(SECOND);

			await expect(kept).resolves.toBe("access-1");
			expect(onRotate).toHaveBeenCalledExactlyOnceWith("refresh-1");
			expect(requestCount(fetchMock)).toBe(1);
		});

		it("should detach from the caller's signal once the wait settles", async ({ expect }) => {
			expect.assertions(1);

			const controller = new AbortController();
			const addListener = vi.spyOn(controller.signal, "addEventListener");
			const removeListener = vi.spyOn(controller.signal, "removeEventListener");

			await refresher(scriptedFetch(() => tokenResponse("access-1")))({
				signal: controller.signal,
			});

			expect(removeListener.mock.calls).toStrictEqual(addListener.mock.calls);
		});

		it("should reject an already aborted caller without a request", async ({ expect }) => {
			expect.assertions(3);

			const fetchMock = scriptedFetch(() => tokenResponse("access-1"));
			const getAccessToken = refresher(fetchMock);

			const error = await getAccessToken({ signal: AbortSignal.abort("gone") }).catch(
				(err: unknown) => err,
			);

			expect(error).toBeInstanceOf(RequestAbortedError);
			expect(error).toMatchObject({ reason: "gone" });
			expect(requestCount(fetchMock)).toBe(0);
		});

		it("should start a new exchange after the shared one settles", async ({ expect }) => {
			expect.assertions(2);

			const getAccessToken = refresher(
				scriptedFetch(
					() => new Response("down", { status: 503 }),
					() => tokenResponse("access-1"),
				),
			);

			await expect(getAccessToken({ signal: signal() })).rejects.toBeInstanceOf(
				TokenRefreshError,
			);
			await expect(getAccessToken({ signal: signal() })).resolves.toBe("access-1");
		});
	});
});
