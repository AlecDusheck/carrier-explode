<script lang="ts">
  import { page } from "$app/state";
  import { getBundle, getComparison, getPhoneChanges } from "#lib/api/bundles.remote.ts";
  import { routineReason } from "#lib/changes.ts";
  import PhoneChanges from "#lib/components/PhoneChanges.svelte";
  import { bundleArgs, link, withParams } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";
  import BundleCompare from "#lib/components/BundleCompare.svelte";
  import VersionPicker from "#lib/components/VersionPicker.svelte";

  let { params } = $props();

  const sp = $derived(page.url.searchParams);
  const against = $derived(sp.get("against"));
  const file = $derived(sp.get("file"));
  const args = $derived({
    a: against ? { kind: params.kind, name: params.name, slug: against } : null,
    b: { kind: params.kind, name: params.name, slug: params.version },
    ...(file ? { path: file } : {}),
  });

  /** The timeline runs newest first. */
  function notNewer(timeline: Array<{ slug: string }>, x: string, y: string) {
    const at = (slug: string) => timeline.findIndex((t) => t.slug === slug);
    return at(x) >= at(y);
  }

  function compareHref(av: string | undefined) {
    const q = new URLSearchParams({ a: params.name, ...(av ? { av } : {}), b: params.name, bv: params.version });
    if (file) q.set("file", file);
    return link("/compare") + "?" + q;
  }
</script>

<div class="scroll pad">
  <Pane>
    {@const bundle = await getBundle(bundleArgs(params))}
    {@const chosen = against ?? bundle.previous?.slug ?? ""}
    <div class="rowflex">
      <VersionPicker
        label="Compare against"
        timeline={bundle.timeline.filter((t) => t.slug !== bundle.entry.slug)}
        current={chosen}
        head={bundle.head}
        href={(slug) => withParams(page.url, { against: slug === bundle.previous?.slug ? null : slug })}
      />
      <a href={compareHref(chosen || undefined)}>Compare with another bundle…</a>
    </div>
  </Pane>

  <Pane>
    {@const [bundle, cmp] = await Promise.all([getBundle(bundleArgs(params)), getComparison(args)])}
    {#if !cmp.a || !cmp.diff}
      <p class="dimtext">Nothing older to compare against.</p>
    {:else}
      {@const older = notNewer(bundle.timeline, cmp.a.entry.slug, cmp.b.entry.slug)}
      {#if file}
        <div class="filters gap-above">
          <span class="mono breakall">{file}</span>
          <a href={withParams(page.url, { file: null })}>Whole bundle</a>
        </div>
      {:else}
        {#if !cmp.diff.files.some((f) => !routineReason(f, true))}
          <p class="note"><b>No change</b> in carrier.plist or any other file every phone reads.</p>
        {/if}
        {@const phones = await getPhoneChanges({ kind: params.kind, name: params.name, slug: params.version, against: against ?? undefined })}
        {#if phones?.length}<PhoneChanges changes={phones} />{/if}
      {/if}
      <BundleCompare
        diff={cmp.diff}
        a={cmp.a}
        b={cmp.b}
        left={older ? "Before" : "Other"}
        right={older ? "After" : "This"}
        narrowHref={(path) => withParams(page.url, { file: path })}
        routine={file ? undefined : (f) => routineReason(f, true)}
      />
    {/if}
  </Pane>
</div>
