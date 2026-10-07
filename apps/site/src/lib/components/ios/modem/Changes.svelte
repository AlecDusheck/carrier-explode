<script lang="ts">
  import { page } from "$app/state";
  import { getBasebandDiff } from "#lib/api/apple.remote.ts";
  import { getBuilds } from "#lib/api/builds.remote.ts";
  import { withParams } from "#lib/format.ts";
  import type { ModemProps } from "../../views.ts";
  import BuildPicker from "../../BuildPicker.svelte";
  import Pane from "../../Pane.svelte";
  import BasebandDiff from "../BasebandDiff.svelte";

  let { build, modem }: ModemProps = $props();
</script>

<div class="scroll pad">
  <Pane>
    {@const builds = (await getBuilds()).filter((b) => b.platform === "ios" && b.modemFamilies.some((f) => f.code === modem))}
    {@const at = builds.findIndex((b) => b.id === build)}
    <!-- Against the newest earlier image with this modem, unless another is picked. -->
    {@const previous = builds.slice(at + 1)[0]?.id}
    {@const against = page.url.searchParams.get("against") ?? previous}
    {@const others = builds.filter((b) => b.id !== build)}
    {#if !against || !others.length}
      <p class="dimtext note">No other image has a {modem} package.</p>
    {:else}
      <div class="filters">
        <BuildPicker label="Compare against" builds={others} current={against} href={(b) => withParams(page.url, { against: b.id === previous ? null : b.id })} />
      </div>
      <Pane awaiting={{ kind: "diff", name: modem }}>
        {@const d = await getBasebandDiff({ a: against, b: build, family: modem })}
        <p class="dimtext note">{d.counts.changed} changed, {d.counts.added} added, {d.counts.removed} removed.</p>
        <BasebandDiff parts={d.parts} />
      </Pane>
    {/if}
  </Pane>
</div>
