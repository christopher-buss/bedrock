<script setup lang="ts">
import { useData } from "vitepress";
import DefaultTheme from "vitepress/theme";

import HomeLanding from "./home-landing.vue";

const { Layout: DefaultLayout } = DefaultTheme;
const { frontmatter } = useData();
</script>

<template>
	<HomeLanding v-if="frontmatter.layout === 'landing'" />
	<DefaultLayout v-else />
</template>
