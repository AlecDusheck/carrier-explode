<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import { page } from "$app/state";
  import { countryName } from "@carrier-explode/schema";
  import { ISO_CODE, isReleasePlatform, RELEASE_PLATFORMS, sourceOf, type ReleasePlatform } from "@carrier-explode/schema/types";
  import { getRecentChanges } from "#lib/api/builds.remote.ts";
  import { link, shippedText, versionStep, withParams } from "#lib/format.ts";
  import { PLATFORM_DEVICES, PLATFORM_ORDER } from "#lib/platforms.ts";
  import type { RecentChange, RecentChanges } from "#lib/server/recent.ts";
  import { visitorGuess } from "#lib/visitor.ts";
  import Busy from "./Busy.svelte";
  import PaneError from "./PaneError.svelte";
  import PlatformPicker from "./PlatformPicker.svelte";
  import SourceIcon from "./SourceIcon.svelte";
  import SourceName from "./SourceName.svelte";

  /** All is asked for by name, since a URL naming no platform means the visitor's own. */
  const ALL = "all";
  const asked = $derived(page.url.searchParams.get("platform") ?? "");

  // The guess's platform and country, read after the page has drawn so the server's page reads no visitor and the edge
  // can keep it; an iPad or watch is shown the menu's first platform's feed.
  let own: ReleasePlatform | undefined = $state();
  let country: string | null | undefined = $state();
  $effect(() => {
    void (async () => {
      try {
        const g = await visitorGuess();
        own = isReleasePlatform(g.platform) ? g.platform : PLATFORM_ORDER[0];
        country = g.country !== null && ISO_CODE.test(g.country) ? g.country : null;
      } catch (e) {
        failed = e;
      }
    })();
  });
  /** Null for All; undefined while the visitor's platform is unknown. */
  const platform = $derived<ReleasePlatform | null | undefined>(asked === ALL ? null : isReleasePlatform(asked) ? asked : own);

  /** The pages read so far, for the country and platform shown. */
  let feed: RecentChanges | undefined = $state.raw();
  let failed: unknown = $state.raw(null);
  let reading = false;
  // A page read for an earlier country or platform is dropped.
  let generation = 0;

  async function read(
    iso: string | null,
    chosen: ReleasePlatform | null,
    after: RecentChanges["next"],
    shown: readonly RecentChange[],
  ): Promise<void> {
    const mine = generation;
    reading = true;
    try {
      const got = await getRecentChanges({ iso, platform: chosen, after });
      if (mine === generation) feed = { ...got, changes: [...shown, ...got.changes] };
    } catch (e) {
      if (mine === generation) failed = e;
    } finally {
      if (mine === generation) reading = false;
    }
  }

  const start = (): void => {
    if (country === undefined || platform === undefined) return;
    generation++;
    feed = undefined;
    failed = null;
    void read(country, platform, null, []);
  };
  // A failed page is read again when the end of the list comes back into view.
  const retry = (): void => {
    failed = null;
    if (feed === undefined) start();
  };
  $effect(() => {
    void platform;
    start();
  });

  /** The end of the list: in view, it reads the next page. */
  const more: Attachment<HTMLElement> = (node) => {
    const seen = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting && !reading && feed?.next && platform !== undefined) void read(feed.iso, platform, feed.next, feed.changes);
      },
      { root: node.closest(".scroll"), rootMargin: "400px 0px" },
    );
    seen.observe(node);
    return () => seen.disconnect();
  };

  const place = $derived(feed ? (countryName(feed.iso) ?? feed.iso.toUpperCase()) : "…");
  const now = new Date();
  const versions = (c: RecentChange): string => (c.from === null ? `new ${c.version}` : versionStep(c.from, c.version));
</script>

<fieldset class="hgroup">
  <legend>Recent changes in {place}</legend>
  <div class="filters">
    <PlatformPicker platforms={RELEASE_PLATFORMS} selected={platform} every="All" href={(p) => withParams(page.url, { platform: p ?? ALL })} />
  </div>
  {#if feed === undefined && !failed}
    <p class="dimtext"><Busy awaiting={{ kind: "index" }} /></p>
  {:else if feed && !feed.changes.length}
    <p class="dimtext">No changes yet.</p>
  {:else if feed}
    <ul class="list changes">
      {#each feed.changes as c (`${c.key.at} ${c.key.source} ${c.key.line} ${c.key.slug}`)}
        {@const name = sourceOf(c.key.source).name}
        <li>
          <a href={link(c.path)}>
            {#if c.picture}<SourceIcon picture={c.picture} />{/if}
            <span class="what">
              <span class="name"><SourceName brand={c.brand ?? name} code={name} withCode /></span>
              <span class="dimtext">{PLATFORM_DEVICES[c.platform]} · <span class="mono">{versions(c)}</span></span>
            </span>
            <span class="dim" title={c.key.at}>{shippedText(c.shipped, now)}</span>
          </a>
        </li>
      {/each}
    </ul>
    {#if feed.next && !failed}
      {#key feed.changes.length}<p class="dimtext" {@attach more}><Busy awaiting={{ kind: "index" }} /></p>{/key}
    {/if}
  {/if}
  {#if failed}<PaneError error={failed} reset={retry} quiet={false} />{/if}
</fieldset>

<style>
  .filters {
    margin-bottom: 6px;
  }
  .changes {
    background: var(--field);
    border: 1px solid;
    border-color: var(--shadow) var(--light) var(--light) var(--shadow);
  }
  .changes li {
    content-visibility: auto;
    contain-intrinsic-size: auto 38px;
  }
  .changes .what {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .changes .what > * {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .changes .dimtext {
    font-size: 11px;
  }
</style>
