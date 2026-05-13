import { version as bedrockVersion } from "@bedrock-rbx/core/package.json";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, within } from "@testing-library/vue";
import { fromPartial } from "@total-typescript/shoehorn";

import type * as VitePress from "vitepress";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { ref } from "vue";

import HomeLanding from "./home-landing.vue";

const frontmatter = ref<{ layout?: string }>({});
const isDark = ref(false);

vi.mock(import("vitepress"), () => {
	return fromPartial<typeof VitePress>({
		useData: () => fromPartial<ReturnType<typeof VitePress.useData>>({ frontmatter, isDark }),
	});
});

function renderLanding(): void {
	onTestFinished(cleanup);
	frontmatter.value = {};
	isDark.value = false;
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

	it("should write the install command to the clipboard on copy click", async () => {
		expect.assertions(1);

		const writeText = installFakeClipboard();
		renderLanding();
		const user = userEvent.setup();

		await user.click(copyButton());

		expect(writeText).toHaveBeenCalledWith("pnpm add @bedrock-rbx/core");
	});

	it("should flip the copy button label to 'copied' after a successful write", async () => {
		expect.assertions(1);

		installFakeClipboard();
		renderLanding();
		const user = userEvent.setup();

		await user.click(copyButton());

		expect(copyButton().textContent.trim()).toBe("copied");
	});

	it("should revert the copy button label to 'copy' after the timeout elapses", async () => {
		expect.assertions(2);

		installFakeClipboard();
		installFakeTimers();
		renderLanding();
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

		await user.click(copyButton());

		expect(copyButton().textContent.trim()).toBe("copied");

		await vi.advanceTimersByTimeAsync(1200);

		expect(copyButton().textContent.trim()).toBe("copy");
	});

	it("should reset the revert timer when copy is clicked again before it elapses", async () => {
		expect.assertions(2);

		installFakeClipboard();
		installFakeTimers();
		renderLanding();
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

		await user.click(copyButton());
		await vi.advanceTimersByTimeAsync(800);
		await user.click(copyButton());
		await vi.advanceTimersByTimeAsync(800);

		// 1600ms after the first click but only 800ms since the second click,
		// so the label is still "copied" — the first timer was cleared.
		expect(copyButton().textContent.trim()).toBe("copied");

		await vi.advanceTimersByTimeAsync(400);

		expect(copyButton().textContent.trim()).toBe("copy");
	});

	it("should leave the copy button label unchanged when writeText rejects", async () => {
		expect.assertions(1);

		installFakeClipboard(async () => {
			throw new Error("permission denied");
		});
		renderLanding();
		const user = userEvent.setup();

		await user.click(copyButton());

		expect(copyButton().textContent.trim()).toBe("copy");
	});

	it("should show the moon icon when the theme is light", () => {
		expect.assertions(2);

		renderLanding();

		expect(themeToggle().querySelector(".icon-moon")).not.toBeNull();
		expect(themeToggle().querySelector(".icon-sun")).toBeNull();
	});

	it("should swap the moon icon for the sun icon when the toggle is clicked", async () => {
		expect.assertions(2);

		renderLanding();
		const user = userEvent.setup();

		await user.click(themeToggle());

		expect(themeToggle().querySelector(".icon-sun")).not.toBeNull();
		expect(themeToggle().querySelector(".icon-moon")).toBeNull();
	});

	it("should swap the sun icon back to the moon icon on a second click", async () => {
		expect.assertions(1);

		renderLanding();
		const user = userEvent.setup();

		await user.click(themeToggle());
		await user.click(themeToggle());

		expect(themeToggle().querySelector(".icon-moon")).not.toBeNull();
	});
});

function themeToggle(): HTMLElement {
	return screen.getByRole("button", { name: "Toggle theme" });
}

function copyButton(): HTMLElement {
	return screen.getByRole("button", { name: "Copy install command" });
}

async function noopWrite(): Promise<void> {
	/* default: resolve immediately */
}

function installFakeClipboard(writeImpl: (text: string) => Promise<void> = noopWrite) {
	const spy = vi.spyOn(globalThis.navigator.clipboard, "writeText");
	spy.mockImplementation(writeImpl);
	onTestFinished(() => {
		spy.mockRestore();
	});
	return spy;
}

function installFakeTimers(): void {
	onTestFinished(() => {
		vi.useRealTimers();
	});
	vi.useFakeTimers();
}
