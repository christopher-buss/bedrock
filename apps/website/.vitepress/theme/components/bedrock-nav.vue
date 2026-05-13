<script setup lang="ts">
import { useData, useRoute, withBase } from "vitepress";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { version as bedrockVersion } from "@bedrock-rbx/core/package.json";

interface UnifiedNavLink {
	readonly divider?: boolean;
	readonly external?: boolean;
	readonly href: string;
	readonly section: "bridge" | "docs" | "landing";
	readonly text: string;
}

interface Props {
	readonly homeHref?: string;
	readonly showSearch?: boolean;
}

const { homeHref = "/", showSearch = false } = defineProps<Props>();

const VERSION = `v${bedrockVersion}`;

// Single source of truth for the nav: a flat list with explicit divider
// placement and section ownership. The landing-side items are page-anchors
// on the homepage; the bridge (`Docs`) lights up the bedrock docs section;
// the docs-side items are bedrock-specific. Ocale is a peer package and
// lives outside this list as a separate affordance in the right cluster.
const UNIFIED_LINKS: ReadonlyArray<UnifiedNavLink> = [
	{ href: "/#features", section: "landing", text: "Features" },
	{ href: "/#install", section: "landing", text: "Quickstart" },
	{ divider: true, href: "/bedrock/introduction", section: "bridge", text: "Docs" },
	{ href: "/bedrock/api/", section: "docs", text: "API" },
	{ href: "#", section: "docs", text: "CLI" },
	{
		external: true,
		href: "https://github.com/christopher-buss/bedrock/releases",
		section: "docs",
		text: "Changelog",
	},
];

const OCALE_HREF = "/ocale/guide/getting-started";

const BRIDGE_INDEX = UNIFIED_LINKS.findIndex((link) => link.section === "bridge");

const { isDark } = useData();
const route = useRoute();

function normalizePath(value: string): string {
	return value.toLowerCase().replace(/\/$/u, "");
}

const currentPath = computed(() => normalizePath(route.path));

const currentSection = computed<"docs" | "landing">(() =>
	currentPath.value.startsWith("/bedrock") ? "docs" : "landing",
);

function isRouteLink(link: UnifiedNavLink): boolean {
	return !link.external && !link.href.startsWith("#") && !link.href.includes("/#");
}

// Longest-prefix match: /bedrock/api/functions/diff lights up "API" rather
// than nothing. Equality alone would only match top-level pages.
const activeIndex = computed<number>(() => {
	let bestIndex = -1;
	let bestLength = 0;
	for (const [index, link] of UNIFIED_LINKS.entries()) {
		if (!isRouteLink(link)) {
			continue;
		}

		const linkPath = normalizePath(link.href);
		if (linkPath.length === 0) {
			continue;
		}

		const matches =
			currentPath.value === linkPath || currentPath.value.startsWith(`${linkPath}/`);
		if (matches && linkPath.length > bestLength) {
			bestIndex = index;
			bestLength = linkPath.length;
		}
	}

	return bestIndex;
});

// Anchor sections on the landing that scroll-spy can light up. Order matches
// the position of the link in UNIFIED_LINKS so the underline lands on the
// correct item.
const ANCHOR_SECTION_IDS: ReadonlyArray<string> = ["features", "install"];

const intersectingSections = ref<ReadonlySet<string>>(new Set());

// Pick the *last* intersecting section so when both briefly overlap the
// scroll band, the lower (further-scrolled) one wins. Picking the first
// would flicker back up as soon as the next section enters.
const scrollSpyIndex = computed<number>(() => {
	let last = -1;
	for (const [index, id] of ANCHOR_SECTION_IDS.entries()) {
		if (intersectingSections.value.has(id)) {
			last = index;
		}
	}

	return last;
});

// Scroll-spy takes precedence on the landing route; everywhere else the
// route-based active index wins.
const currentActiveIndex = computed<number>(() => {
	if (currentSection.value === "landing" && scrollSpyIndex.value >= 0) {
		return scrollSpyIndex.value;
	}

	return activeIndex.value;
});

function isActive(index: number): boolean {
	return currentActiveIndex.value === index;
}

function ariaCurrentFor(link: UnifiedNavLink, index: number): "location" | "page" | undefined {
	if (!isActive(index)) {
		return undefined;
	}

	return isRouteLink(link) ? "page" : "location";
}

function isPhantom(link: UnifiedNavLink): boolean {
	if (link.section === "bridge") {
		return false;
	}

	return link.section !== currentSection.value;
}

// Opacity ladder by distance from the bridge. The 0.35 floor sits below
// strict WCAG AA Normal text contrast, but :hover and :focus-visible both
// restore to 1, so any user actively engaging with a phantom item sees it
// at full strength. The fade is a peripheral-vision cue, not a contrast
// statement.
function phantomOpacity(link: UnifiedNavLink, index: number): number | undefined {
	if (!isPhantom(link) || BRIDGE_INDEX === -1) {
		return undefined;
	}

	const distance = Math.abs(index - BRIDGE_INDEX);
	return Math.max(0.35, 0.85 - distance * 0.18);
}

function linkHref(link: UnifiedNavLink): string {
	if (link.external || link.href.startsWith("#") || link.href.includes("/#")) {
		return link.href;
	}

	return withBase(link.href);
}

function toggleTheme(): void {
	isDark.value = !isDark.value;
}

// Template refs for the sliding underline. Each <a> registers itself so we
// can read its layout box and position the underline beneath it. `linkRefs`
// is populated by inline `:ref` bindings in the template.
const navLinksElement = ref<HTMLDivElement | null>(null);
const linkRefs = ref<Array<HTMLAnchorElement | null>>([]);

const underlineStyle = ref<{
	opacity: string;
	transform: string;
	width: string;
}>({
	opacity: "0",
	transform: "translateX(0)",
	width: "0px",
});

// Use `offsetLeft` / `offsetWidth` (layout-relative, not affected by scroll)
// rather than `getBoundingClientRect` (viewport-relative). The underline
// lives inside `.nav-links`, which is the scrolling container on narrow
// viewports; using viewport coords would drift in the wrong direction as
// the row scrolls.
function updateUnderline(): void {
	const index = currentActiveIndex.value;
	const item = index >= 0 ? linkRefs.value[index] : null;
	if (item === null || item === undefined || navLinksElement.value === null) {
		underlineStyle.value = { ...underlineStyle.value, opacity: "0" };
		return;
	}

	underlineStyle.value = {
		opacity: "1",
		transform: `translateX(${item.offsetLeft}px)`,
		width: `${item.offsetWidth}px`,
	};
}

let observer: IntersectionObserver | undefined;
let resizeObserver: ResizeObserver | undefined;

function teardownScrollSpy(): void {
	observer?.disconnect();
	observer = undefined;
	intersectingSections.value = new Set();
}

function setupScrollSpy(): void {
	teardownScrollSpy();
	if (currentSection.value !== "landing") {
		return;
	}

	const observed: Array<Element> = [];
	for (const id of ANCHOR_SECTION_IDS) {
		const element = document.getElementById(id);
		if (element !== null) {
			observed.push(element);
		}
	}

	if (observed.length === 0) {
		return;
	}

	observer = new IntersectionObserver(
		(entries) => {
			const next = new Set(intersectingSections.value);
			for (const entry of entries) {
				if (entry.isIntersecting) {
					next.add(entry.target.id);
				} else {
					next.delete(entry.target.id);
				}
			}

			intersectingSections.value = next;
		},
		{ rootMargin: "-40% 0px -50% 0px" },
	);

	for (const element of observed) {
		observer.observe(element);
	}
}

watch(
	currentActiveIndex,
	() => {
		void nextTick(updateUnderline);
	},
	{ flush: "post" },
);

watch(currentSection, () => {
	void nextTick(() => {
		setupScrollSpy();
		updateUnderline();
	});
});

onMounted(() => {
	setupScrollSpy();
	updateUnderline();
	if (navLinksElement.value !== null) {
		resizeObserver = new ResizeObserver(() => {
			updateUnderline();
		});
		resizeObserver.observe(navLinksElement.value);
	}
});

onBeforeUnmount(() => {
	teardownScrollSpy();
	resizeObserver?.disconnect();
	resizeObserver = undefined;
});
</script>

<template>
	<nav class="bedrock-nav">
		<div class="wrap inner">
			<a class="brand" :href="homeHref">
				<span class="brand-mark"> <span /><span /><span /><span /> </span>
				Bedrock<span class="nav-v">{{ VERSION }}</span>
			</a>
			<div ref="navLinksElement" class="nav-links">
				<template v-for="(link, index) in UNIFIED_LINKS" :key="link.href">
					<span v-if="link.divider" class="nav-divider" aria-hidden="true" />
					<a
						:ref="(element) => (linkRefs[index] = element as HTMLAnchorElement | null)"
						:aria-current="ariaCurrentFor(link, index)"
						:class="{ active: isActive(index), phantom: isPhantom(link) }"
						:data-text="link.text"
						:href="linkHref(link)"
						:rel="link.external ? 'noopener noreferrer' : undefined"
						:style="
							phantomOpacity(link, index) !== undefined
								? { '--phantom-opacity': phantomOpacity(link, index) }
								: undefined
						"
						:target="link.external ? '_blank' : undefined"
					>
						{{ link.text }}
					</a>
				</template>
				<span class="nav-underline" :style="underlineStyle" aria-hidden="true" />
			</div>
			<div class="nav-right">
				<button v-if="showSearch" class="nav-search" type="button" aria-label="Search docs">
					<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.4" />
						<path
							d="m11 11 3 3"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linecap="round"
						/>
					</svg>
					Search docs&hellip;
					<span class="kbd">&#8984;K</span>
				</button>
				<button class="theme-toggle" aria-label="Toggle theme" @click="toggleTheme">
					<svg
						v-if="!isDark"
						class="icon-moon"
						viewBox="0 0 16 16"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linejoin="round"
						/>
					</svg>
					<svg v-else class="icon-sun" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.4" />
						<path
							d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4"
							stroke="currentColor"
							stroke-width="1.4"
							stroke-linecap="round"
						/>
					</svg>
				</button>
				<a class="nav-cta nav-cta-secondary" :href="withBase(OCALE_HREF)">
					<span class="nav-cta-mark" aria-hidden="true"> <span /><span /><span /> </span>
					Ocale
				</a>
				<a class="nav-cta" href="https://github.com/christopher-buss/bedrock">
					GitHub
					<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
						<path
							d="M3 9L9 3M9 3H4M9 3V8"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
					</svg>
				</a>
			</div>
		</div>
	</nav>
</template>

<style scoped>
.bedrock-nav {
	position: sticky;
	top: 0;
	z-index: 40;
	backdrop-filter: blur(14px);
	background: var(--bg-nav);
	border-bottom: 1px solid var(--line);
	transition:
		background-color 0.25s var(--ease),
		border-color 0.25s var(--ease),
		color 0.2s var(--ease);
}

.bedrock-nav a {
	color: inherit;
	text-decoration: none;
}

.bedrock-nav button {
	font: inherit;
	cursor: pointer;
	border: 0;
	background: none;
	color: inherit;
	padding: 0;
}

.wrap {
	max-width: var(--bedrock-wrap, 1200px);
	margin: 0 auto;
	padding: 0 32px;
}

.inner {
	display: flex;
	align-items: center;
	justify-content: space-between;
	height: 60px;
	gap: 24px;
}

.brand {
	display: inline-flex;
	align-items: center;
	gap: 10px;
	font-family: var(--f-serif);
	font-size: 23px;
	letter-spacing: -0.01em;
}

.brand-mark {
	width: 22px;
	height: 22px;
	display: grid;
	grid-template-rows: repeat(4, 1fr);
	gap: 2px;
}

.brand-mark span {
	background: var(--ink);
	border-radius: 1px;
}

.brand-mark span:nth-child(1) {
	opacity: 0.3;
}

.brand-mark span:nth-child(2) {
	opacity: 0.55;
}

.brand-mark span:nth-child(3) {
	opacity: 0.8;
}

.brand-mark span:nth-child(4) {
	background: var(--accent);
	opacity: 1;
}

.nav-v {
	font-family: var(--f-mono);
	font-size: 11px;
	color: var(--ink-4);
	padding: 2px 6px;
	background: var(--bg-soft);
	border-radius: 3px;
	margin-left: 8px;
}

.nav-links {
	position: relative;
	display: flex;
	align-items: center;
	gap: 20px;
}

.nav-underline {
	position: absolute;
	bottom: 0;
	left: 0;
	height: 2px;
	background: var(--accent);
	border-radius: 1px;
	pointer-events: none;
	transition:
		transform 0.28s var(--ease),
		width 0.28s var(--ease),
		opacity 0.18s var(--ease);
	will-change: transform, width;
}

@media (prefers-reduced-motion: reduce) {
	.nav-underline {
		transition: opacity 0.18s var(--ease);
	}
}

.nav-divider {
	width: 1px;
	height: 18px;
	background: var(--line);
}

.nav-links a {
	/* `inline-grid` + a ghost `::before` at the active weight reserves the
	   bold width so siblings don't reflow when the underline lands on a new
	   item. The cell sizes to max(text-at-current-weight, ::before-at-500). */
	display: inline-grid;
	place-items: center;
	font-size: 14px;
	color: var(--ink-2);
	position: relative;
	padding: 20px 0;
	transition: color 0.15s var(--ease);
	border-radius: 2px;
}

.nav-links a::before {
	content: attr(data-text);
	grid-area: 1 / 1;
	font-weight: 500;
	visibility: hidden;
	pointer-events: none;
}

.nav-links a:hover {
	color: var(--ink);
}

.nav-links a:focus-visible {
	outline: 2px solid var(--accent);
	outline-offset: 4px;
}

.nav-links a.phantom {
	opacity: var(--phantom-opacity, 0.35);
	transition:
		color 0.15s var(--ease),
		opacity 0.18s var(--ease);
}

.nav-links a.phantom:hover,
.nav-links a.phantom:focus-visible {
	opacity: 1;
	color: var(--ink);
}

.nav-links a.active {
	color: var(--ink);
	font-weight: 500;
}

.nav-right {
	display: flex;
	align-items: center;
	gap: 8px;
}

.nav-search {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	padding: 6px 10px 6px 12px;
	background: var(--bg-soft);
	border: 1px solid var(--line);
	border-radius: 8px;
	font-size: 13px;
	color: var(--ink-3);
	min-width: 220px;
	transition: all 0.15s var(--ease);
	cursor: pointer;
}

.nav-search:hover {
	border-color: var(--line-strong);
	color: var(--ink-2);
}

.nav-search:focus-visible {
	outline: 2px solid var(--accent);
	outline-offset: 2px;
}

.nav-search svg {
	width: 13px;
	height: 13px;
	opacity: 0.7;
}

.nav-search .kbd {
	margin-left: auto;
	font-family: var(--f-mono);
	font-size: 10.5px;
	padding: 1px 5px;
	border: 1px solid var(--line-strong);
	border-radius: 3px;
	color: var(--ink-4);
	background: var(--bg);
}

.theme-toggle {
	width: 32px;
	height: 32px;
	border: 1px solid var(--line);
	border-radius: 999px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	color: var(--ink-2);
	transition: all 0.15s var(--ease);
}

.theme-toggle:hover {
	border-color: var(--ink-3);
	color: var(--ink);
	background: var(--bg-soft);
}

.theme-toggle:focus-visible {
	outline: 2px solid var(--accent);
	outline-offset: 2px;
}

.theme-toggle svg {
	width: 14px;
	height: 14px;
}

.nav-cta {
	font-size: 13px;
	padding: 6px 12px 6px 14px;
	border: 1px solid var(--line-strong);
	border-radius: 999px;
	display: inline-flex;
	align-items: center;
	gap: 6px;
	transition: all 0.15s var(--ease);
}

.nav-cta:hover {
	border-color: var(--ink);
	background: var(--ink);
	color: var(--bg);
}

.nav-cta:focus-visible {
	outline: 2px solid var(--accent);
	outline-offset: 2px;
}

.nav-cta-secondary {
	color: var(--ink-3);
	padding-left: 10px;
	gap: 8px;
}

.nav-cta-secondary:hover {
	border-color: var(--accent-deep);
	background: transparent;
	color: var(--accent-deep);
}

html.dark .nav-cta-secondary:hover {
	border-color: var(--accent-soft);
	color: var(--accent-soft);
}

.nav-cta-mark {
	width: 10px;
	height: 10px;
	display: grid;
	grid-template-rows: repeat(3, 1fr);
	gap: 1.5px;
}

.nav-cta-mark span {
	background: currentColor;
	border-radius: 1px;
	opacity: 0.55;
}

.nav-cta-mark span:nth-child(3) {
	background: var(--accent);
	opacity: 1;
}

html.dark .nav-cta-mark span:nth-child(3) {
	background: var(--accent-soft);
}

@media (max-width: 960px) {
	.nav-links {
		gap: 14px;
	}

	.nav-links a {
		font-size: 13px;
	}

	.nav-search {
		min-width: 160px;
	}
}

@media (max-width: 760px) {
	.wrap {
		padding: 0 20px;
	}

	.inner {
		flex-wrap: wrap;
		height: auto;
		padding-top: 12px;
		padding-bottom: 12px;
		row-gap: 8px;
	}

	.nav-links {
		order: 3;
		width: 100%;
		overflow-x: auto;
		flex-wrap: nowrap;
		scrollbar-width: none;
		padding-bottom: 4px;
	}

	.nav-links::-webkit-scrollbar {
		display: none;
	}

	.nav-search {
		display: none;
	}
}
</style>
