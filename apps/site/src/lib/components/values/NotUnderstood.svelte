<script lang="ts">
  /** Marks what this site cannot read, saying why; the value itself is still shown. */
  let { reason }: { reason: string } = $props();
</script>

<span class="badge warn" title={reason}>not understood</span>
