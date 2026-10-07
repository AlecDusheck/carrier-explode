/** Markdown and text files imported as modules: a string, as wrangler's Text rule and vitest's loader import them. */
declare module "*.md" {
	const text: string;
	export default text;
}
declare module "*.txt" {
	const text: string;
	export default text;
}
