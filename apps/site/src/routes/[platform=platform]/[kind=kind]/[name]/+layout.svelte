<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getSourceHead } from "#lib/api/sources.remote.ts";
  import { refOf, verOf } from "#lib/at.ts";
  import { link, versionHref } from "#lib/format.ts";
  import { linePath } from "@carrier-explode/schema/types";
  import type { At } from "#lib/types.ts";
  import { visitorDevice } from "#lib/visitor.ts";
  import { tabView } from "#lib/components/views.ts";
  import { TABS } from "../../../../params.ts";
  import LinePicker from "#lib/components/LinePicker.svelte";
  import Tabs from "#lib/components/Tabs.svelte";
  import Pane from "#lib/components/Pane.svelte";
  import SourceIcon from "#lib/components/SourceIcon.svelte";
  import VersionPicker from "#lib/components/VersionPicker.svelte";

  let { params, children } = $props();

  const where = $derived({ ...params, line: page.params.line, version: page.params.version });
  const ref = $derived(refOf(where));
  // Switching version keeps the tab, but not the file or query within it.
  const open = $derived(TABS.find((t) => t === page.params.tab));
  const tab = $derived(open ?? "");
  const view = $derived(open === undefined ? undefined : tabView(params.platform, open));
  const versioned = $derived(view?.versioned ?? true);
  const choice = $derived(open !== undefined && view?.Choice ? { Choice: view.Choice, tab: open } : null);
  const lineHref = (line: string | null): string => link(linePath(ref, line) + (tab ? `/${tab}` : ""));

  // A URL naming no line shows the default line; at its head, the visitor's own line, where the source has it, is a better default.
  $effect(() => {
    if (page.params.line !== undefined) return;
    const ver = verOf(where);
    const from = page.url.href;
    void Promise.all([getSourceHead(ver), visitorDevice()]).then(async ([h, { line }]) => {
      const better = line !== null && line !== h.line && h.entry.slug === h.head && h.lines.some((l) => l.id === line);
      if (better && page.url.href === from) await goto(lineHref(line), { replace: true });
    });
  });
</script>

<!-- Name, then the page's choices in order (device, version, a tab's phone), and the tab row: each keeps its height while the version loads, so the pane below never jumps. -->
<div class="bundle-head">
  <span class="ident">
    <span class="picture-slot">
      <Pane quiet>
        {@const h = await getSourceHead(verOf(where))}
        <SourceIcon picture={h.picture} />
      </Pane>
    </span>
    <b>{ref.name}</b>
  </span>
  <div class="choices">
    <Pane quiet>
      {@const h = await getSourceHead(verOf(where))}
      <LinePicker head={h} href={lineHref} />
      {#if versioned}
        <VersionPicker timeline={h.timeline} current={h.entry.slug} head={h.head} href={(slug) => versionHref({ ref, line: h.line, version: slug }, tab)} />
      {/if}
      {#if choice}
        <choice.Choice at={{ ref, line: h.line, version: h.entry.slug }} tab={choice.tab} />
      {/if}
    </Pane>
  </div>
</div>
<nav class="tabs tabs-slot">
  <Pane quiet>
    {@const h = await getSourceHead(verOf(where))}
    {@const at: At = { ref, line: h.line, version: h.entry.slug }}
    <Tabs {at} {tab} />
  </Pane>
</nav>

{@render children()}
