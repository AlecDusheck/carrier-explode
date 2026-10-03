<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getFile, type getBundle } from "#lib/api/bundles.remote.ts";
  import { rawHref, withParams } from "#lib/format.ts";
  import FileBody from "./FileBody.svelte";

  let { bundle }: { bundle: Awaited<ReturnType<typeof getBundle>> } = $props();

  const wantedLocale = $derived(page.url.searchParams.get("locale"));
  const wantedFile = $derived(page.url.searchParams.get("strings"));
  const set = (changes: Record<string, string | null>) => goto(withParams(page.url, changes), { replace: true, reset: false });

  const locales = $derived(bundle.info.locales);
  const locale = $derived(locales.find((l) => l === wantedLocale) ?? locales.find((l) => l === "en" || l === "English") ?? locales[0]);
  const files = $derived(bundle.info.files.filter((f) => f.locale && f.locale === locale));
  const path = $derived(files.find((f) => f.path.split("/").pop() === wantedFile)?.path ?? files[0]?.path);
</script>

{#if path}
  <div class="filters">
    <label class="lbl">
      Language
      <select name="locale" value={locale} onchange={(e) => set({ locale: e.currentTarget.value })}>
        {#each locales as l (l)}<option value={l}>{l}</option>{/each}
      </select>
    </label>
    <label class="lbl grow">
      File
      <select name="strings" value={path.split("/").pop()} onchange={(e) => set({ strings: e.currentTarget.value })}>
        {#each files as f (f.path)}{@const base = f.path.split("/").pop()}<option value={base}>{base}</option>{/each}
      </select>
    </label>
  </div>
  <FileBody
    file={await getFile({ kind: bundle.kind, name: bundle.name, slug: bundle.entry.slug, path })}
    cc={bundle.cc}
    raw={rawHref(bundle.kind, bundle.name, bundle.entry.slug, path)}
  />
{:else}
  <p class="dimtext note">No localised strings.</p>
{/if}
