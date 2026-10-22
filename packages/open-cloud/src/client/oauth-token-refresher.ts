import { RequestAbortedError } from "../errors/request-aborted.ts";
import { TokenRefreshError } from "../errors/token-refresh-error.ts";
import type { Credential } from "./types.ts";

const TOKEN_URL = "https://apis.roblox.com/oauth/v1/token";
const REFRESH_BELOW_MS = 120_000;
const FALLBACK_MIN_MS = 60_000;
const EXCHANGE_TIMEOUT_MS = 30_000;

/**
 * Options for {@link createOAuthTokenRefresher}.
 *
 * @since unreleased
 */
export interface OAuthTokenRefresherOptions {
	/** The OAuth app's client id. */
	readonly clientId: string;
	/**
	 * The client secret of a confidential app. Omit it for a public app that
	 * uses a code verifier.
	 */
	readonly clientSecret?: string;
	/**
	 * The `fetch` to send token requests through. Defaults to the global
	 * `fetch`.
	 */
	readonly fetch?: (input: string, init: RequestInit) => Promise<Response>;
	/**
	 * Saves the new refresh token after each rotation. The new access token is
	 * used only after it resolves. If it throws, the call throws, and the next
	 * call retries it with the same token and does no exchange.
	 */
	readonly onRotate: (refreshToken: string) => Promise<void> | void;
	/** The current refresh token. It is spent by the first refresh. */
	readonly refreshToken: string;
}

interface TokenPair {
	readonly accessToken: string;
	readonly expiresAt: number;
	readonly refreshToken: string;
}

type ExchangeOutcome =
	| { readonly error: unknown; readonly kind: "transient" }
	| { readonly kind: "ok"; readonly pair: TokenPair };

/** The `getAccessToken` of an OAuth {@link Credential}. */
type AccessTokenProvider = Extract<Credential, { kind: "oauth" }>["getAccessToken"];

type FetchSeam = NonNullable<OAuthTokenRefresherOptions["fetch"]>;

class OAuthTokenRefresher {
	readonly #clientId: string;
	readonly #clientSecret: string | undefined;
	readonly #onRotate: OAuthTokenRefresherOptions["onRotate"];
	readonly #send: FetchSeam;

	#current: TokenPair | undefined;
	#failure: TokenRefreshError | undefined;
	#inFlight: Promise<string> | undefined;
	#pending: TokenPair | undefined;
	#refreshToken: string;

	constructor(options: OAuthTokenRefresherOptions) {
		this.#clientId = options.clientId;
		this.#clientSecret = options.clientSecret;
		this.#onRotate = options.onRotate;
		this.#refreshToken = options.refreshToken;
		this.#send = options.fetch ?? fetch;
	}

	public async getAccessTokenAsync(signal: AbortSignal): Promise<string> {
		if (signal.aborted) {
			throw abortedWait(signal);
		}

		if (this.#failure !== undefined) {
			throw this.#failure;
		}

		// A kept unsaved pair only exists after a refresh, which runs below
		// the threshold, so the current token never short-circuits its save.
		const cached = this.#tokenLasting(REFRESH_BELOW_MS);
		if (cached !== undefined) {
			return cached;
		}

		this.#inFlight ??= this.#refreshAsync().finally(() => {
			this.#inFlight = undefined;
		});
		return waitAsync(this.#inFlight, signal);
	}

	/**
	 * Runs one exchange under its own time limit, apart from any caller's
	 * signal. A timeout is transient, like a network error.
	 *
	 * @returns The exchange outcome.
	 */
	async #exchangeAsync(): Promise<ExchangeOutcome> {
		const controller = new AbortController();
		const exchange = this.#sendAsync(controller.signal);

		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<ExchangeOutcome>((resolve) => {
			timer = setTimeout(() => {
				const error = new DOMException("OAuth token exchange timed out", "TimeoutError");
				controller.abort(error);
				resolve({ error, kind: "transient" });
			}, EXCHANGE_TIMEOUT_MS);
		});

		try {
			return await Promise.race([exchange, timeout]);
		} finally {
			clearTimeout(timer);
		}
	}

	#fallback(error: unknown): string {
		const token = this.#tokenLasting(FALLBACK_MIN_MS);
		if (token === undefined) {
			throw error;
		}

		return token;
	}

	#form(): URLSearchParams {
		const form = new URLSearchParams({
			client_id: this.#clientId,
			grant_type: "refresh_token",
			refresh_token: this.#refreshToken,
		});
		if (this.#clientSecret !== undefined) {
			form.set("client_secret", this.#clientSecret);
		}

		return form;
	}

	/**
	 * Refreshes and saves a pair. A save can finish late (a retried kept
	 * pair, or a slow `onRotate`), so when the saved token has under 60 s
	 * left it exchanges once more with the now saved refresh token.
	 *
	 * @returns An access token.
	 */
	async #refreshAsync(): Promise<string> {
		const first = await this.#rotateAsync();
		if (first.kind === "transient") {
			return this.#fallback(first.error);
		}

		if (first.pair.expiresAt - Date.now() >= FALLBACK_MIN_MS) {
			return first.pair.accessToken;
		}

		const second = await this.#rotateAsync();
		return second.kind === "transient" ? this.#fallback(second.error) : second.pair.accessToken;
	}

	/**
	 * Records a refusal that spent the refresh token, so it is never sent
	 * again: an `invalid_grant`, or a 2xx whose body held no usable pair.
	 *
	 * @param error - The refusal.
	 * @param accepted - Whether the endpoint answered 2xx.
	 * @returns The refusal, to throw.
	 */
	#refused(error: TokenRefreshError, accepted: boolean): TokenRefreshError {
		if (accepted || error.code === "invalid_grant") {
			this.#failure = error;
		}

		return error;
	}

	/**
	 * Exchanges the refresh token unless a kept unsaved pair exists, then
	 * saves the pair and makes it current.
	 *
	 * @returns The saved pair, or the transient failure of the exchange.
	 */
	async #rotateAsync(): Promise<ExchangeOutcome> {
		if (this.#pending === undefined) {
			const outcome = await this.#exchangeAsync();
			if (outcome.kind === "transient") {
				return outcome;
			}

			this.#pending = outcome.pair;
		}

		const pending = this.#pending;
		await this.#onRotate(pending.refreshToken);
		this.#current = pending;
		this.#refreshToken = pending.refreshToken;
		this.#pending = undefined;
		return { kind: "ok", pair: pending };
	}

	async #sendAsync(signal: AbortSignal): Promise<ExchangeOutcome> {
		let response: Response;
		try {
			response = await this.#send(TOKEN_URL, {
				body: this.#form().toString(),
				headers: { "content-type": "application/x-www-form-urlencoded" },
				method: "POST",
				signal,
			});
		} catch (err) {
			return { error: err, kind: "transient" };
		}

		const receivedAt = Date.now();
		const json = await readBodyAsync(response);
		if (response.status === 429 || response.status >= 500) {
			return { error: refusal(json, response.status), kind: "transient" };
		}

		const pair = response.ok ? toPair(json, receivedAt) : undefined;
		if (pair === undefined) {
			throw this.#refused(refusal(json, response.status), response.ok);
		}

		return { kind: "ok", pair };
	}

	#tokenLasting(minimumMs: number): string | undefined {
		const current = this.#current;
		return current !== undefined && current.expiresAt - Date.now() >= minimumMs
			? current.accessToken
			: undefined;
	}
}

/**
 * Creates a `getAccessToken` that keeps an OAuth access token fresh by
 * rotating one refresh token against the Roblox token endpoint. Use it as
 * the `getAccessToken` of an OAuth `Credential`; you write the `identity`.
 *
 * Use one refresher per refresh token, in one process. A refresh token is
 * single use, so two refreshers (or two processes) sharing one will spend it
 * twice and lose the grant. Multi-instance consumers bring their own
 * provider.
 *
 * - The first call refreshes. Later calls refresh when less than 120 s
 *   remain, measured on the local clock from receipt plus `expires_in`.
 * - The new access token is used only after `onRotate` resolves. A spent
 *   refresh token is never sent again. If the saved access token then has
 *   less than 60 s left, it exchanges once more.
 * - A network error, 5xx or 429 returns the current token while 60 s or
 *   more remain, and throws otherwise.
 * - Each exchange has its own 30 s limit, for the request and the body
 *   read. A timeout is handled like a network error.
 * - Any other non-2xx, or a 2xx without a usable token pair, throws a
 *   {@link TokenRefreshError}. After `invalid_grant` or such a 2xx, every
 *   call throws it again and sends nothing.
 * - Concurrent calls share one exchange. A caller's `signal` stops only its
 *   own wait, never the exchange.
 *
 * @param options - The client, the refresh token and the rotation callback.
 * @returns A `getAccessToken` for an OAuth `Credential`.
 * @since unreleased
 *
 * @example
 *
 * ```ts
 * import { createOAuthTokenRefresher, type Credential } from "@bedrock-rbx/ocale";
 *
 * let saved = "refresh-0";
 * const getAccessToken = createOAuthTokenRefresher({
 *   clientId: "client-id",
 *   fetch: async () =>
 *     Response.json({ access_token: "access-1", expires_in: 900, refresh_token: "refresh-1" }),
 *   onRotate: (refreshToken) => {
 *     saved = refreshToken;
 *   },
 *   refreshToken: saved,
 * });
 * const credential: Credential = { getAccessToken, identity: "user-1", kind: "oauth" };
 *
 * expect(credential.kind).toBe("oauth");
 * return getAccessToken({ signal: new AbortController().signal }).then((token) => {
 *   expect(token).toBe("access-1");
 *   expect(saved).toBe("refresh-1");
 * });
 * ```
 */
export function createOAuthTokenRefresher(
	options: OAuthTokenRefresherOptions,
): (...args: Parameters<AccessTokenProvider>) => Promise<string> {
	const refresher = new OAuthTokenRefresher(options);
	return async ({ signal }) => refresher.getAccessTokenAsync(signal);
}

async function readBodyAsync(response: Response): Promise<JSONValue | undefined> {
	try {
		return JSON.parse(await response.text());
	} catch {
		return undefined;
	}
}

function isRecord(value: JSONValue | undefined): value is Readonly<Record<string, JSONValue>> {
	return value instanceof Object && !Array.isArray(value);
}

function toPair(body: JSONValue | undefined, receivedAt: number): TokenPair | undefined {
	if (!isRecord(body)) {
		return undefined;
	}

	const { access_token: accessToken, expires_in: expiresIn, refresh_token: refreshToken } = body;
	if (
		typeof accessToken !== "string" ||
		accessToken === "" ||
		typeof refreshToken !== "string" ||
		refreshToken === "" ||
		typeof expiresIn !== "number" ||
		!Number.isFinite(expiresIn) ||
		expiresIn <= 0
	) {
		return undefined;
	}

	return { accessToken, expiresAt: receivedAt + expiresIn * 1000, refreshToken };
}

function refusal(body: JSONValue | undefined, statusCode: number): TokenRefreshError {
	const code = isRecord(body) && typeof body["error"] === "string" ? body["error"] : undefined;
	return new TokenRefreshError(`OAuth token refresh failed with HTTP ${statusCode}`, {
		code,
		statusCode,
	});
}

function abortedWait(signal: AbortSignal): RequestAbortedError {
	return new RequestAbortedError("Access token wait was aborted", { reason: signal.reason });
}

/**
 * Waits for a shared promise, but lets one caller's signal end only that
 * caller's wait.
 *
 * @template T - The value type of the shared promise.
 * @param promise - The shared promise.
 * @param signal - The caller's signal.
 * @returns The value of the shared promise.
 * @rejects RequestAbortedError when the signal aborts first, or the shared
 *   promise's own error.
 */
async function waitAsync<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		function onAbort(): void {
			reject(abortedWait(signal));
		}

		signal.addEventListener("abort", onAbort);
		promise
			.then(resolve)
			.catch(reject)
			.finally(() => {
				signal.removeEventListener("abort", onAbort);
			});
	});
}
