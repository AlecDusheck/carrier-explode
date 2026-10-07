#!/usr/bin/env node

/**
 * PreToolUse hook: blocks Edit/Write calls that introduce `as` casts or `any` types
 * in TypeScript files.
 *
 * Allowed:
 *   - `as const` assertions
 *   - `as` used for import/export aliases (import { X as Y })
 *   - The word "any" in comments, strings, or variable names
 *
 * Exit 0 = allow, Exit 2 = block (message sent to Claude via stderr)
 */

const fs = require("fs");

let raw;
try {
	raw = fs.readFileSync("/dev/stdin", "utf8");
} catch {
	process.exit(0);
}

let input;
try {
	input = JSON.parse(raw);
} catch {
	process.exit(0);
}

const toolName = input.tool_name;
let filePath, content;

if (toolName === "Edit") {
	filePath = input.tool_input.file_path;
	content = input.tool_input.new_string;
} else if (toolName === "Write" || toolName === "NotebookEdit") {
	filePath = input.tool_input.file_path || input.tool_input.notebook_path;
	content = input.tool_input.content || input.tool_input.new_source;
} else {
	process.exit(0);
}

// Only check TypeScript files
if (!/\.tsx?$/.test(filePath)) {
	process.exit(0);
}

// Don't check declaration files
if (filePath.endsWith(".d.ts")) {
	process.exit(0);
}

const violations = [];
const lines = (content || "").split("\n");

for (let i = 0; i < lines.length; i++) {
	const line = lines[i];
	const trimmed = line.trim();

	// Skip empty lines
	if (!trimmed) continue;

	// Skip single-line comments
	if (/^\s*\/\//.test(line)) continue;
	if (/^\s*\*/.test(line)) continue;
	if (/^\s*\/\*/.test(line)) continue;

	// Skip import/export lines (use `as` for aliases)
	if (/^\s*(import|export)\s/.test(line)) continue;

	// Strip string literals to avoid false positives
	// Handles single quotes, double quotes, and template literals (naive but good enough)
	const noStrings = line.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, '""');

	// Strip inline comments
	const noComments = noStrings.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");

	// --- Check for `as` casts ---
	// Remove `as const` (which is allowed)
	const noAsConst = noComments.replace(/\bas\s+const\b/g, "");

	if (/\bas\s+[A-Za-z]/.test(noAsConst)) {
		violations.push(`  [as cast] line ${i + 1}: ${trimmed}`);
	}

	// --- Check for `any` type ---
	// Patterns that indicate `any` used as a type annotation:
	//   : any, <any, any[], any>, any,, any;, any), | any, & any
	if (/:\s*any\b|<any\b|\bany\s*\[|\bany\s*[,;)}>|]|\|\s*any\b|&\s*any\b/.test(noComments)) {
		// Avoid duplicating if already caught as `as any`
		const alreadyCaught = violations.some((v) => v.includes(`line ${i + 1}:`) && v.includes("[as cast]"));
		if (!alreadyCaught) {
			violations.push(`  [any type] line ${i + 1}: ${trimmed}`);
		}
	}
}

if (violations.length > 0) {
	process.stderr.write(`BLOCKED: TypeScript code contains forbidden patterns:\n`);
	process.stderr.write(violations.join("\n") + "\n\n");
	process.stderr.write(`Instead of 'as' casts, use type guards, 'unknown' with narrowing, or 'satisfies'.\n`);
	process.stderr.write(`Instead of 'any', use 'unknown', proper types, or generics.\n`);
	process.stderr.write(`Note: 'as const' IS allowed.\n`);
	process.exit(2);
}

process.exit(0);
