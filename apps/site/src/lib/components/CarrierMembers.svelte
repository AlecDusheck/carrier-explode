<script lang="ts">
  import { getCarrierMembers } from "#lib/api/sources.remote.ts";
  import { counterparts } from "#lib/counterparts.ts";
  import { PLATFORM_NAMES } from "#lib/platforms.ts";
  import { sourceKey } from "@carrier-explode/schema/types";
  import type { At } from "#lib/types.ts";
  import SourceChip from "./SourceChip.svelte";

  /** The source's carrier on every platform: the files linked into it beside this one. */
  let { at }: { at: At } = $props();

  const self = $derived(sourceKey(at.ref));
  const groups = $derived(counterparts(self, await getCarrierMembers(self)));
</script>

{#if groups.length}
  <fieldset class="hgroup">
    <legend>Same carrier</legend>
    <table class="grid fit">
      <tbody>
        {#each groups as g (g.platform)}
          <tr><td class="k">{PLATFORM_NAMES[g.platform]}</td><td>{#each g.members as m (m.key)}<SourceChip source={m} />{/each}</td></tr>
        {/each}
      </tbody>
    </table>
  </fieldset>
{/if}
