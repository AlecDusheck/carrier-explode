import { describe, expect, it } from "vitest";
import { matrixMarkdown, PAGE_ROWS } from "../src/lib/components/matrix/markdown.ts";
import {
	phoneConcepts,
	readRequirements,
	type MatrixCell,
	type MatrixConcept,
} from "../src/lib/feature-matrix.ts";
import type { FeatureMatrix, FeaturePhone, MatrixRow } from "../src/lib/server/features.ts";

const PHONE = {
	code: "iPhone19,7",
	platform: "ios",
	released: "2026-09-18",
	boards: ["V64sAP"],
	has5g: true,
	name: "iPhone 18 Pro Max",
	covered: true,
} satisfies FeaturePhone;
const COLUMNS = phoneConcepts(PHONE);

const row = (brand: string, cc: string, cells: Partial<Record<MatrixConcept, MatrixCell>>): MatrixRow => ({
	entry: {
		key: `ios:carrier:${brand}`,
		path: `/ios/carriers/${brand}`,
		platform: "ios",
		name: brand,
		brand,
		picture: { kind: "initials", brand },
		cc,
		updated: null,
		ruleOnly: false,
		carrier: null,
		tag: null,
	},
	cells: COLUMNS.map((id) => cells[id] ?? "unknown"),
});

const ROWS = [
	row("Alpha", "de", { "5g": "on", volte: "on", "wifi-calling": "available" }),
	row("Beta", "jp", { "5g": "no" }),
];

const render = (search: string, rows: readonly MatrixRow[] = ROWS): string => {
	const matrix: FeatureMatrix = { phone: PHONE, columns: COLUMNS, rows };
	return matrixMarkdown(matrix, [], new URL(`https://example.com/features.md${search}`));
};

const linkIn = (md: string, line: string, text: string): URL => {
	const pattern = new RegExp(`\\[${text}\\]\\(([^)]+)\\)`);
	const href = md
		.split("\n")
		.find((l) => l.startsWith(line) && pattern.test(l))
		?.match(pattern)?.[1];
	if (href === undefined) throw new Error(`No ${text} link on ${line}`);
	return new URL(href);
};

describe("matrixMarkdown", () => {
	it("says each picked feature's state in words", () => {
		const md = render("");
		expect(md).toContain("1 of 2 carriers meet every requirement on the iPhone 18 Pro Max.");
		expect(md).toContain("- Nice to have: 5G · VoLTE · Wi-Fi Calling");
		expect(md).toContain("| Carrier | Country | Meets | 5G | VoLTE | Wi-Fi Calling |");
		expect(md).toContain(
			"| [Alpha](https://example.com/ios/carriers/Alpha) | Germany | 3/3 | On | On | Off until turned on |",
		);
		expect(md).toContain(
			"| [Beta](https://example.com/ios/carriers/Beta) | Japan | 0/3 | Not given | No data | No data |",
		);
	});

	it("links each change as the view with it made", () => {
		const md = render("?q=Germany");
		const require = linkIn(md, "- Require:", "5G SA");
		expect(require.pathname).toBe("/features.md");
		expect(require.searchParams.get("q")).toBe("Germany");
		const reqs = readRequirements(require.searchParams);
		expect(reqs.get("sa")?.mode).toBe("need");
		expect(reqs.get("nr")?.mode).toBe("want");
		expect(render(require.search)).toContain("- Required: 5G SA");
		expect(linkIn(md, "- Search:", "clear").searchParams.has("q")).toBe(false);
	});

	it("pages long lists", () => {
		const many = Array.from({ length: PAGE_ROWS + 50 }, (_, i) => row(`C${i}`, "us", { "5g": "on" }));
		const first = render("?all=1", many);
		expect(first).toContain(`Carriers 1–${PAGE_ROWS} of ${PAGE_ROWS + 50}.`);
		const next = linkIn(first, "Carriers 1–", "Next page");
		expect(next.searchParams.get("all")).toBe("1");
		const second = render(next.search, many);
		expect(second).toContain(`Carriers ${PAGE_ROWS + 1}–${PAGE_ROWS + 50} of ${PAGE_ROWS + 50}.`);
		expect(second).toContain("[Previous page]");
	});
});
