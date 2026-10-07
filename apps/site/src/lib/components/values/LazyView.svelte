<script lang="ts" generics="P extends Record<string, unknown>">
  import type { Loaded } from "./registry.ts";

  /** A registry view once its module has loaded; awaited rather than {#await}ed, so the server renders it too. */
  let { view }: { view: Promise<Loaded<P>> } = $props();

  const loaded = $derived(await view);
</script>

<loaded.View {...loaded.props} />
