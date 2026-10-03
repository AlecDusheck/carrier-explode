<script lang="ts">
  import { getBasebandBuilds } from "#lib/api/tables.remote.ts";
  import { modemLabel } from "#lib/decode/index.ts";
  import { link } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";
  import IosIcon from "#lib/components/IosIcon.svelte";
</script>

<div class="view">
  <div class="scroll pad">
    <Pane>
      {@const builds = await getBasebandBuilds()}
      <fieldset class="hgroup">
        <legend>iOS builds ({builds.length})</legend>
        <table class="grid">
          <thead><tr><th>iOS</th><th>Build</th><th>Modem packages</th></tr></thead>
          <tbody>
            {#each builds as b, i (b.build)}
              <!-- Each row names only the packages that differ from the next older image with any; the oldest just counts. -->
              {@const before = builds.slice(i + 1).find((x) => x.families.length)?.families ?? b.families}
              {@const added = b.families.filter((f) => !before.includes(f))}
              {@const gone = b.families.length ? before.filter((f) => !b.families.includes(f)) : []}
              <tr>
                <td class="k"><a class="picker-opt" href={link("/builds/" + b.build)}><IosIcon version={b.version} />iOS {b.version}</a></td>
                <td class="mono">{b.build}</td>
                <td>
                  {#if b.families.length}
                    {b.families.length}
                    {#if added.length}<span class="dimtext">new:</span> {#each added as f, j (f)}{#if j}, {/if}<a href={link(`/builds/${b.build}/${f}`)}>{modemLabel(f)}</a>{/each}{/if}
                    {#if gone.length}<span class="dimtext">gone:</span> {gone.map(modemLabel).join(", ")}{/if}
                  {:else}
                    <span class="dimtext">not extracted</span>
                  {/if}
                </td>
              </tr>
            {:else}
              <tr><td colspan="3" class="dimtext">No images held.</td></tr>
            {/each}
          </tbody>
        </table>
      </fieldset>
    </Pane>
  </div>
</div>
