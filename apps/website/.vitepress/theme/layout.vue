<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import { useData } from "vitepress";

import HomeLanding from "./home-landing.vue";

const { Layout: DefaultLayout } = DefaultTheme;
const { frontmatter } = useData();
</script>

<template>
	<HomeLanding v-if="frontmatter.layout === 'landing'" />
	<DefaultLayout v-else />
</template>
