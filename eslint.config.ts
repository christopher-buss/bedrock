import isentinel from "@isentinel/eslint-config";

export default isentinel({
	flawless: true,
	ignores: ["!.claude"],
	name: "bedrock/root",
	pnpm: true,
	roblox: false,
	test: true,
	type: "package",
});
