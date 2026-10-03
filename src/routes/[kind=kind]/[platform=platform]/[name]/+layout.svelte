<script lang="ts">
  import { page } from "$app/state";
  import { getBundleHead } from "#lib/api/bundles.remote.ts";
  import { refOf, verOf } from "#lib/at.ts";
  import { link, versionHref } from "#lib/format.ts";
  import { PLATFORM_NAMES } from "#lib/platforms.ts";
  import { sourceKey, sourcePath } from "#lib/schema/types.ts";
  import type { At } from "#lib/types.ts";
  import { VIEWS } from "#lib/components/views.ts";
  import Pane from "#lib/components/Pane.svelte";
  import SourceIcon from "#lib/components/SourceIcon.svelte";
  import VersionPicker from "#lib/components/VersionPicker.svelte";

  let { params, children } = $props();

  const where = $derived({ ...params, line: page.params.line, version: page.params.version });
  const ref = $derived(refOf(where));
  // Switching version keeps the tab, but not the file or query within it.
  const tab = $derived(page.params.tab ?? "");
  const Tabs = $derived(VIEWS[params.platform].Tabs);
</script>

<!-- Name, version strip and tab row keep their height while the version loads, so the pane below never jumps. -->
<div class="bundle-head">
  <div class="ident">
    <SourceIcon name={ref.name} bundle={ref.name} />
    <b>{ref.name}</b>
    <Pane quiet>
      {@const h = await getBundleHead(verOf(where))}
      {#each h.others as o (sourceKey(o))}
        <a class="dimtext" href={link(sourcePath(o))}>{PLATFORM_NAMES[o.platform]}</a>
      {/each}
    </Pane>
  </div>
  {#if tab !== "alerts"}
    <div class="versions-slot">
      <Pane quiet>
        {@const h = await getBundleHead(verOf(where))}
        <VersionPicker timeline={h.timeline} current={h.entry.slug} head={h.head} href={(slug) => versionHref({ ref, source: sourceKey(ref), line: h.line, version: slug }, tab)} />
      </Pane>
    </div>
  {/if}
</div>
<nav class="tabs tabs-slot">
  <Pane quiet>
    {@const h = await getBundleHead(verOf(where))}
    {@const at: At = { ref, source: sourceKey(ref), line: h.line, version: h.entry.slug }}
    <Tabs {at} {tab} />
  </Pane>
</nav>

{@render children()}
