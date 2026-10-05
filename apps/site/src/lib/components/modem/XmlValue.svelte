<script lang="ts">
  import PolicyTree from "./PolicyTree.svelte";

  /** A whole XML document behind a chip: PolicyMan files get their element notes, any other XML reads as a plain element tree. */
  let { xml }: { xml: string } = $props();
  let open = $state(false);
  let source = $state(false);

  const size = $derived(new TextEncoder().encode(xml).length);
</script>

<button class="chip warn" onclick={() => (open = !open)}>{open ? "hide" : "show"} XML, {size} bytes</button>
{#if open}
  <PolicyTree {xml} />
  <button class="chip" onclick={() => (source = !source)}>{source ? "hide" : "show"} source</button>
  {#if source}<pre class="code">{xml}</pre>{/if}
{/if}
