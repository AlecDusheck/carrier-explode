<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import { page } from "$app/state";
  import { countryName } from "@carrier-explode/schema";
  import { ISO_CODE, isReleasePlatform, RELEASE_PLATFORMS, sourceOf, type ReleasePlatform } from "@carrier-explode/schema/types";
  import { getRecentChanges } from "#lib/api/builds.remote.ts";
  import { link, shippedText, versionStep, withParams } from "#lib/format.ts";
  import { PLATFORM_DEVICES, PLATFORM_ORDER } from "#lib/platforms.ts";
  import type { RecentChange, RecentChanges } from "#lib/server/recent.ts";
  import { visitor } from "#lib/visitor.svelte.ts";
  import Busy from "./Busy.svelte";
  import PaneError from "./PaneError.svelte";
  import PlatformPicker from "./PlatformPicker.svelte";
  import SourceIcon from "./SourceIcon.svelte";
  import SourceName from "./SourceName.svelte";

  /** All is asked for by name, since a URL naming no platform means the visitor's own. */
  const ALL = "all";
  const asked = $derived(page.url.searchParams.get("platform") ?? "");

  // An iPad or watch is shown the menu's first platform's feed.
  const guess = $derived(visitor.guess);
  const own = $derived(guess === null ? undefined : isReleasePlatform(guess.platform) ? guess.platform : PLATFORM_ORDER[0]);
  const country = $derived(guess === null ? undefined : guess.country !== null && ISO_CODE.test(guess.country) ? guess.country : null);
  /** Null for All; undefined while the visitor's platform is unknown. */
  const platform = $derived<ReleasePlatform | null | undefined>(asked === ALL ? null : isReleasePlatform(asked) ? asked : own);

  /** The pages read so far, for the country and platform shown. */
  let feed: RecentChanges | undefined = $state.raw();
  let failed: unknown = $state.raw(null);
  const error = $derived(failed ?? visitor.error);
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
    visitor.retry();
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
  {#if feed === undefined && !error}
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
              <span class="ellipsis"><SourceName brand={c.brand ?? name} code={name} withCode /></span>
              <span class="dimtext ellipsis">{PLATFORM_DEVICES[c.platform]} · <span class="mono">{versions(c)}</span></span>
            </span>
            <span class="dim" title={c.key.at}>{shippedText(c.shipped, now)}</span>
          </a>
        </li>
      {/each}
    </ul>
    {#if feed.next && !error}
      {#key feed.changes.length}<p class="dimtext" {@attach more}><Busy awaiting={{ kind: "index" }} /></p>{/key}
    {/if}
  {/if}
  {#if error}<PaneError {error} reset={retry} quiet={false} />{/if}
</fieldset>

<style>
  fieldset.hgroup {
    margin: 0 0 10px;
  }
  .changes {
    background: var(--field);
    border: 1px solid;
    border-color: var(--bevel-in);
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
  .changes .dimtext {
    font-size: 11px;
  }
</style>
