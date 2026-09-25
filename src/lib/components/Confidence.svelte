<script lang="ts">
  let { c }: { c?: string } = $props();

  const TEXT: Record<string, [string, string]> = {
    med: ["likely", "Read from code and a consistent value pattern; not confirmed by a spec."],
    low: ["unverified", "Inferred from the name and values only."],
    unknown: ["unnamed", "No public or on-device source names this."],
  };
  const t = $derived(c ? TEXT[c] : undefined);
</script>

{#if t}<span class="conf {c}" title={t[1]}>{t[0]}</span>{/if}

<style>
  .conf {
    font-family: var(--ui); font-size: 9.5px; font-style: italic; color: #7a5a14;
    border: 1px dashed #d0b36a; padding: 0 3px; margin-left: 5px; white-space: nowrap;
  }
  .conf.low, .conf.unknown { color: #8a3a2a; border-color: #d19a8a; }
</style>
