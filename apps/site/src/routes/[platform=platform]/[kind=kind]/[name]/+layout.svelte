<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getSourceHead } from "#lib/api/sources.remote.ts";
  import { headAt, verOf } from "#lib/at.ts";
  import { link, versionHref } from "#lib/format.ts";
  import { linePath, type SourceRef } from "@carrier-explode/schema/types";
  import type { SourceHead } from "#lib/server/head.ts";
  import { visitorDevice } from "#lib/visitor.ts";
  import { overviewChoice, tabView, type TabView } from "#lib/components/views.ts";
  import { TABS } from "../../../../params.ts";
  import LinePicker from "#lib/components/LinePicker.svelte";
  import Tabs from "#lib/components/Tabs.svelte";
  import Pane from "#lib/components/Pane.svelte";
  import SourceIcon from "#lib/components/SourceIcon.svelte";
  import SourceName from "#lib/components/SourceName.svelte";
  import VersionPicker from "#lib/components/VersionPicker.svelte";

  let { params, children } = $props();

  const ver = $derived(verOf({ ...params, line: page.params.line, version: page.params.version }));
  // Switching version keeps the tab, but not the file or query within it.
  const open = $derived(TABS.find((t) => t === page.params.tab));
  const tab = $derived(open ?? "");
  const lineHref = (ref: SourceRef, line: string): string => link(linePath(ref, line) + (tab ? `/${tab}` : ""));
  // What the head shows comes from the head alone: while another source loads, the URL already names it.
  const viewOf = (h: SourceHead): TabView | undefined => (open === undefined ? undefined : tabView(h.ref.platform, open));

  // A URL naming no line shows the default line; at its head, the visitor's own line, where the source has it, is a better default.
  $effect(() => {
    if (page.params.line !== undefined) return;
    const head = getSourceHead(ver);
    const from = page.url.href;
    void (async () => {
      const [h, { line }] = await Promise.all([head, visitorDevice()]);
      const better = line !== null && line !== h.line && h.entry.slug === h.head && h.lines.some((l) => l.variants.some((v) => v.code === line));
      if (better && page.url.href === from) await goto(lineHref(h.ref, line), { replace: true });
    })();
  });
</script>

<!-- Name, then the page's choices in order (device, version, a tab's phone), and the tab row: each keeps its height while the version loads, so the pane below never jumps. -->
<div class="bundle-head">
  <span class="ident">
    <Pane quiet>
      {@const h = await getSourceHead(ver)}
      <span class="picture-slot"><SourceIcon picture={h.picture} /></span>
      <b><SourceName brand={h.brand} code={h.ref.name} withCode /></b>
    </Pane>
  </span>
  <div class="choices">
    <Pane quiet>
      {@const h = await getSourceHead(ver)}
      {@const view = viewOf(h)}
      {@const OverviewChoice = open === undefined ? overviewChoice(h.ref.platform) : null}
      <LinePicker head={h} href={(line) => lineHref(h.ref, line)} />
      {#if view?.versioned ?? true}
        <VersionPicker timeline={h.timeline} current={h.entry.slug} shipping={h.current} href={(slug) => versionHref({ ...headAt(h), version: slug }, tab)} />
      {/if}
      {#if open && view?.Choice}
        <view.Choice at={headAt(h)} tab={open} />
      {:else if OverviewChoice}
        <OverviewChoice at={headAt(h)} />
      {/if}
    </Pane>
  </div>
</div>
<nav class="tabs-slot">
  <Pane quiet>
    {@const h = await getSourceHead(ver)}
    <Tabs at={headAt(h)} />
  </Pane>
</nav>

{@render children()}
