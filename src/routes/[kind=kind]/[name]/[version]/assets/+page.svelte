<script lang="ts">
  import { getBundle } from "$lib/api/bundles.remote";
  import { bundleArgs, fileHref, humanBytes, rawHref } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";

  let { params } = $props();
</script>

<div class="scroll pad">
  <Pane>
    {@const bundle = await getBundle(bundleArgs(params))}
    <div class="gallery">
      {#each bundle.info.files.filter((f) => f.kind === "image") as f (f.path)}
        <figure>
          <a class="checker" href={fileHref(params.kind, params.name, params.version, f.path)}>
            <img src={rawHref(params.kind, params.name, params.version, f.path)} alt={f.path} loading="lazy" />
          </a>
          <figcaption class="mono">{f.path}<br /><span class="dimtext">{humanBytes(f.size)}</span></figcaption>
        </figure>
      {:else}
        <p class="dimtext" style="margin:0">No images.</p>
      {/each}
    </div>
  </Pane>
</div>

<style>
  .gallery { display: flex; flex-wrap: wrap; gap: 8px; }
  figure {
    margin: 0; border: 1px solid var(--shadow); background: var(--face);
    padding: 6px; min-width: 130px; max-width: 100%; text-align: center;
  }
  .checker { display: inline-block; padding: 6px; max-width: 100%; }
  img { max-width: min(200px, 100%); image-rendering: pixelated; display: block; }
  figcaption { font-size: 10px; word-break: break-all; margin-top: 4px; }
</style>
