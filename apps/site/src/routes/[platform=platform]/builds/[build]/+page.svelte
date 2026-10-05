<script lang="ts">
  import { getRelease } from "#lib/api/builds.remote.ts";
  import { buildHref, link } from "#lib/format.ts";
  import { releaseLabel } from "#lib/naming.ts";
  import { sourceOf, type SourceKind } from "@carrier-explode/schema/types";
  import type { ReleasedVersion, SourceChange } from "#lib/server/releases.ts";
  import Pane from "#lib/components/Pane.svelte";
  import ReleaseModems from "#lib/components/ReleaseModems.svelte";
  import SourceIcon from "#lib/components/SourceIcon.svelte";
  import VersionMark from "#lib/components/VersionMark.svelte";
  import { RELEASE_VIEWS } from "#lib/components/views.ts";

  let { params, data } = $props();

  const ofKind = (cs: readonly SourceChange[], kind: SourceKind): SourceChange[] => cs.filter((c) => sourceOf(c.source).kind === kind);
</script>

{#snippet named(c: SourceChange, at: ReleasedVersion | null, cls: string)}
  {@const name = sourceOf(c.source).name}
  {#if at?.path}
    <a class={cls} href={link(at.path)}>{#if c.picture}<SourceIcon picture={c.picture} />{/if}{name}</a>
  {:else}
    <span class={cls}>{#if c.picture}<SourceIcon picture={c.picture} />{/if}{name}</span>
  {/if}
{/snippet}

<div class="view">
  <div class="scroll pad">
    <Pane>
      {@const r = await getRelease({ platform: data.platform, build: params.build })}
      {@const view = RELEASE_VIEWS[r.release.platform]}
      <div class="filters">
        <view.Name release={r.release} />
        {#if r.previous}
          <span class="dimtext">since</span>
          <a class="picker-opt" href={buildHref(r.previous.platform, r.previous.id)}><VersionMark platform={r.previous.platform} version={r.previous.version} />{releaseLabel(r.previous)} ({r.previous.id})</a>
        {:else}
          <span class="dimtext">{view.oldest}</span>
        {/if}
      </div>

      <ReleaseModems release={r.release} />

      {#if !r.added.length && !r.removed.length && !r.changed.length}
        <p class="note">{view.unchanged}</p>
      {:else}
        {#each view.kinds as { kind, title, unchanged } (kind)}
          {@const [added, removed, changed] = [ofKind(r.added, kind), ofKind(r.removed, kind), ofKind(r.changed, kind)]}
          {#if !added.length && !removed.length && !changed.length}
            {#if unchanged}<p class="note">{unchanged}</p>{/if}
          {:else}
            <fieldset class="hgroup">
              <legend>{title}: {changed.length} changed, {added.length} added, {removed.length} removed</legend>
              {#if added.length}
                <p class="names"><b>Added</b>
                  {#each added as c (c.source)}{@render named(c, c.to, "chip bundle good")}{/each}
                </p>
              {/if}
              {#if removed.length}
                <p class="names"><b>Removed</b>
                  {#each removed as c (c.source)}{@render named(c, c.from, "chip bundle bad")}{/each}
                </p>
              {/if}
              {#if changed.length}
                <table class="grid">
                  <thead><tr><th>{view.column}</th><th class="num">Version</th></tr></thead>
                  <tbody>
                    {#each changed as c (c.source)}
                      {@const text = c.from?.version === c.to?.version ? c.to?.version : `${c.from?.version} → ${c.to?.version}`}
                      <tr>
                        <td class="k">{@render named(c, c.to, "picker-opt")}</td>
                        <!-- The version links to what changed; a content change can keep the version. -->
                        <td class="num mono">{#if c.to?.path}<a href={link(c.to.path + "/changes")}>{text}</a>{:else}{text}{/if}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
            </fieldset>
          {/if}
        {/each}
      {/if}
    </Pane>
  </div>
</div>

<style>
  .names { margin: 0 0 6px; }
  .names b { margin-right: 6px; }
</style>
