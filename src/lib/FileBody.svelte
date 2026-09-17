<script lang="ts">
  import { api, humanBytes, type DecodedFile } from "./api.ts";
  import Tree from "./Tree.svelte";
  import PriView from "./PriView.svelte";

  interface Ctx { file: string; cc?: string; kind: "carrier" | "country" }
  let {
    file,
    ctx,
    bundleUrl,
  }: { file: DecodedFile; ctx: Ctx; bundleUrl: string } = $props();

  const hexDump = $derived.by(() => {
    if (!file.hex) return "";
    return (file.hex.match(/.{1,32}/g) ?? [])
      .map((g, i) => {
        const bytes = g.match(/.{1,2}/g) ?? [];
        const ascii = bytes
          .map((b) => {
            const c = parseInt(b, 16);
            return c >= 32 && c < 127 ? String.fromCharCode(c) : ".";
          })
          .join("");
        return (i * 16).toString(16).padStart(6, "0") + "  " + bytes.join(" ").padEnd(47) + "  " + ascii;
      })
      .join("\n");
  });
</script>

<div class="rowflex" style="margin-bottom:6px">
  <span class="chip">{file.kind}</span>
  <span class="dimtext">{humanBytes(file.size)}</span>
  {#if file.devices?.length}
    {#each file.devices as d, i (i)}
      <span class="chip" title={d.ids ?? ""}>{d.code}{d.name ? " " + d.name : ""}</span>
    {/each}
  {/if}
  <span class="grow"></span>
  <a class="btn" href={api.rawUrl(bundleUrl, file.path, true)}>Save file</a>
  <a class="btn" href={api.rawUrl(bundleUrl, file.path)} target="_blank" rel="noreferrer">Open raw</a>
</div>

{#if file.note && file.kind !== "image"}<div class="banner">{file.note}</div>{/if}

{#if file.pri}
  <PriView pri={file.pri} />
{:else if file.plist !== undefined}
  <Tree value={file.plist} ctx={{ ...ctx, file: file.path }} />
{:else if file.kind === "image"}
  <p class="dimtext" style="margin-top:0">{file.note ?? ""}</p>
  <span class="checker" style="display:inline-block; padding:10px; border:1px solid var(--shadow)">
    <img
      src={api.rawUrl(bundleUrl, file.path)}
      alt={file.path}
      style="image-rendering:pixelated; max-width:100%; display:block"
    />
  </span>
{:else if file.text}
  <pre class="code">{file.text}</pre>
{:else if file.hex}
  <pre class="code hex">{hexDump}</pre>
{:else}
  <p class="dimtext">Nothing decodable in this file.</p>
{/if}
