import { describe, expect, it } from "vitest";

import { OpenCloudError } from "./base.ts";
import { NetworkError } from "./network-error.ts";

describe(NetworkError, () => {
	it("should set name to NetworkError", () => {
		expect.assertions(1);

		const error = new NetworkError("fetch failed");

		expect(error.name).toBe("NetworkError");
	});

	it("should set message from constructor argument", () => {
		expect.assertions(1);

		const error = new NetworkError("DNS resolution failed");

		expect(error.message).toBe("DNS resolution failed");
	});

	it("should be an instance of OpenCloudError", () => {
		expect.assertions(1);

		const error = new NetworkError("fetch failed");

		expect(error).toBeInstanceOf(OpenCloudError);
	});

	it("should be an instance of Error", () => {
		expect.assertions(1);

		const error = new NetworkError("fetch failed");

		expect(error).toBeInstanceOf(Error);
	});

	it("should store cause when provided", () => {
		expect.assertions(1);

		const cause = new TypeError("Failed to fetch");
		const error = new NetworkError("request failed", { cause });

		expect(error.cause).toBe(cause);
	});

	it("should have undefined cause when not provided", () => {
		expect.assertions(1);

		const error = new NetworkError("fetch failed");

		expect(error.cause).toBeUndefined();
	});

	it("should store the request method and url when provided", () => {
		expect.assertions(2);

		const error = new NetworkError("Network request failed", {
			method: "GET",
			url: "https://apis.roblox.com/cloud/v2/ping",
		});

		expect(error.method).toBe("GET");
		expect(error.url).toBe("https://apis.roblox.com/cloud/v2/ping");
	});

	it("should have undefined method and url when not provided", () => {
		expect.assertions(2);

		const error = new NetworkError("fetch failed");

		expect(error.method).toBeUndefined();
		expect(error.url).toBeUndefined();
	});
});
