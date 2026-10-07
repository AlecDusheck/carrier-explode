<script lang="ts">
  /** What the decoder could not read, as one badge whose tooltip says it. */
  let { errors }: { errors: readonly string[] } = $props();
</script>

{#if errors.length}<span class="chip warn sp" title={errors.join("\n")}>partly decoded</span>{/if}
