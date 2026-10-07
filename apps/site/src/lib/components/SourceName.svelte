<script lang="ts">
  import { sameName } from "#lib/names.ts";

  /** A source by what people call it, its file name beside it only when asked for and saying more than the name. */
  let { brand, code, withCode = false }: { brand: string; code: string; withCode?: boolean } = $props();
</script>

<span class="source-name" title={code}>{brand}</span>{#if withCode && !sameName(brand, code)}<span class="source-code dimtext mono">{code}</span>{/if}
