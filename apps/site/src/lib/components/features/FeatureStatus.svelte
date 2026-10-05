<script lang="ts">
  import type { PhoneState } from "#lib/server/features.ts";

  let { state }: { state: PhoneState } = $props();

  /** What each state means to someone holding the phone. */
  const STATUS: Record<PhoneState, { label: string; tone: string; hint: string }> = {
    on: { label: "On", tone: "good", hint: "Available and on by default" },
    available: { label: "Available", tone: "info", hint: "Offered: turn it on in Settings, or your plan decides" },
    no: { label: "Not offered", tone: "bad", hint: "This carrier does not offer it on this phone" },
    unknown: { label: "Unknown", tone: "", hint: "We don't have this carrier's settings for this phone" },
  };
  const s = $derived(STATUS[state]);
</script>

<span class="chip {s.tone}" title={s.hint}>{s.label}</span>
