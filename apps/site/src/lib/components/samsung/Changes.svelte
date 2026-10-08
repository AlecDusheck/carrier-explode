<script lang="ts">
  import { page } from "$app/state";
  import { getSamsungChanges } from "#lib/api/samsung.remote.ts";
  import { getSourceHead } from "#lib/api/sources.remote.ts";
  import { compareHref, verArgs, withParams } from "#lib/format.ts";
  import type { TabProps } from "#lib/types.ts";
  import Pane from "../Pane.svelte";
  import VersionPicker from "../VersionPicker.svelte";
  import SamsungDiff from "./SamsungDiff.svelte";

  let { at }: TabProps = $props();

  const against = $derived(page.url.searchParams.get("against"));
  const head = $derived(await getSourceHead(verArgs(at)));
  const chosen = $derived(against ?? head.previous?.slug ?? "");
</script>

<div class="rowflex">
  <VersionPicker
    label="Compare against"
    timeline={head.timeline.filter((t) => t.slug !== at.version)}
    current={chosen}
    shipping={head.current}
    href={(slug) => withParams(page.url, { against: slug === head.previous?.slug ? null : slug })}
  />
  <a href={compareHref({ source: at.ref, slug: chosen || undefined, line: at.line }, { source: at.ref, slug: at.version, line: at.line })}>Compare with another source…</a>
</div>

<Pane awaiting={{ kind: "diff", name: at.version }}>
  {@const c = await getSamsungChanges({ ...verArgs(at), ...(against ? { against } : {}) })}
  {#if !c.a}
    <p class="dimtext">Nothing older to compare against.</p>
  {:else}
    <SamsungDiff changes={c} />
  {/if}
</Pane>
