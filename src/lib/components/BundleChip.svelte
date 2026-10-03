<script lang="ts">
  import { bundleHref } from "#lib/format.ts";
  import type { Kind } from "#lib/types.ts";
  import BundleIcon from "./BundleIcon.svelte";

  let { kind, name, slug, cc, tone, onclick }: {
    kind: Kind;
    name: string;
    /** A version to link to; the current one without. */
    slug?: string;
    cc?: string;
    tone?: "good" | "bad";
    onclick?: () => void;
  } = $props();
</script>

<a class="chip bundle {tone ?? ''}" href={bundleHref(kind, name, slug)} {onclick}><BundleIcon {kind} {name} {cc} />{name}</a>
