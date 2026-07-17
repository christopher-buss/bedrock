import { describe, expect, it } from "vitest";

import { extractGatewaySummary, pickDiagnosticHeaders } from "./diagnostics.ts";

describe(pickDiagnosticHeaders, () => {
	it("should keep allowlisted escalation headers and drop everything else", () => {
		expect.assertions(1);

		const headers = {
			"authorization": "Bearer secret",
			"content-length": "37",
			"server": "haproxy",
			"via": "1.1 edge",
			"x-ratelimit-remaining": "70000",
			"x-request-id": "abc-123",
		};

		expect(pickDiagnosticHeaders(headers)).toStrictEqual({
			"server": "haproxy",
			"via": "1.1 edge",
			"x-request-id": "abc-123",
		});
	});

	it("should keep any x-roblox-* header by prefix", () => {
		expect.assertions(1);

		const headers = { "content-type": "text/html", "x-roblox-edge": "c173" };

		expect(pickDiagnosticHeaders(headers)).toStrictEqual({ "x-roblox-edge": "c173" });
	});

	it("should return an empty record when no header is allowlisted", () => {
		expect.assertions(1);

		const headers = { "content-length": "0", "set-cookie": "sid=1" };

		expect(pickDiagnosticHeaders(headers)).toStrictEqual({});
	});
});

describe(extractGatewaySummary, () => {
	it("should extract the h1 text from an html body when no content-type is given", () => {
		expect.assertions(1);

		const body =
			"<html><body><h1>400 Bad request</h1>\nYour browser sent an invalid request.\n</body></html>";

		expect(extractGatewaySummary(undefined, body)).toBe("400 Bad request");
	});

	it("should prefer the title over the h1 when both are present", () => {
		expect.assertions(1);

		const body =
			"<html><head><title>503 Service Unavailable</title></head><body><h1>oops</h1></body></html>";

		expect(extractGatewaySummary("text/html", body)).toBe("503 Service Unavailable");
	});

	it("should detect an html page from the content-type even if the body is not tag-led", () => {
		expect.assertions(1);

		const body = "\n\n  <h1>502 Bad Gateway</h1>";

		expect(extractGatewaySummary("text/html; charset=utf-8", body)).toBe("502 Bad Gateway");
	});

	it("should detect a tag-led html body only after trimming leading whitespace", () => {
		expect.assertions(1);

		const body = "\n  <html><h1>500 Internal</h1></html>";

		expect(extractGatewaySummary(undefined, body)).toBe("500 Internal");
	});

	it("should collapse whitespace and trim the extracted summary", () => {
		expect.assertions(1);

		const body = "<!DOCTYPE html><HTML><BODY><H1>  400  Bad   request  </H1></BODY></HTML>";

		expect(extractGatewaySummary(undefined, body)).toBe("400 Bad request");
	});

	it("should replace a nested tag with a space rather than deleting it", () => {
		expect.assertions(1);

		expect(extractGatewaySummary(undefined, "<html><h1>400<br>Bad request</h1></html>")).toBe(
			"400 Bad request",
		);
	});

	it("should return undefined when the matched heading collapses to empty text", () => {
		expect.assertions(1);

		expect(extractGatewaySummary("text/html", "<html><h1>   </h1></html>")).toBeUndefined();
	});

	it("should return undefined for a non-html body", () => {
		expect.assertions(1);

		expect(extractGatewaySummary("application/json", '{"message":"nope"}')).toBeUndefined();
	});

	it("should not treat a non-html body as a gateway page even when it embeds an h1", () => {
		expect.assertions(1);

		expect(extractGatewaySummary("text/plain", "intro <h1>Heading</h1>")).toBeUndefined();
	});

	it("should return undefined for an html page with no title or h1 text", () => {
		expect.assertions(1);

		expect(
			extractGatewaySummary("text/html", "<html><body><p>hi</p></body></html>"),
		).toBeUndefined();
	});
});
