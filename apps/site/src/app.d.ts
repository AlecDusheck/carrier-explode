import type { PageNames } from "#lib/types.ts";

declare global {
	namespace App {
		interface PageData {
			/** The root layout's: what the head calls the codes in the URL. */
			names: PageNames;
			/** The root layout's: where the public API answers (wrangler.jsonc vars.API_ORIGIN). */
			apiOrigin: string;
			meta?: { title: string; description: string };
			/** A page reachable at several URLs (one file on several Pixels) names the one to index. */
			canonical?: string;
		}
		interface Error {
			status: number;
			message: string;
		}
		interface Locals {
			/** Set by anything that reads the visitor. Keeps the response out of the shared cache. */
			perVisitor?: boolean;
		}
	}
}
