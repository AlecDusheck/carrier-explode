<script lang="ts">
  import type { Defaulted } from "@carrier-explode/schema/types";
  import { defaultNote } from "#lib/feature-pages.ts";
  import type { PhoneState } from "#lib/server/features.ts";

  let { state, defaulted }: { state: PhoneState; defaulted: Defaulted | null } = $props();

  /** What each state means to someone holding the phone. */
  const STATUS: Record<PhoneState, { label: string; tone: string; hint: string }> = {
    on: { label: "On", tone: "good", hint: "Available and on by default" },
    available: { label: "Available", tone: "info", hint: "Offered: turn it on in Settings, or your plan decides" },
    no: { label: "Not offered", tone: "bad", hint: "This carrier does not offer it on this phone" },
    unset: { label: "Not set", tone: "", hint: "The carrier's settings for this phone leave it unset" },
    unknown: { label: "Unknown", tone: "", hint: "We don't have this carrier's settings for this phone" },
  };
  const s = $derived(STATUS[state]);
  const d = $derived(defaulted === null ? null : defaultNote(defaulted));
</script>

<span class="chip {s.tone}" title={d?.kind === "hint" ? `${s.hint}\n${d.hint}` : s.hint}>{s.label}</span>
{#if d?.kind === "badge"}<span class="dimtext" title={d.hint}>{d.label}</span>{/if}
