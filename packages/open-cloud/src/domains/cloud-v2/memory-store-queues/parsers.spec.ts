import { validDequeueBody, validQueueItemBody } from "#tests/helpers/memory-store-queues";
import { assert, describe, expect, it } from "vitest";

import { ApiError } from "../../../errors/api-error.ts";
import { parseDequeueResponse, parseQueueItemResponse } from "./parsers.ts";
import type { MemoryStoreQueueItemWire } from "./wire.ts";

function okQueueItemResponse(
	body: MemoryStoreQueueItemWire,
): Parameters<typeof parseQueueItemResponse>[0] {
	return { body, headers: {}, status: 200 };
}

describe(parseQueueItemResponse, () => {
	it("should parse a full valid body into the public QueueItem shape", () => {
		expect.assertions(1);

		const result = parseQueueItemResponse(okQueueItemResponse(validQueueItemBody()));

		assert(result.success);

		expect(result.data).toStrictEqual({
			id: "abc123",
			data: "hello",
			expiresAt: new Date("2026-06-21T15:08:58.4806559Z"),
			priority: 1,
			queueId: "test-queue",
			universeId: "123",
		});
	});

	describe("priority normalization", () => {
		it("should surface priority as undefined when omitted", () => {
			expect.assertions(1);

			const result = parseQueueItemResponse(
				okQueueItemResponse(validQueueItemBody({ priority: undefined })),
			);

			assert(result.success);

			expect(result.data.priority).toBeUndefined();
		});

		it("should normalize a JSON null priority to undefined", () => {
			expect.assertions(1);

			const body: Record<string, unknown> = {
				...validQueueItemBody(),
				priority: JSON.parse("null"),
			};

			const result = parseQueueItemResponse({ body, headers: {}, status: 200 });

			assert(result.success);

			expect(result.data.priority).toBeUndefined();
		});
	});

	describe("data preservation", () => {
		it("should preserve nested null values inside an object payload", () => {
			expect.assertions(1);

			const result = parseQueueItemResponse(
				okQueueItemResponse(
					validQueueItemBody({ data: { a: "x", b: JSON.parse("null") } }),
				),
			);

			assert(result.success);

			expect(result.data.data).toStrictEqual({ a: "x", b: JSON.parse("null") });
		});

		it("should preserve a falsy primitive payload (zero) verbatim", () => {
			expect.assertions(1);

			const result = parseQueueItemResponse(
				okQueueItemResponse(validQueueItemBody({ data: 0 })),
			);

			assert(result.success);

			expect(result.data.data).toBe(0);
		});
	});

	describe("id extraction", () => {
		it("should extract universeId, queueId, and id from the resource path", () => {
			expect.assertions(3);

			const result = parseQueueItemResponse(
				okQueueItemResponse(
					validQueueItemBody({
						path: "cloud/v2/universes/99999/memory-store/queues/some-queue/items/400ffff0001",
					}),
				),
			);

			assert(result.success);

			expect(result.data.universeId).toBe("99999");
			expect(result.data.queueId).toBe("some-queue");
			expect(result.data.id).toBe("400ffff0001");
		});

		it("should reject a path that does not match the queue-item pattern", () => {
			expect.assertions(2);

			const result = parseQueueItemResponse(
				okQueueItemResponse(validQueueItemBody({ path: "universes/123/places/456" })),
			);

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.message).toBe("Malformed memory-store queue item response");
		});
	});

	describe("malformed bodies", () => {
		it("should reject a non-record body", () => {
			expect.assertions(2);

			const result = parseQueueItemResponse({
				body: "not an object",
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
			expect(result.err.statusCode).toBe(200);
		});

		it.for(["data", "expireTime", "path"] as const)(
			"should reject a body missing the required %s field",
			(field) => {
				expect.assertions(1);

				const { [field]: _removed, ...rest } = validQueueItemBody();
				const result = parseQueueItemResponse({ body: rest, headers: {}, status: 200 });

				assert(!result.success);

				expect(result.err).toBeInstanceOf(ApiError);
			},
		);

		it("should reject a body whose top-level data is null", () => {
			expect.assertions(1);

			const body: Record<string, unknown> = {
				...validQueueItemBody(),
				data: JSON.parse("null"),
			};

			const result = parseQueueItemResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose path is not a string", () => {
			expect.assertions(1);

			const body = { ...validQueueItemBody(), path: 12_345 };
			const result = parseQueueItemResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose path is a non-string with a matching toString", () => {
			// A toString() that matches the queue-item path pattern would let
			// regex.exec succeed on the coerced string, so this guards that
			// the parser rejects by type before any regex coercion.
			expect.assertions(1);

			const body = {
				...validQueueItemBody(),
				path: {
					toString: (): string => "cloud/v2/universes/1/memory-store/queues/q/items/i",
				},
			};
			const result = parseQueueItemResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose expireTime is not a string", () => {
			expect.assertions(1);

			const body = { ...validQueueItemBody(), expireTime: 0 };
			const result = parseQueueItemResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject a body whose priority is not a number", () => {
			expect.assertions(1);

			const body = { ...validQueueItemBody(), priority: "high" };
			const result = parseQueueItemResponse({ body, headers: {}, status: 200 });

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should reject an array body even when it carries a valid queue-item shape", () => {
			expect.assertions(1);

			const arrayWithShape = Object.assign([0], validQueueItemBody());
			const result = parseQueueItemResponse({
				body: arrayWithShape,
				headers: {},
				status: 200,
			});

			assert(!result.success);

			expect(result.err).toBeInstanceOf(ApiError);
		});

		it("should propagate the response status code on the returned ApiError", () => {
			expect.assertions(1);

			const result = parseQueueItemResponse({ body: "nope", headers: {}, status: 502 });

			assert(!result.success);

			expect(result.err.statusCode).toBe(502);
		});
	});
});

describe(parseDequeueResponse, () => {
	it("should parse a valid response into a DequeueResult with mapped items and readId", () => {
		expect.assertions(2);

		const result = parseDequeueResponse({
			body: validDequeueBody(),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.readId).toBe("1a354bd5b8fe457f8e51232f8dbfe6d0");
		expect(result.data.items).toHaveLength(1);
	});

	it("should map every queue item through the same parser as the enqueue response", () => {
		expect.assertions(3);

		const result = parseDequeueResponse({
			body: validDequeueBody({
				queueItems: [
					validQueueItemBody({
						path: "cloud/v2/universes/1/memory-store/queues/q/items/first",
					}),
					validQueueItemBody({
						path: "cloud/v2/universes/1/memory-store/queues/q/items/second",
						priority: undefined,
					}),
				],
			}),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.items).toHaveLength(2);
		expect(result.data.items[0]?.id).toBe("first");
		expect(result.data.items[1]?.priority).toBeUndefined();
	});

	it("should accept an empty queueItems array", () => {
		expect.assertions(1);

		const result = parseDequeueResponse({
			body: validDequeueBody({ queueItems: [] }),
			headers: {},
			status: 200,
		});

		assert(result.success);

		expect(result.data.items).toStrictEqual([]);
	});

	it("should reject a non-record body", () => {
		expect.assertions(2);

		const result = parseDequeueResponse({ body: "nope", headers: {}, status: 200 });

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
		expect(result.err.message).toBe("Malformed memory-store dequeue response");
	});

	it("should reject a body whose id is not a string", () => {
		expect.assertions(1);

		const result = parseDequeueResponse({
			body: { ...validDequeueBody(), id: 12_345 },
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should reject a body whose queueItems is not an array", () => {
		expect.assertions(1);

		const result = parseDequeueResponse({
			body: { ...validDequeueBody(), queueItems: "nope" },
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should reject a body whose queueItems contains a malformed entry", () => {
		expect.assertions(1);

		const malformedItem: Record<string, unknown> = {
			...validQueueItemBody(),
			path: 12_345,
		};
		const result = parseDequeueResponse({
			body: { ...validDequeueBody(), queueItems: [malformedItem] },
			headers: {},
			status: 200,
		});

		assert(!result.success);

		expect(result.err).toBeInstanceOf(ApiError);
	});

	it("should propagate the response status code on the returned ApiError", () => {
		expect.assertions(1);

		const result = parseDequeueResponse({ body: "nope", headers: {}, status: 503 });

		assert(!result.success);

		expect(result.err.statusCode).toBe(503);
	});
});
