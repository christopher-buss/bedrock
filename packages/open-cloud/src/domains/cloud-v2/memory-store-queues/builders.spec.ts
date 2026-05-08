import { assert, describe, expect, it } from "vitest";

import { buildDequeueRequest, buildDiscardRequest, buildEnqueueRequest } from "./builders.ts";

describe(buildEnqueueRequest, () => {
	it("should produce a POST request targeting /cloud/v2/universes/{uid}/memory-store/queues/{qid}/items", () => {
		expect.assertions(2);

		const request = buildEnqueueRequest({
			data: "hello",
			queueId: "my-queue",
			universeId: "123",
		});

		expect(request.method).toBe("POST");
		expect(request.url).toBe("/cloud/v2/universes/123/memory-store/queues/my-queue/items");
	});

	it("should send application/json as the content-type header", () => {
		expect.assertions(1);

		const request = buildEnqueueRequest({
			data: "hello",
			queueId: "q",
			universeId: "1",
		});

		expect(request.headers).toStrictEqual({ "content-type": "application/json" });
	});

	it("should serialize data verbatim into the JSON body", () => {
		expect.assertions(1);

		const data = JSON.parse('{"foo":1,"nested":[true,null]}');
		assert(data !== null);

		const request = buildEnqueueRequest({
			data,
			queueId: "q",
			universeId: "1",
		});

		expect(request.body).toStrictEqual({ data });
	});

	it("should include priority when supplied", () => {
		expect.assertions(1);

		const request = buildEnqueueRequest({
			data: "x",
			priority: 7,
			queueId: "q",
			universeId: "1",
		});

		expect(request.body).toStrictEqual({ data: "x", priority: 7 });
	});

	it("should serialize ttl as a duration string in seconds when supplied", () => {
		expect.assertions(1);

		const request = buildEnqueueRequest({
			data: "x",
			queueId: "q",
			ttl: 30,
			universeId: "1",
		});

		expect(request.body).toStrictEqual({ data: "x", ttl: "30s" });
	});

	it("should omit priority and ttl from the body when not supplied", () => {
		expect.assertions(1);

		const request = buildEnqueueRequest({
			data: "x",
			queueId: "q",
			universeId: "1",
		});

		expect(request.body).toStrictEqual({ data: "x" });
	});

	it("should preserve a falsy data value (zero) in the body", () => {
		expect.assertions(1);

		const request = buildEnqueueRequest({
			data: 0,
			queueId: "q",
			universeId: "1",
		});

		expect(request.body).toStrictEqual({ data: 0 });
	});
});

describe(buildDequeueRequest, () => {
	it("should produce a GET request targeting the :read custom method", () => {
		expect.assertions(2);

		const request = buildDequeueRequest({
			queueId: "my-queue",
			universeId: "123",
		});

		expect(request.method).toBe("GET");
		expect(request.url).toBe("/cloud/v2/universes/123/memory-store/queues/my-queue/items:read");
	});

	it("should not carry a body or content-type", () => {
		expect.assertions(2);

		const request = buildDequeueRequest({ queueId: "q", universeId: "1" });

		expect(request.body).toBeUndefined();
		expect(request.headers).toBeUndefined();
	});

	it("should serialize count, allOrNothing, and invisibilityWindow into the query string", () => {
		expect.assertions(1);

		const request = buildDequeueRequest({
			allOrNothing: true,
			count: 5,
			invisibilityWindow: 30,
			queueId: "q",
			universeId: "1",
		});

		expect(request.url).toBe(
			"/cloud/v2/universes/1/memory-store/queues/q/items:read?count=5&allOrNothing=true&invisibilityWindow=30s",
		);
	});

	it("should omit query keys for parameters not supplied", () => {
		expect.assertions(2);

		const request = buildDequeueRequest({
			count: 3,
			queueId: "q",
			universeId: "1",
		});

		expect(request.url).toContain("?count=3");
		expect(request.url).not.toContain("invisibilityWindow");
	});
});

describe(buildDiscardRequest, () => {
	it("should produce a POST request targeting the :discard custom method", () => {
		expect.assertions(2);

		const request = buildDiscardRequest({
			queueId: "my-queue",
			readId: "abc",
			universeId: "123",
		});

		expect(request.method).toBe("POST");
		expect(request.url).toBe(
			"/cloud/v2/universes/123/memory-store/queues/my-queue/items:discard",
		);
	});

	it("should send the readId in the JSON body, matching the schema", () => {
		expect.assertions(2);

		const request = buildDiscardRequest({
			queueId: "q",
			readId: "1a354bd5",
			universeId: "1",
		});

		expect(request.body).toStrictEqual({ readId: "1a354bd5" });
		expect(request.headers).toStrictEqual({ "content-type": "application/json" });
	});
});
