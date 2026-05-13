<script setup lang="ts">
import type { DefaultTheme } from "vitepress";
import { Content, useData, useRoute, withBase } from "vitepress";
import { computed } from "vue";

import { version as bedrockVersion } from "@bedrock-rbx/core/package.json";

type SidebarGroup = DefaultTheme.SidebarItem;
type SidebarLink = DefaultTheme.SidebarItem;

const VERSION = `v${bedrockVersion}`;

const { isDark, theme } = useData();
const route = useRoute();

const sidebar = computed<ReadonlyArray<SidebarGroup>>(() => {
	const config = theme.value.sidebar;
	if (config === undefined) {
		return [];
	}

	if (Array.isArray(config)) {
		return config;
	}

	const path = route.path;
	let best: ReadonlyArray<SidebarGroup> = [];
	let bestLength = 0;
	for (const [prefix, items] of Object.entries(config)) {
		if (!path.startsWith(prefix) || prefix.length <= bestLength) {
			continue;
		}

		if (Array.isArray(items)) {
			best = items;
			bestLength = prefix.length;
		}
	}

	return best;
});

function normalizePath(path: string): string {
	return path.replace(/\/$/u, "").toLowerCase();
}

const currentPath = computed(() => normalizePath(route.path));

function isLinkActive(link: string | undefined): boolean {
	if (link === undefined) {
		return false;
	}

	return normalizePath(link) === currentPath.value;
}

function isSectionCurrent(item: SidebarLink): boolean {
	if (isLinkActive(item.link)) {
		return true;
	}

	const children = item.items ?? [];
	return children.some((child) => isLinkActive(child.link));
}

function kindDot(link: string | undefined): "cls" | "const" | "fn" | "type" | undefined {
	if (link === undefined) {
		return undefined;
	}

	if (link.includes("/functions/")) {
		return "fn";
	}

	if (link.includes("/classes/")) {
		return "cls";
	}

	if (link.includes("/interfaces/") || link.includes("/type-aliases/")) {
		return "type";
	}

	if (link.includes("/variables/")) {
		return "const";
	}

	return undefined;
}

function toggleTheme(): void {
	isDark.value = !isDark.value;
}
</script>

<template>
	<div class="bedrock-intro">
		<nav class="bedrock-nav">
			<div class="wrap inner">
				<a class="brand" :href="withBase('/')">
					<span class="brand-mark"> <span /><span /><span /><span /> </span>
					Bedrock<span class="nav-v">{{ VERSION }}</span>
				</a>
				<div class="nav-links">
					<a class="active" :href="withBase('/bedrock/introduction')">Docs</a>
					<a :href="withBase('/bedrock/api/')">API</a>
					<a href="#">CLI</a>
					<a href="https://github.com/christopher-buss/bedrock/releases">Changelog</a>
				</div>
				<div class="nav-right">
					<div class="nav-search" role="button" tabindex="0" aria-label="Search docs">
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
					</div>
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
						<svg
							v-else
							class="icon-sun"
							viewBox="0 0 16 16"
							fill="none"
							aria-hidden="true"
						>
							<circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.4" />
							<path
								d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4"
								stroke="currentColor"
								stroke-width="1.4"
								stroke-linecap="round"
							/>
						</svg>
					</button>
					<a class="nav-cta" href="https://github.com/christopher-buss/bedrock">
						GitHub
						<svg
							width="11"
							height="11"
							viewBox="0 0 12 12"
							fill="none"
							aria-hidden="true"
						>
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

		<div class="wrap shell">
			<aside class="side" aria-label="Documentation navigation">
				<div v-for="(group, gi) in sidebar" :key="gi" class="side-group">
					<div v-if="group.text" class="side-title">{{ group.text }}</div>
					<template v-for="(item, ii) in group.items ?? []" :key="ii">
						<template v-if="(item.items ?? []).length > 0">
							<a
								v-if="item.link"
								class="side-link side-section-current"
								:class="{ active: isLinkActive(item.link) }"
								:href="withBase(item.link)"
							>
								{{ item.text }}
							</a>
							<div v-else class="side-link side-section-current">
								{{ item.text }}
							</div>
							<div class="side-sub">
								<a
									v-for="(child, ci) in item.items ?? []"
									:key="ci"
									class="side-link"
									:class="{ active: isLinkActive(child.link) }"
									:href="child.link ? withBase(child.link) : '#'"
								>
									<span
										v-if="kindDot(child.link)"
										class="dot"
										:class="kindDot(child.link)"
									/>
									<span class="name-mono">{{ child.text }}</span>
								</a>
							</div>
						</template>
						<a
							v-else
							class="side-link"
							:class="{
								'active': isLinkActive(item.link),
								'side-section-current':
									!isLinkActive(item.link) && isSectionCurrent(item),
							}"
							:href="item.link ? withBase(item.link) : '#'"
						>
							{{ item.text }}
						</a>
					</template>
				</div>
			</aside>

			<article class="article">
				<Content />
			</article>
		</div>

		<footer class="bedrock-foot">
			<div class="wrap">
				<div class="foot">
					<div class="foot-brand">
						<a class="brand" :href="withBase('/')">
							<span class="brand-mark"> <span /><span /><span /><span /> </span>
							Bedrock
						</a>
						<p>Infrastructure-as-Code for Roblox. Typed, Open Cloud only.</p>
					</div>
					<div>
						<h5>Docs</h5>
						<ul>
							<li>
								<a :href="withBase('/bedrock/introduction')">Introduction</a>
							</li>
							<li>
								<a :href="withBase('/bedrock/guide/getting-started')"
									>Getting started</a
								>
							</li>
							<li><a :href="withBase('/bedrock/api/')">API reference</a></li>
						</ul>
					</div>
					<div>
						<h5>Ocale</h5>
						<ul>
							<li>
								<a :href="withBase('/ocale/guide/getting-started')"
									>Getting started</a
								>
							</li>
							<li><a :href="withBase('/ocale/api/')">Resource clients</a></li>
							<li><a :href="withBase('/ocale/guide/errors')">Error hierarchy</a></li>
						</ul>
					</div>
					<div>
						<h5>Project</h5>
						<ul>
							<li>
								<a href="https://github.com/christopher-buss/bedrock">GitHub</a>
							</li>
							<li>
								<a
									href="https://github.com/christopher-buss/bedrock/tree/main/docs/adr"
								>
									ADRs
								</a>
							</li>
							<li>
								<a href="https://github.com/christopher-buss/bedrock/releases">
									Changelog
								</a>
							</li>
						</ul>
					</div>
				</div>
				<div class="foot-bottom">
					<div>&copy; 2026 &middot; MIT Licensed &middot; {{ VERSION }}</div>
					<div>built with vitepress</div>
				</div>
			</div>
		</footer>
	</div>
</template>

<style scoped>
.bedrock-intro {
	--bg: #f4f6fa;
	--bg-soft: #e9edf3;
	--bg-card: #ffffff;
	--bg-nav: rgba(244, 246, 250, 0.78);
	--ink: #0e131a;
	--ink-2: #2a3240;
	--ink-3: #5a6472;
	--ink-4: #8b95a4;
	--line: #dde2eb;
	--line-strong: #c4cbd6;

	--dark-bg: #0c1018;
	--dark-bg-2: #131826;
	--dark-line: #232a3a;
	--dark-ink: #eef1f7;
	--dark-ink-2: #b9c1d0;
	--dark-ink-3: #6f7889;

	--accent: #5944a2;
	--accent-soft: #a8bdd8;
	--accent-deep: #324a6e;
	--accent-bg: #e4ebf5;

	--ok: #4a8a64;
	--warn: #c89a3a;
	--del: #b5523a;

	--kind-fn: oklch(62% 0.115 235);
	--kind-type: oklch(68% 0.105 75);
	--kind-cls: oklch(58% 0.095 145);
	--kind-const: oklch(60% 0.115 305);

	--f-sans: "Geist", "Inter", system-ui, -apple-system, sans-serif;
	--f-serif: "Source Serif 4", "Source Serif Pro", "Times New Roman", serif;
	--f-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;

	--r-sm: 4px;
	--r: 8px;
	--r-lg: 14px;

	--ease: cubic-bezier(0.2, 0.7, 0.2, 1);

	min-height: 100vh;
	background: var(--bg);
	color: var(--ink);
	font-family: var(--f-sans);
	font-size: 15px;
	line-height: 1.6;
	-webkit-font-smoothing: antialiased;
	text-rendering: optimizeLegibility;
}

html.dark .bedrock-intro {
	--bg: #0d1119;
	--bg-soft: #141a26;
	--bg-card: #1a2030;
	--bg-nav: rgba(13, 17, 25, 0.78);
	--ink: #eef1f7;
	--ink-2: #c1c8d4;
	--ink-3: #828b9c;
	--ink-4: #565e6e;
	--line: #232a39;
	--line-strong: #2f3849;
	--accent-soft: #b8c9e0;
	--accent-deep: #4e6c92;
	--accent-bg: #1e2840;
}

.bedrock-intro,
.bedrock-intro .bedrock-nav,
.bedrock-intro .side,
.bedrock-intro .article {
	transition:
		background-color 0.25s var(--ease),
		border-color 0.25s var(--ease),
		color 0.2s var(--ease);
}

.bedrock-intro a {
	color: inherit;
	text-decoration: none;
}

.bedrock-intro button {
	font: inherit;
	cursor: pointer;
	border: 0;
	background: none;
	color: inherit;
	padding: 0;
}

.bedrock-intro ::selection {
	background: var(--accent);
	color: #fff;
}

.wrap {
	max-width: 1280px;
	margin: 0 auto;
	padding: 0 32px;
}

/* Nav (mirrors the landing's shape so navigating between feels seamless) */
.bedrock-nav {
	position: sticky;
	top: 0;
	z-index: 40;
	backdrop-filter: blur(14px);
	background: var(--bg-nav);
	border-bottom: 1px solid var(--line);
}

.bedrock-nav .inner {
	display: flex;
	align-items: center;
	justify-content: space-between;
	height: 60px;
	gap: 24px;
}

.nav-links {
	display: flex;
	gap: 28px;
}

.nav-links a {
	font-size: 14px;
	color: var(--ink-2);
	transition: color 0.15s var(--ease);
}

.nav-links a:hover {
	color: var(--ink);
}

.nav-links a.active {
	color: var(--accent-deep);
}

html.dark .nav-links a.active {
	color: var(--accent-soft);
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

.nav-v {
	font-family: var(--f-mono);
	font-size: 11px;
	color: var(--ink-4);
	padding: 2px 6px;
	background: var(--bg-soft);
	border-radius: 3px;
	margin-left: 8px;
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

.theme-toggle svg {
	width: 14px;
	height: 14px;
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

/* Two-column shell */
.shell {
	display: grid;
	grid-template-columns: 240px 1fr;
	gap: 64px;
	padding: 40px 32px 80px;
}

/* Sidebar */
.side {
	position: sticky;
	top: 84px;
	align-self: start;
	max-height: calc(100vh - 100px);
	overflow-y: auto;
	padding-right: 8px;
	padding-bottom: 32px;
	font-size: 13.5px;
}

.side::-webkit-scrollbar {
	width: 6px;
}

.side::-webkit-scrollbar-thumb {
	background: var(--line);
	border-radius: 3px;
}

.side-group {
	margin-bottom: 22px;
}

.side-group:first-child {
	margin-top: 4px;
}

.side-title {
	font-family: var(--f-mono);
	font-size: 10.5px;
	font-weight: 500;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--ink-4);
	margin-bottom: 8px;
	padding-left: 10px;
}

.side-link {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 5px 10px;
	border-radius: 5px;
	color: var(--ink-2);
	font-weight: 400;
	line-height: 1.4;
	transition: all 0.12s var(--ease);
}

.side-link:hover {
	color: var(--ink);
	background: var(--bg-soft);
}

.side-link.active {
	color: var(--accent-deep);
	background: var(--accent-bg);
	font-weight: 500;
}

html.dark .side-link.active {
	color: var(--accent-soft);
}

.side-section-current {
	color: var(--ink);
	font-weight: 500;
}

.side-sub {
	padding-left: 10px;
	margin-top: 2px;
	border-left: 1px solid var(--line);
	margin-left: 14px;
}

.side-sub .side-link {
	font-size: 13px;
	padding: 4px 12px;
}

.side-sub .name-mono {
	font-family: var(--f-mono);
	font-size: 12.5px;
}

.dot {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	flex-shrink: 0;
}

.dot.fn {
	background: var(--kind-fn);
}

.dot.type {
	background: var(--kind-type);
}

.dot.cls {
	background: var(--kind-cls);
}

.dot.const {
	background: var(--kind-const);
}

/* Article — base (shared with concept template) */
.article {
	min-width: 0;
	max-width: 760px;
	padding-bottom: 80px;
}

/* Editorial styles target markdown rendered by <Content /> — needs :deep */
.article :deep(.intro-kicker) {
	font-family: var(--f-mono);
	font-size: 11px;
	letter-spacing: 0.16em;
	text-transform: uppercase;
	color: var(--ink-4);
	margin: 0 0 18px;
	display: inline-flex;
	align-items: center;
	gap: 12px;
}

.article :deep(.intro-kicker::before) {
	content: "";
	width: 24px;
	height: 1px;
	background: currentColor;
}

.article :deep(.intro-kicker .v) {
	padding: 2px 7px;
	background: var(--bg-soft);
	border: 1px solid var(--line);
	border-radius: 3px;
	color: var(--ink-3);
	letter-spacing: 0.06em;
}

.article :deep(h1) {
	font-family: var(--f-serif);
	font-weight: 400;
	font-size: 78px;
	line-height: 0.95;
	letter-spacing: -0.03em;
	color: var(--ink);
	max-width: 14ch;
	margin: 0 0 16px;
}

.article :deep(h1 em) {
	font-style: italic;
	color: var(--accent-deep);
}

html.dark .article :deep(h1 em) {
	color: var(--accent-soft);
}

.article :deep(.lede) {
	font-family: var(--f-serif);
	font-weight: 400;
	font-size: 22px;
	line-height: 1.45;
	color: var(--ink-2);
	max-width: 56ch;
	margin: 0 0 56px;
}

.article :deep(h2) {
	font-family: var(--f-serif);
	font-weight: 400;
	font-style: italic;
	font-size: 38px;
	line-height: 1.05;
	letter-spacing: -0.015em;
	color: var(--accent-deep);
	margin: 64px 0 18px;
	scroll-margin-top: 90px;
}

html.dark .article :deep(h2) {
	color: var(--accent-soft);
}

.article :deep(h2 .num) {
	font-family: var(--f-mono);
	font-style: normal;
	font-size: 12px;
	color: var(--ink-4);
	margin-right: 14px;
	letter-spacing: 0.1em;
	vertical-align: 8px;
}

.article :deep(h3) {
	font-family: var(--f-sans);
	font-weight: 600;
	font-size: 16px;
	letter-spacing: -0.005em;
	margin: 28px 0 8px;
	color: var(--ink);
}

.article :deep(p) {
	font-size: 16.5px;
	color: var(--ink-2);
	line-height: 1.65;
	max-width: 62ch;
	margin: 0 0 14px;
}

.article :deep(p.dropcap::first-letter) {
	font-family: var(--f-serif);
	font-size: 64px;
	line-height: 0.85;
	float: left;
	padding: 6px 12px 0 0;
	color: var(--accent-deep);
	font-style: italic;
}

html.dark .article :deep(p.dropcap::first-letter) {
	color: var(--accent-soft);
}

.article :deep(p code),
.article :deep(li code) {
	font-size: 0.92em;
	background: var(--bg-soft);
	padding: 1px 6px;
	border-radius: 4px;
	color: var(--ink);
	border: 1px solid var(--line);
	font-family: var(--f-mono);
}

.article :deep(ul),
.article :deep(ol) {
	margin: 0 0 18px;
	padding-left: 20px;
	color: var(--ink-2);
	max-width: 62ch;
}

.article :deep(li) {
	margin-bottom: 6px;
}

.article :deep(a) {
	color: var(--accent-deep);
	border-bottom: 1px solid color-mix(in oklch, var(--accent) 40%, transparent);
	transition: border-color 0.15s var(--ease);
}

.article :deep(a:hover) {
	border-bottom-color: var(--accent);
}

html.dark .article :deep(a) {
	color: var(--accent-soft);
}

/* Pull quote */
.article :deep(.pull-quote) {
	margin: 36px 0;
	padding: 0 0 0 28px;
	border-left: 2px solid var(--accent);
	font-family: var(--f-serif);
	font-style: italic;
	font-size: 24px;
	line-height: 1.35;
	color: var(--ink-2);
	max-width: 56ch;
}

.article :deep(.pull-quote cite) {
	display: block;
	margin-top: 12px;
	font-family: var(--f-mono);
	font-style: normal;
	font-size: 11px;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--ink-4);
}

/* Not-list — "what Bedrock isn't" */
.article :deep(.not-list) {
	list-style: none;
	padding: 0;
	margin: 0 0 18px;
	max-width: 62ch;
}

.article :deep(.not-list li) {
	display: grid;
	grid-template-columns: 92px 1fr;
	gap: 18px;
	padding: 12px 0;
	border-top: 1px dashed var(--line);
	align-items: baseline;
	font-size: 15.5px;
	margin-bottom: 0;
}

.article :deep(.not-list li:last-child) {
	border-bottom: 1px dashed var(--line);
}

.article :deep(.not-list li .x) {
	font-family: var(--f-mono);
	font-size: 11px;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	color: var(--del);
	opacity: 0.9;
}

.article :deep(.not-list li .x::before) {
	content: "\00d7 ";
}

.article :deep(.not-list li b) {
	color: var(--ink);
	font-weight: 500;
}

.article :deep(.not-list li .why) {
	color: var(--ink-3);
	font-family: var(--f-sans);
}

/* Next-steps card grid */
.article :deep(.next-steps) {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 14px;
	margin: 32px 0 0;
}

.article :deep(.next-step) {
	display: block;
	padding: 22px;
	border: 1px solid var(--line);
	border-radius: var(--r-lg);
	background: var(--bg-card);
	transition:
		border-color 0.15s,
		transform 0.15s var(--ease),
		background 0.15s;
}

.article :deep(.next-step:hover) {
	border-color: var(--line-strong);
	transform: translateY(-2px);
}

.article :deep(.next-step .kicker) {
	font-family: var(--f-mono);
	font-size: 10.5px;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--ink-4);
	display: flex;
	align-items: center;
	gap: 8px;
}

.article :deep(.next-step .kicker .num) {
	width: 18px;
	height: 18px;
	border: 1px solid var(--line-strong);
	border-radius: 50%;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	font-size: 10px;
	color: var(--ink-3);
}

.article :deep(.next-step h4) {
	font-family: var(--f-serif);
	font-weight: 400;
	font-size: 26px;
	margin: 12px 0 8px;
	color: var(--ink);
	line-height: 1.1;
	letter-spacing: -0.01em;
}

.article :deep(.next-step p) {
	margin: 0;
	font-size: 13.5px;
	color: var(--ink-3);
	line-height: 1.5;
	max-width: none;
}

.article :deep(.next-step .arrow) {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	margin-top: 16px;
	font-family: var(--f-mono);
	font-size: 11.5px;
	color: var(--accent-deep);
	letter-spacing: 0.06em;
	transition: transform 0.15s var(--ease);
	border-bottom: 0;
}

html.dark .article :deep(.next-step .arrow) {
	color: var(--accent-soft);
}

.article :deep(.next-step:hover .arrow) {
	transform: translateX(3px);
}

/* Doc footer (prev / next) */
.article :deep(.doc-foot) {
	margin-top: 56px;
	padding-top: 24px;
	border-top: 1px solid var(--line);
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 16px;
}

.article :deep(.doc-foot a) {
	display: block;
	padding: 16px 18px;
	border: 1px solid var(--line);
	border-radius: var(--r);
	border-bottom: 1px solid var(--line);
	transition:
		border-color 0.15s,
		transform 0.15s var(--ease);
}

.article :deep(.doc-foot a:hover) {
	border-color: var(--line-strong);
	transform: translateY(-1px);
}

.article :deep(.doc-foot a .dir) {
	font-family: var(--f-mono);
	font-size: 10.5px;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--ink-4);
	margin-bottom: 6px;
}

.article :deep(.doc-foot a .label) {
	font-size: 15px;
	color: var(--ink);
	font-weight: 500;
}

.article :deep(.doc-foot a.next) {
	text-align: right;
}

/* Footer (mirrors landing's footer shape) */
.bedrock-foot {
	padding: 72px 0 48px;
	background: var(--bg-soft);
	border-top: 1px solid var(--line);
}

.foot {
	display: grid;
	grid-template-columns: 1.4fr 1fr 1fr 1fr;
	gap: 48px;
	margin-bottom: 56px;
}

.foot h5 {
	font-family: var(--f-mono);
	font-size: 11px;
	font-weight: 500;
	letter-spacing: 0.14em;
	text-transform: uppercase;
	color: var(--ink-3);
	margin: 0 0 16px;
}

.foot ul {
	list-style: none;
	padding: 0;
	margin: 0;
}

.foot li {
	margin-bottom: 10px;
}

.foot a {
	font-size: 14px;
	color: var(--ink-2);
	transition: color 0.15s var(--ease);
}

.foot a:hover {
	color: var(--ink);
}

.foot-brand p {
	font-size: 14px;
	color: var(--ink-3);
	max-width: 34ch;
	margin: 14px 0 0;
	line-height: 1.55;
}

.foot-bottom {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding-top: 28px;
	border-top: 1px solid var(--line);
	font-size: 12px;
	color: var(--ink-4);
	font-family: var(--f-mono);
}

/* Responsive */
@media (max-width: 1100px) {
	.shell {
		grid-template-columns: 220px 1fr;
		gap: 40px;
	}
}

@media (max-width: 760px) {
	.wrap {
		padding: 0 20px;
	}

	.shell {
		grid-template-columns: 1fr;
		gap: 32px;
		padding: 32px 20px 64px;
	}

	.side {
		position: static;
		max-height: none;
		padding: 0 0 24px;
		border-bottom: 1px solid var(--line);
	}

	.nav-links,
	.nav-search {
		display: none;
	}

	.article :deep(h1) {
		font-size: 52px;
	}

	.article :deep(h2) {
		font-size: 28px;
	}

	.article :deep(.next-steps) {
		grid-template-columns: 1fr;
	}

	.foot {
		grid-template-columns: 1fr 1fr;
		gap: 24px;
	}
}
</style>
