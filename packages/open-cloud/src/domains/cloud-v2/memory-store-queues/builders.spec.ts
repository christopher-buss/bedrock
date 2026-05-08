import { assert, describe, expect, it } from "vitest";

import { buildEnqueueRequest } from "./builders.ts";

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
