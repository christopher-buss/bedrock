<script setup lang="ts">
import { useData } from "vitepress";

import { version as bedrockVersion } from "@bedrock-rbx/core/package.json";

export interface BedrockNavLink {
	readonly active?: boolean;
	readonly external?: boolean;
	readonly href: string;
	readonly text: string;
}

interface Props {
	readonly homeHref?: string;
	readonly links: ReadonlyArray<BedrockNavLink>;
	readonly showSearch?: boolean;
}

const { homeHref = "/", showSearch = false } = defineProps<Props>();

const VERSION = `v${bedrockVersion}`;

const { isDark } = useData();

function toggleTheme(): void {
	isDark.value = !isDark.value;
}
</script>

<template>
	<nav class="bedrock-nav">
		<div class="wrap inner">
			<a class="brand" :href="homeHref">
				<span class="brand-mark"> <span /><span /><span /><span /> </span>
				Bedrock<span class="nav-v">{{ VERSION }}</span>
			</a>
			<div class="nav-links">
				<a
					v-for="link in links"
					:key="link.href"
					:class="{ active: link.active }"
					:href="link.href"
					:rel="link.external ? 'noopener noreferrer' : undefined"
					:target="link.external ? '_blank' : undefined"
				>
					{{ link.text }}
				</a>
			</div>
			<div class="nav-right">
				<div
					v-if="showSearch"
					class="nav-search"
					role="button"
					tabindex="0"
					aria-label="Search docs"
				>
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

@media (max-width: 760px) {
	.wrap {
		padding: 0 20px;
	}

	.nav-links,
	.nav-search {
		display: none;
	}
}
</style>
