<script lang="ts">
  import type { ConfidenceOrUnknown } from "$lib/decode";

  let { c }: { c?: ConfidenceOrUnknown } = $props();

  const TEXT: Partial<Record<ConfidenceOrUnknown, [string, string]>> = {
    med: ["likely", "Read from code and a consistent value pattern; not confirmed by a spec."],
    low: ["unverified", "Inferred from the name and values only."],
    unknown: ["unnamed", "No public or on-device source names this."],
  };
  const t = $derived(c ? TEXT[c] : undefined);
</script>

{#if t}<span class="conf {c}" title={t[1]}>{t[0]}</span>{/if}

<style>
  .conf {
    font-family: var(--ui); font-size: 9.5px; font-style: italic; color: var(--conf-med);
    border: 1px dashed var(--conf-med-border); padding: 0 3px; margin-left: 5px; white-space: nowrap;
  }
  .conf.low, .conf.unknown { color: var(--conf-low); border-color: var(--conf-low-border); }
</style>
