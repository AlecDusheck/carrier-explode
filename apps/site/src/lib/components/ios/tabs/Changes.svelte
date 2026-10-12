<script lang="ts">
  import { page } from "$app/state";
  import { getPhoneChanges } from "#lib/api/apple.remote.ts";
  import { getComparison, getSourceHead } from "#lib/api/sources.remote.ts";
  import { routineReason } from "#lib/apple/routine-changes.ts";
  import { verArgs, versionHref, withParams } from "#lib/format.ts";
  import type { TabProps } from "#lib/types.ts";
  import ChangesHeader from "../../ChangesHeader.svelte";
  import Pane from "../../Pane.svelte";
  import BundleCompare from "../BundleCompare.svelte";
  import PhoneChanges from "../PhoneChanges.svelte";

  let { at }: TabProps = $props();

  const sp = $derived(page.url.searchParams);
  const against = $derived(sp.get("against"));
  const file = $derived(sp.get("file"));
  const head = $derived(await getSourceHead(verArgs(at)));
  const chosen = $derived(against ?? head.previous?.slug ?? "");
  const slugAt = (slug: string): number => head.timeline.findIndex((t) => t.slug === slug);
  const older = $derived(slugAt(chosen) >= slugAt(at.version));
</script>

<ChangesHeader {at} {head} {chosen} other="bundle" {file} />

<Pane awaiting={{ kind: "diff", name: at.version }}>
  {@const cmp = await getComparison({
    a: against ? { ...verArgs(at), slug: against } : null,
    b: verArgs(at),
    ...(file ? { path: file } : {}),
  })}
  {#if cmp.by !== "native" || cmp.family !== "apple" || !cmp.a || !cmp.diff}
    <p class="dimtext">Nothing older to compare against.</p>
  {:else}
    {@const before = cmp.a.entry.slug}
    {#if file}
      <div class="filters gap-above">
        <span class="mono breakall">{file}</span>
        <a href={withParams(page.url, { file: null })}>Whole bundle</a>
      </div>
    {:else}
      {#if !cmp.diff.files.some((f) => !routineReason(f, true))}
        <p class="note"><b>No change</b> in carrier.plist or any other file every phone reads.</p>
      {/if}
      {@const phones = await getPhoneChanges({ ...verArgs(at), ...(against ? { against } : {}) })}
      {#if phones?.length}<PhoneChanges changes={phones} />{/if}
    {/if}
    <BundleCompare
      diff={cmp.diff}
      fileHref={(side, path) => versionHref({ ...at, version: side === "a" ? before : at.version }, "files", path)}
      left={older ? "Before" : "Other"}
      right={older ? "After" : "This"}
      narrowHref={(path) => withParams(page.url, { file: path })}
      routine={file ? undefined : (f) => routineReason(f, true)}
    />
  {/if}
</Pane>
