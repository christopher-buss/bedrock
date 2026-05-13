import { version as bedrockVersion } from "@bedrock-rbx/core/package.json";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, within } from "@testing-library/vue";

import { describe, expect, it, onTestFinished, vi } from "vitest";
import { ref } from "vue";

import HomeLanding from "./home-landing.vue";

const frontmatter = ref<{ layout?: string }>({});
const isDark = ref(false);

// vitepress's useData returns a 12+ field VitePressData; partial stubbing via
// the typed import("...") form is impractical, so use the string form here.
// eslint-disable-next-line vitest/prefer-import-in-mock -- see note above
vi.mock("vitepress", () => ({ useData: () => ({ frontmatter, isDark }) }));

function renderLanding(): void {
	onTestFinished(cleanup);
	render(HomeLanding);
}

function codeTab(name: string): HTMLElement {
	const tablist = screen.getByRole("tablist", { name: "Code sample" });
	return within(tablist).getByRole("tab", { name: new RegExp(`^${name}$`, "i") });
}

function termTab(name: string): HTMLElement {
	const tablist = screen.getByRole("tablist", { name: "CLI command" });
	return within(tablist).getByRole("tab", { name: new RegExp(`^${name}$`, "i") });
}

function isSelected(element: HTMLElement): string {
	return element.getAttribute("aria-selected") ?? "";
}

describe(HomeLanding, () => {
	it("should render the install command and the current bedrock version", () => {
		expect.assertions(2);

		renderLanding();

		expect(screen.getAllByText("pnpm add @bedrock-rbx/core")).not.toHaveLength(0);
		expect(screen.getAllByText(`v${bedrockVersion}`)).not.toHaveLength(0);
	});

	it("should mark the config code tab active by default", () => {
		expect.assertions(3);

		renderLanding();

		expect(isSelected(codeTab("config"))).toBe("true");
		expect(isSelected(codeTab("deploy"))).toBe("false");
		expect(isSelected(codeTab("cli"))).toBe("false");
	});

	it("should activate a code tab when it is clicked", async () => {
		expect.assertions(2);

		renderLanding();
		const user = userEvent.setup();

		await user.click(codeTab("deploy"));

		expect(isSelected(codeTab("deploy"))).toBe("true");
		expect(isSelected(codeTab("config"))).toBe("false");
	});

	it.for([
		{ key: "{ArrowRight}", expected: "deploy", from: "config" },
		{ key: "{ArrowRight}", expected: "cli", from: "deploy" },
		{ key: "{ArrowRight}", expected: "config", from: "cli" },
		{ key: "{ArrowLeft}", expected: "cli", from: "config" },
		{ key: "{ArrowLeft}", expected: "config", from: "deploy" },
		{ key: "{ArrowLeft}", expected: "deploy", from: "cli" },
	])(
		"should move the active code tab from $from to $expected on $key",
		async ({ key, expected, from }) => {
			expect.assertions(1);

			renderLanding();
			const user = userEvent.setup();

			codeTab(from).focus();
			await user.keyboard(key);

			expect(isSelected(codeTab(expected))).toBe("true");
		},
	);

	it("should leave the active code tab unchanged on non-arrow keys", async () => {
		expect.assertions(1);

		renderLanding();
		const user = userEvent.setup();

		codeTab("config").focus();
		await user.keyboard("a");

		expect(isSelected(codeTab("config"))).toBe("true");
	});

	it("should mark the diff terminal tab active by default", () => {
		expect.assertions(3);

		renderLanding();

		expect(isSelected(termTab("diff"))).toBe("true");
		expect(isSelected(termTab("deploy"))).toBe("false");
		expect(isSelected(termTab("migrate"))).toBe("false");
	});

	it("should activate a terminal tab when it is clicked", async () => {
		expect.assertions(2);

		renderLanding();
		const user = userEvent.setup();

		await user.click(termTab("migrate"));

		expect(isSelected(termTab("migrate"))).toBe("true");
		expect(isSelected(termTab("diff"))).toBe("false");
	});

	it.for([
		{ key: "{ArrowRight}", expected: "deploy", from: "diff" },
		{ key: "{ArrowRight}", expected: "migrate", from: "deploy" },
		{ key: "{ArrowRight}", expected: "diff", from: "migrate" },
		{ key: "{ArrowLeft}", expected: "migrate", from: "diff" },
		{ key: "{ArrowLeft}", expected: "diff", from: "deploy" },
		{ key: "{ArrowLeft}", expected: "deploy", from: "migrate" },
	])(
		"should move the active terminal tab from $from to $expected on $key",
		async ({ key, expected, from }) => {
			expect.assertions(1);

			renderLanding();
			const user = userEvent.setup();

			termTab(from).focus();
			await user.keyboard(key);

			expect(isSelected(termTab(expected))).toBe("true");
		},
	);

	it("should leave the active terminal tab unchanged on non-arrow keys", async () => {
		expect.assertions(1);

		renderLanding();
		const user = userEvent.setup();

		termTab("diff").focus();
		await user.keyboard("a");

		expect(isSelected(termTab("diff"))).toBe("true");
	});
});
