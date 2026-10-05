<script lang="ts" generics="P extends Record<string, unknown>">
  import { errorMessage } from "#lib/format.ts";
  import type { Loaded } from "./registry.ts";

  /** A registry view, shown once its module has loaded. */
  let { view }: { view: Promise<Loaded<P>> } = $props();
</script>

{#await view}
  <span class="dimtext">…</span>
{:then { View, props }}
  <View {...props} />
{:catch e}
  <div class="banner err">This value's view did not load: {errorMessage(e)}</div>
{/await}
