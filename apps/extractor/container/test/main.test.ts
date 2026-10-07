// The job server's exit on SIGTERM: in the image it is PID 1, which the kernel spares every signal it does not handle.
// It runs as the image runs it, bundled: only the bundle imports the Galaxy auth tables (.dat).

import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

const BUILD = fileURLToPath(new URL("../build.mjs", import.meta.url));
const MAIN = fileURLToPath(new URL("../dist/main.mjs", import.meta.url));

it("exits cleanly on SIGTERM", async () => {
	execFileSync(process.execPath, [BUILD], { stdio: "ignore" });
	const server = spawn(process.execPath, [MAIN], { stdio: ["ignore", "pipe", "inherit"] });
	let out = "";
	server.stdout.setEncoding("utf8");
	await new Promise<void>((resolve) => {
		server.stdout.on("data", (chunk: string) => {
			out += chunk;
			if (out.includes("listening")) resolve();
		});
	});
	server.kill("SIGTERM");
	const [code, signal] = await once(server, "exit");
	expect({ code, signal }).toEqual({ code: 0, signal: null });
}, 20_000);
