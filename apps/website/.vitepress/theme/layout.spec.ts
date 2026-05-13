import { cleanup, render, screen } from "@testing-library/vue";
import { fromPartial } from "@total-typescript/shoehorn";

import type * as VitePress from "vitepress";
import type * as VitePressTheme from "vitepress/theme";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { defineComponent, ref } from "vue";

import type * as HomeLandingModule from "./home-landing.vue";
import Layout from "./layout.vue";

const frontmatter = ref<{ layout?: string }>({});

vi.mock(import("vitepress/theme"), () => {
	return fromPartial<typeof VitePressTheme>({
		default: {
			Layout: defineComponent({
				name: "DefaultLayout",
				template: '<div data-testid="default-layout">default</div>',
			}),
		},
	});
});

vi.mock(import("vitepress"), () => {
	return fromPartial<typeof VitePress>({
		useData: () => fromPartial<ReturnType<typeof VitePress.useData>>({ frontmatter }),
	});
});

vi.mock(import("./home-landing.vue"), () => {
	return fromPartial<typeof HomeLandingModule>({
		default: defineComponent({
			name: "HomeLanding",
			template: '<div data-testid="home-landing">landing</div>',
		}),
	});
});

function renderLayout(layout?: string): void {
	onTestFinished(cleanup);
	frontmatter.value = layout === undefined ? {} : { layout };
	render(Layout);
}

describe(Layout, () => {
	it("should render the home landing when frontmatter.layout is 'landing'", () => {
		expect.assertions(2);

		renderLayout("landing");

		expect(screen.queryByTestId("home-landing")).not.toBeNull();
		expect(screen.queryByTestId("default-layout")).toBeNull();
	});

	it("should render the default vitepress layout when frontmatter.layout is not 'landing'", () => {
		expect.assertions(2);

		renderLayout("home");

		expect(screen.queryByTestId("default-layout")).not.toBeNull();
		expect(screen.queryByTestId("home-landing")).toBeNull();
	});
});
