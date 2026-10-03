<script lang="ts" module>
  import type { FeatureState } from "#lib/features.ts";

  /** What each state means to someone holding the phone. */
  export const STATUS: Record<FeatureState | "unknown", { label: string; tone: string; hint: string }> = {
    on: { label: "On", tone: "good", hint: "Available and on by default" },
    available: { label: "Available", tone: "info", hint: "Offered: turn it on in Settings, or your plan decides" },
    no: { label: "Not offered", tone: "bad", hint: "This carrier does not offer it on this iPhone" },
    unknown: { label: "Unknown", tone: "", hint: "We don't have this carrier's settings for this iPhone yet" },
  };
</script>

<script lang="ts">
  let { state }: { state: FeatureState | "unknown" } = $props();
  const s = $derived(STATUS[state]);
</script>

<span class="chip {s.tone}" title={s.hint}>{s.label}</span>
