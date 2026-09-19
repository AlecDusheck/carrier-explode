<script lang="ts">
  import { getIndex } from "$lib/api/bundles.remote";
  import { link } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";
</script>

<div class="view">
  <div class="scroll pad">
    <Pane>
      {@const builds = (await getIndex()).builds}
      <table class="grid">
        <thead><tr><th>iOS</th><th>Build</th><th>Device</th><th>Extracted</th></tr></thead>
        <tbody>
          {#each builds as b (b.build)}
            <tr>
              <td class="k"><a href={link("/releases/" + b.build)}>iOS {b.version}</a></td>
              <td class="mono">{b.build}</td>
              <td class="mono">{b.device}</td>
              <td class="mono">{b.extractedAt.slice(0, 10)}</td>
            </tr>
          {:else}
            <tr><td colspan="4" class="dimtext">No images held.</td></tr>
          {/each}
        </tbody>
      </table>
    </Pane>
  </div>
</div>
