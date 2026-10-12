/** The visitor's best guess, asked in the browser when a page first reads it, so no page reads the visitor on the server and the edge can keep every page. */

import { browser } from "$app/env";
import type { Platform } from "@carrier-explode/schema/types";
import { getVisitorGuess } from "#lib/api/sources.remote.ts";
import { browserDevice, type Device } from "./device";
import { guessPlatform, type VisitorGuess } from "./guess";

/** Asked once a page load, so every part of the page agrees. */
class Visitor {
	#platform = $state.raw<Platform | null>(null);
	#guess = $state.raw<VisitorGuess | null>(null);
	#error = $state.raw<unknown>(null);
	#device: Promise<Device> | null = null;
	#platformAsked = false;
	#guessAsked = false;

	/** The guess's platform alone, which the browser answers without the server. */
	get platform(): Platform | null {
		if (browser && !this.#platformAsked) this.#askPlatform();
		return this.#platform;
	}

	get guess(): VisitorGuess | null {
		if (browser && !this.#guessAsked) this.#askGuess();
		return this.#guess;
	}

	get error(): unknown {
		return this.#error;
	}

	retry(): void {
		if (this.#error === null) return;
		this.#error = null;
		this.#device = null;
		if (this.#platformAsked) this.#askPlatform();
		if (this.#guessAsked) this.#askGuess();
	}

	#askPlatform(): void {
		this.#platformAsked = true;
		this.#readDevice().then((d) => (this.#platform = guessPlatform(d)), this.#fail);
	}

	#askGuess(): void {
		this.#guessAsked = true;
		this.#readDevice()
			.then(getVisitorGuess)
			.then((g) => (this.#guess = g), this.#fail);
	}

	#readDevice(): Promise<Device> {
		this.#device ??= browserDevice();
		return this.#device;
	}

	#fail = (e: unknown): void => {
		console.error("[visitor]", e);
		this.#error = e;
	};
}

export const visitor = new Visitor();
