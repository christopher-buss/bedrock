import { ApiError } from "#src/errors/api-error";
import type { HttpRequest, HttpResponse } from "#src/internal/http/types";
import { describe, expect, it } from "vitest";

import { createFakeSend } from "./fake-send.ts";

function okResponse(body: unknown = {}): HttpResponse {
	return { body, headers: {}, status: 200 };
}

const getRequest: HttpRequest = { method: "GET", url: "/v1/ping" };
const postRequest: HttpRequest = { method: "POST", url: "/v1/create" };

describe(createFakeSend, () => {
	it("should record each request in invocation order", async () => {
		expect.assertions(1);

		const fakeSend = createFakeSend({
			responses: [
				{ data: okResponse(), success: true },
				{ data: okResponse(), success: true },
			],
		});

		await fakeSend.send(getRequest);
		await fakeSend.send(postRequest);

		expect(fakeSend.requests).toStrictEqual([getRequest, postRequest]);
	});

	it("should replay queued responses FIFO", async () => {
		expect.assertions(2);

		const successBody = { id: "first" };
		const apiError = new ApiError("nope", { statusCode: 404 });
		const fakeSend = createFakeSend({
			responses: [
				{ data: okResponse(successBody), success: true },
				{ err: apiError, success: false },
			],
		});

		const firstResult = await fakeSend.send(getRequest);
		const secondResult = await fakeSend.send(getRequest);

		expect(firstResult).toStrictEqual({ data: okResponse(successBody), success: true });
		expect(secondResult).toStrictEqual({ err: apiError, success: false });
	});

	it("should throw when called after the queue is exhausted", async () => {
		expect.assertions(1);

		const fakeSend = createFakeSend({
			responses: [{ data: okResponse(), success: true }],
		});

		await fakeSend.send(getRequest);

		await expect(fakeSend.send(postRequest)).rejects.toThrow(
			"createFakeSend exhausted: 2 calls made, only 1 responses scripted",
		);
	});
});
