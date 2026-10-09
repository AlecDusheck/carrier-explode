<script lang="ts">
  import type { Defaulted } from "@carrier-explode/schema/types";
  import { defaultNote, STATUS } from "#lib/feature-pages.ts";
  import type { PhoneState } from "#lib/server/features.ts";

  let { state, defaulted }: { state: PhoneState; defaulted: Defaulted | null } = $props();

  const s = $derived(STATUS[state]);
  const d = $derived(defaulted === null ? null : defaultNote(defaulted));
</script>

<span class="chip {s.tone}" title={d?.kind === "hint" ? `${s.hint}\n${d.hint}` : s.hint}>{s.label}</span>
{#if d?.kind === "badge"}<span class="dimtext" title={d.hint}>{d.label}</span>{/if}
