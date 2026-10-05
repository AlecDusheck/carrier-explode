<script lang="ts">
  import { getCountryCarriers } from "#lib/api/sources.remote.ts";
  import { link } from "#lib/format.ts";
  import { flag } from "#lib/names.ts";
  import { PLATFORM_NAMES } from "#lib/platforms.ts";
  import Pane from "#lib/components/Pane.svelte";
  import SourceIcon from "#lib/components/SourceIcon.svelte";

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
    <p class="dimtext note">{PLATFORM_NAMES[params.platform]} ships no country settings: these are its carriers in {name}.</p>
    <table class="grid">
      <thead><tr><th>Carrier</th><th>File</th><th>Updated</th></tr></thead>
      <tbody>
        {#each carriers as c (c.key)}
          <tr>
            <td><SourceIcon picture={c.picture} /> <a href={link(c.path)}>{c.brand}</a></td>
            <td class="mono">{c.name}</td>
            <td class="dimtext">{c.updated ?? ""}</td>
          </tr>
        {:else}
          <tr><td colspan="3" class="dimtext">No carriers.</td></tr>
        {/each}
      </tbody>
    </table>
  </Pane>
</div>
