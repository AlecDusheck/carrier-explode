<script lang="ts">
  import { getCountryCarriers, getRuleSources } from "#lib/api/sources.remote.ts";
  import { OTHER_RULES } from "#lib/android/naming.ts";
  import { link } from "#lib/format.ts";
  import { flag, repeated } from "#lib/names.ts";
  import { PLATFORM_NAMES } from "#lib/platforms.ts";
  import Pane from "#lib/components/Pane.svelte";
  import RuleRows from "#lib/components/RuleRows.svelte";
  import SourceIcon from "#lib/components/SourceIcon.svelte";
  import SourceName from "#lib/components/SourceName.svelte";

  /** A country on a platform that ships no country files: its carriers there, by each carrier's country. */
  let { params, data } = $props();

  const name = $derived(data.country);
</script>

<div class="bundle-head">
  <span class="ident">
    {#if flag(params.iso)}<span class="flag" aria-hidden="true">{flag(params.iso)}</span>{/if}
    <b>{name}</b>
  </span>
</div>

<div class="scroll pad">
  <Pane>
    {@const carriers = await getCountryCarriers({ platform: params.platform, iso: params.iso })}
    {@const rules = await getRuleSources({ platform: params.platform, iso: params.iso })}
    {@const twins = repeated(carriers, (c) => c.brand)}
    <p class="dimtext note">{PLATFORM_NAMES[params.platform]} ships no country settings: these are its carriers in {name}.</p>
    <table class="grid">
      <thead><tr><th>Carrier</th></tr></thead>
      <tbody>
        {#each carriers as c (c.key)}
          <tr><td><SourceIcon picture={c.picture} /> <a href={link(c.path)}><SourceName brand={c.brand} code={c.name} withCode={twins.has(c.brand)} /></a></td></tr>
        {/each}
      </tbody>
    </table>
    {#if rules.length}
      <fieldset class="hgroup">
        <legend>{OTHER_RULES} ({rules.length})</legend>
        <RuleRows sources={rules} />
      </fieldset>
    {/if}
  </Pane>
</div>
