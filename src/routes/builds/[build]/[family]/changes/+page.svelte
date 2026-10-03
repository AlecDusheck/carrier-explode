<script lang="ts">
  import { page } from "$app/state";
  import { getBasebandBuilds, getBasebandDiff } from "#lib/api/tables.remote.ts";
  import { withParams } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";
  import BuildPicker from "#lib/components/BuildPicker.svelte";
  import BasebandDiff from "#lib/components/BasebandDiff.svelte";

  let { params } = $props();
</script>

<div class="scroll pad">
  <Pane>
    {@const builds = (await getBasebandBuilds()).filter((b) => b.families.includes(params.family))}
    {@const at = builds.findIndex((b) => b.build === params.build)}
    <!-- Against the newest earlier image with this modem, unless another is picked. -->
    {@const previous = builds.slice(at + 1)[0]?.build}
    {@const against = page.url.searchParams.get("against") ?? previous}
    {@const others = builds.filter((b) => b.build !== params.build)}
    {#if !against || !others.length}
      <p class="dimtext note">No other image has a {params.family} package.</p>
    {:else}
      <div class="filters">
        <BuildPicker
          label="Compare against"
          builds={others}
          current={against}
          href={(b) => withParams(page.url, { against: b.build === previous ? null : b.build })}
        />
      </div>
      <Pane>
        {@const d = await getBasebandDiff({ a: against, b: params.build, family: params.family })}
        <p class="dimtext note">{d.counts.changed} changed, {d.counts.added} added, {d.counts.removed} removed.</p>
        <BasebandDiff parts={d.parts} />
      </Pane>
    {/if}
  </Pane>
</div>
