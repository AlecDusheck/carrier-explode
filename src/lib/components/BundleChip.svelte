<script lang="ts">
  import { bundleHref } from "#lib/format.ts";
  import type { Kind } from "#lib/types.ts";
  import BundleIcon from "./BundleIcon.svelte";

  let { kind, name, cc, onclick }: { kind: Kind; name: string; cc?: string; onclick?: () => void } = $props();
</script>

<a class="chip bundle" href={bundleHref(kind, name)} {onclick}><BundleIcon {kind} {name} {cc} />{name}</a>
