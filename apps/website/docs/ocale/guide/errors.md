# Errors

Ocale never throws from client methods; errors come back inside a `Result`. All
error classes extend `OpenCloudError`, so `instanceof OpenCloudError` will catch
anything the SDK produces.

## Hierarchy

```text
OpenCloudError
├── ApiError                     non-2xx response that isn't a rate limit (carries statusCode + code)
├── CredentialError              OAuth getAccessToken threw (the thrown value is the cause)
├── CredentialNotSupportedError  OAuth on an API-key-only operation (carries operationKey)
├── CredentialRejectedError      Roblox refused the OAuth token (carries identity + statusCode)
├── NetworkError                 transport-level failure (DNS, timeout, connection reset)
├── RateLimitError               429 Too Many Requests (carries retryAfterSeconds)
└── TokenRefreshError            the token endpoint refused a refresh (carries statusCode + code)
```

## Narrow with `instanceof`

```ts
import { ApiError, NetworkError, RateLimitError } from "@bedrock-rbx/ocale";

if (!result.success) {
	if (result.err instanceof RateLimitError) {
		await sleep(result.err.retryAfterSeconds * 1000);
	} else if (result.err instanceof ApiError) {
		// `code` may be undefined; the API only populates it for some errors.
		logger.warn({ code: result.err.code, status: result.err.statusCode });
	} else if (result.err instanceof NetworkError) {
		// transport failure; retry later
	}
}
```

## OAuth credential errors

With an OAuth `credential`, a failing `getAccessToken` ends the call with a
`CredentialError`. When the provider is `createOAuthTokenRefresher`, its `cause`
is a `TokenRefreshError`; `code: "invalid_grant"` means the refresh token is
spent and the user must authorize again:

```ts
import { CredentialError, TokenRefreshError } from "@bedrock-rbx/ocale";

if (!result.success && result.err instanceof CredentialError) {
	const { cause } = result.err;
	if (cause instanceof TokenRefreshError && cause.code === "invalid_grant") {
		// ask the user to authorize the app again
	}
}
```

`CredentialRejectedError` means Roblox refused a token the provider returned.
`CredentialNotSupportedError` means the operation accepts only an API key; no
request is sent.

## Reference

- [`OpenCloudError`](/ocale/api/index/classes/OpenCloudError)
- [`ApiError`](/ocale/api/index/classes/ApiError)
- [`CredentialError`](/ocale/api/index/classes/CredentialError)
- [`CredentialNotSupportedError`](/ocale/api/index/classes/CredentialNotSupportedError)
- [`CredentialRejectedError`](/ocale/api/index/classes/CredentialRejectedError)
- [`NetworkError`](/ocale/api/index/classes/NetworkError)
- [`RateLimitError`](/ocale/api/index/classes/RateLimitError)
- [`TokenRefreshError`](/ocale/api/index/classes/TokenRefreshError)
