import { ApiError, requestContextOf } from "../../errors/api-error.ts";
import type { OpenCloudError } from "../../errors/base.ts";
import { isRecord } from "../../internal/utils/is-record.ts";

/**
 * Adds the known eligibility explanation without diagnosing a missing rating.
 *
 * @param err - The activation attempt's transport error.
 * @returns An error retaining the original request and response evidence.
 */
export function explainActivationError(err: OpenCloudError): OpenCloudError {
	if (!(err instanceof ApiError) || err.statusCode !== 403) {
		return err;
	}

	const code = err.code ?? (isRecord(err.details) ? err.details["code"] : undefined);
	if (code !== 3 && code !== "3") {
		return err;
	}

	return new ApiError(
		`${err.message} A missing content maturity rating is a possible cause; complete the content questionnaire in Creator Hub.`,
		{
			...requestContextOf(err),
			cause: err,
			code: err.code,
			details: err.details,
			statusCode: err.statusCode,
		},
	);
}
