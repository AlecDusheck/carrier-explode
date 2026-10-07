<script lang="ts">
  import { OTHER_RULES } from "#lib/android/naming.ts";
  import { getRuleSources } from "#lib/api/sources.remote.ts";
  import { fold } from "#lib/names.ts";
  import { countryName } from "@carrier-explode/schema";
  import Pane from "#lib/components/Pane.svelte";
  import RuleRows from "#lib/components/RuleRows.svelte";
  import SourceName from "#lib/components/SourceName.svelte";

  let { params } = $props();

  let filter = $state("");
  const country = (cc: string | undefined): string => (cc === undefined ? "" : (countryName(cc) ?? cc.toUpperCase()));
</script>

<div class="bundle-head">
  <span class="ident"><b><SourceName brand={OTHER_RULES} code="others.pb" withCode /></b></span>
</div>

<div class="scroll pad">
  <Pane>
    {@const all = await getRuleSources({ platform: params.platform, iso: null })}
    {@const f = fold(filter)}
    {@const shown = f ? all.filter((s) => [s.name, country(s.cc)].some((x) => fold(x).includes(f))) : all}
    <p class="dimtext note">Parts of others.pb named by the SIM rule that selects them, with no carrier name.</p>
    <input class="grow" type="search" placeholder="filter" aria-label="filter rules" bind:value={filter} />
    <RuleRows sources={shown} withCountry />
  </Pane>
</div>
