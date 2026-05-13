import { cleanup, render, screen } from "@testing-library/vue";

import { describe, expect, it, onTestFinished, vi } from "vitest";
import { defineComponent, ref } from "vue";

import Layout from "./layout.vue";

const frontmatter = ref<{ layout?: string }>({});

// vitepress/theme exports a Theme with a DefineComponent Layout; vitepress
// exports a complex VitePressData via useData. Partial stubbing via the typed
// import("...") form is impractical for either, so use string-form mocks here.
/* eslint-disable vitest/prefer-import-in-mock -- see note above */
vi.mock("vitepress/theme", () => {
	return {
		default: {
			Layout: defineComponent({
				name: "DefaultLayout",
				template: '<div data-testid="default-layout">default</div>',
			}),
		},
	};
});

vi.mock("vitepress", () => ({ useData: () => ({ frontmatter }) }));

vi.mock("./home-landing.vue", () => {
	return {
		default: defineComponent({
			name: "HomeLanding",
			template: '<div data-testid="home-landing">landing</div>',
		}),
	};
});
/* eslint-enable vitest/prefer-import-in-mock */

function renderLayout(): void {
	onTestFinished(cleanup);
	render(Layout);
}

describe(Layout, () => {
	it("should render the home landing when frontmatter.layout is 'landing'", () => {
		expect.assertions(2);

		frontmatter.value = { layout: "landing" };
		renderLayout();

		expect(screen.queryByTestId("home-landing")).not.toBeNull();
		expect(screen.queryByTestId("default-layout")).toBeNull();
	});

	it("should render the default vitepress layout when frontmatter.layout is not 'landing'", () => {
		expect.assertions(2);

		frontmatter.value = { layout: "home" };
		renderLayout();

		expect(screen.queryByTestId("default-layout")).not.toBeNull();
		expect(screen.queryByTestId("home-landing")).toBeNull();
	});
});
