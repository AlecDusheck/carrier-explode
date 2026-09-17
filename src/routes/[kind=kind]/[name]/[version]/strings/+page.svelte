<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getBundle, getFile } from "$lib/api/bundles.remote";
  import { bundleArgs, rawHref, withParams } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";
  import FileBody from "$lib/components/FileBody.svelte";

  let { params } = $props();

  const wantedLocale = $derived(page.url.searchParams.get("locale"));
  const wantedFile = $derived(page.url.searchParams.get("file"));
  const set = (changes: Record<string, string | null>) =>
    goto(withParams(page.url, changes), { replaceState: true, keepFocus: true, noScroll: true });
</script>

<div class="scroll pad">
  <Pane>
    {@const bundle = await getBundle(bundleArgs(params))}
    {@const locales = bundle.info.locales}
    {@const locale = locales.find((l) => l === wantedLocale) ?? locales.find((l) => l === "en" || l === "English") ?? locales[0]}
    {@const files = bundle.info.files.filter((f) => f.locale && f.locale === locale)}
    {@const path = files.find((f) => f.path.split("/").pop() === wantedFile)?.path ?? files[0]?.path}

    {#if path}
      <div class="rowflex" style="margin-bottom:8px">
        <label class="lbl">
          Locale
          <select name="locale" value={locale} onchange={(e) => set({ locale: e.currentTarget.value })}>
            {#each locales as l (l)}<option value={l}>{l}</option>{/each}
          </select>
        </label>
        <label class="lbl grow">
          File
          <select class="grow" name="file" value={path.split("/").pop()} onchange={(e) => set({ file: e.currentTarget.value })}>
            {#each files as f (f.path)}{@const base = f.path.split("/").pop()}<option value={base}>{base}</option>{/each}
          </select>
        </label>
      </div>
      <FileBody
        file={await getFile({ kind: params.kind, name: params.name, slug: params.version, path })}
        cc={bundle.cc}
        raw={rawHref(params.kind, params.name, params.version, path)}
      />
    {:else}
      <p class="dimtext" style="margin:0">No localised strings.</p>
    {/if}
  </Pane>
</div>
