<script lang="ts">
  import { getChanges } from "$lib/api/bundles.remote";
  import { bundleHref, entryLabel, fileHref } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";
  import DiffTable from "$lib/components/DiffTable.svelte";

  let { params } = $props();
</script>

<div class="scroll pad">
  <Pane>
    {@const changes = await getChanges({ kind: params.kind, name: params.name, slug: params.version })}
    {#if !changes.previous}
      <p class="dimtext" style="margin:0">Oldest version held.</p>
    {:else}
      <table class="grid">
        <tbody>
          <tr><td class="k">This</td><td>{entryLabel(changes.entry)}</td></tr>
          <tr>
            <td class="k">Before</td>
            <td><a href={bundleHref(params.kind, params.name, changes.previous.slug)}>{entryLabel(changes.previous)}</a></td>
          </tr>
        </tbody>
      </table>

      {#each changes.files as f (f.path)}
        <fieldset class="hgroup">
          <legend>
            {#if f.kind === "removed"}
              <span class="mono">{f.path}</span>
            {:else}
              <a class="mono" href={fileHref(params.kind, params.name, params.version, f.path)}>{f.path}</a>
            {/if}
            <span class="chip {f.kind === 'added' ? 'good' : f.kind === 'removed' ? 'bad' : 'warn'}">{f.kind}</span>
          </legend>
          {#if f.rows.length}
            <DiffTable rows={f.rows} />
            {#if f.truncated}<p class="dimtext" style="margin:4px 0 0">First 400 rows.</p>{/if}
          {:else if f.kind === "changed"}
            <span class="dimtext">Bytes differ; no decoded difference.</span>
          {/if}
        </fieldset>
      {:else}
        <p class="dimtext">Identical files.</p>
      {/each}
    {/if}
  </Pane>
</div>
