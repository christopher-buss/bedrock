# Errors

Ocale never throws from client methods; errors come back inside a `Result`.
All error classes extend `OpenCloudError`, so `instanceof OpenCloudError` will
catch anything the SDK produces.

## Hierarchy

```text
OpenCloudError
├── ApiError          non-2xx response that isn't a rate limit (carries statusCode + code)
├── NetworkError      transport-level failure (DNS, timeout, connection reset)
└── RateLimitError    429 Too Many Requests (carries retryAfterSeconds)
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

## Reference

- [`OpenCloudError`](/ocale/api/index/classes/OpenCloudError)
- [`ApiError`](/ocale/api/index/classes/ApiError)
- [`NetworkError`](/ocale/api/index/classes/NetworkError)
- [`RateLimitError`](/ocale/api/index/classes/RateLimitError)
