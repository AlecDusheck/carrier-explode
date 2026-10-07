<script lang="ts">
  import { link } from "#lib/format.ts";
  import { flag } from "#lib/names.ts";
  import { selectionRows } from "#lib/settings.ts";
  import { countryName } from "@carrier-explode/schema";
  import type { RuleSource } from "#lib/server/lists.ts";

  /** Sources named only by a SIM rule, each with the rules that select it. */
  let { sources, withCountry = false }: { sources: readonly RuleSource[]; withCountry?: boolean } = $props();
</script>

<table class="grid">
  <thead><tr><th>Part</th>{#if withCountry}<th>Country</th>{/if}<th>Selected by</th></tr></thead>
  <tbody>
    {#each sources as s (s.key)}
      <tr>
        <td class="mono"><a href={link(s.path)}>{s.name}</a></td>
        {#if withCountry}
          <td>{#if s.cc}{flag(s.cc)} {countryName(s.cc) ?? s.cc.toUpperCase()}{/if}</td>
        {/if}
        <td>
          {#each selectionRows(s.rules) as r, i (i)}
            <div><span class="mono">{r.keys.join(", ")}</span> <span class="dimtext">{r.match ?? r.via}</span></div>
          {/each}
        </td>
      </tr>
    {:else}
      <tr><td colspan={withCountry ? 3 : 2} class="dimtext">None.</td></tr>
    {/each}
  </tbody>
</table>
