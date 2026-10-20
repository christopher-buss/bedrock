declare module "*.vue" {
	import type { DefineComponent } from "vue";

	const component: DefineComponent;
	export default component;
}

declare module "*?highlighted" {
	const html: string;
	export default html;
}
