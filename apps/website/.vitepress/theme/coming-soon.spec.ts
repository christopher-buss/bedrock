import { version as bedrockVersion } from "@bedrock-rbx/core/package.json";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, within } from "@testing-library/vue";
import { fromPartial } from "@total-typescript/shoehorn";

import type * as VitePress from "vitepress";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { ref } from "vue";

import ComingSoon from "./coming-soon.vue";

const frontmatter = ref<{ layout?: string }>({});
const isDark = ref(false);

vi.mock(import("vitepress"), () => {
	return fromPartial<typeof VitePress>({
		useData: () => fromPartial<ReturnType<typeof VitePress.useData>>({ frontmatter, isDark }),
	});
});

function renderComingSoon(): void {
	onTestFinished(cleanup);
	frontmatter.value = {};
	isDark.value = false;
	render(ComingSoon);
}

function codeTab(name: string): HTMLElement {
	const tablist = screen.getByRole("tablist", { name: "Code sample" });
	return within(tablist).getByRole("tab", { name: new RegExp(`^${name}$`, "i") });
}

function isSelected(element: HTMLElement): string {
	return element.getAttribute("aria-selected") ?? "";
}

function themeToggle(): HTMLElement {
	return screen.getByRole("button", { name: "Toggle theme" });
}

function linkTargets(): Array<string> {
	return Array.from(
		document.querySelectorAll("a"),
		(anchor) => anchor.getAttribute("href") ?? "",
	);
}

describe(ComingSoon, () => {
	it("should announce that the project is not ready to be used yet", () => {
		expect.assertions(1);

		renderComingSoon();

		expect(screen.getAllByText(/coming soon/i)).not.toHaveLength(0);
	});

	it("should render the current bedrock version", () => {
		expect.assertions(1);

		renderComingSoon();

		expect(screen.getAllByText(`v${bedrockVersion}`)).not.toHaveLength(0);
	});

	it("should not send readers to any documentation page", () => {
		expect.assertions(1);

		renderComingSoon();

		expect(linkTargets().filter((href) => /^\/(?:bedrock|ocale)\//.test(href))).toHaveLength(0);
	});

	it("should point readers at the GitHub repository instead", () => {
		expect.assertions(1);

		renderComingSoon();

		expect(linkTargets()).toContain("https://github.com/christopher-buss/bedrock");
	});

	it("should mark the config code tab active by default", () => {
		expect.assertions(3);

		renderComingSoon();

		expect(isSelected(codeTab("config"))).toBe("true");
		expect(isSelected(codeTab("deploy"))).toBe("false");
		expect(isSelected(codeTab("cli"))).toBe("false");
	});

	it("should activate a code tab when it is clicked", async () => {
		expect.assertions(2);

		renderComingSoon();
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

			renderComingSoon();
			const user = userEvent.setup();

			codeTab(from).focus();
			await user.keyboard(key);

			expect(isSelected(codeTab(expected))).toBe("true");
		},
	);

	it("should leave the active code tab unchanged on non-arrow keys", async () => {
		expect.assertions(1);

		renderComingSoon();
		const user = userEvent.setup();

		codeTab("config").focus();
		await user.keyboard("a");

		expect(isSelected(codeTab("config"))).toBe("true");
	});

	it("should show the moon icon when the theme is light", () => {
		expect.assertions(2);

		renderComingSoon();

		expect(themeToggle().querySelector(".icon-moon")).not.toBeNull();
		expect(themeToggle().querySelector(".icon-sun")).toBeNull();
	});

	it("should swap the moon icon for the sun icon when the toggle is clicked", async () => {
		expect.assertions(2);

		renderComingSoon();
		const user = userEvent.setup();

		await user.click(themeToggle());

		expect(themeToggle().querySelector(".icon-sun")).not.toBeNull();
		expect(themeToggle().querySelector(".icon-moon")).toBeNull();
	});

	it("should expose the active theme on the toggle", async () => {
		expect.assertions(2);

		renderComingSoon();
		const user = userEvent.setup();

		expect(themeToggle().getAttribute("aria-pressed")).toBe("false");

		await user.click(themeToggle());

		expect(themeToggle().getAttribute("aria-pressed")).toBe("true");
	});

	it("should swap the sun icon back to the moon icon on a second click", async () => {
		expect.assertions(1);

		renderComingSoon();
		const user = userEvent.setup();

		await user.click(themeToggle());
		await user.click(themeToggle());

		expect(themeToggle().querySelector(".icon-moon")).not.toBeNull();
	});
});
