<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getBundle, getComparison } from "#lib/api/bundles.remote.ts";
  import { bundleArgs, entryLabel, link, withParams } from "#lib/format.ts";
  import Pane from "#lib/components/Pane.svelte";
  import BundleCompare from "#lib/components/BundleCompare.svelte";
  import type { BundleDiff } from "#lib/decode/compare.ts";

  let { params } = $props();

  const sp = $derived(page.url.searchParams);
  const against = $derived(sp.get("against"));
  const file = $derived(sp.get("file"));
  const args = $derived({
    a: against ? { kind: params.kind, name: params.name, slug: against } : null,
    b: { kind: params.kind, name: params.name, slug: params.version },
    ...(file ? { path: file } : {}),
  });

  const set = (changes: Record<string, string | null>) =>
    goto(withParams(page.url, changes), { reset: false });

  /** Files that change with every build whatever the settings: the version, signatures and translations. */
  const packaging = (path: string) =>
    path === "Info.plist" || path.startsWith("signatures/") || path.includes(".lproj/") || path.endsWith(".loctable");

  /** The answer to "did any setting change?", ahead of the file list. */
  function summary(diff: BundleDiff) {
    const settings = diff.files.filter((f) => f.kind === "changed" && !packaging(f.path)).map((f) => f.path);
    const groups = (kind: "added" | "removed") =>
      diff.files.filter((f) => f.kind === kind && /^overrides_.*\.plist$/.test(f.path)).length;
    return { settings, added: groups("added"), removed: groups("removed") };
  }

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
      <label class="lbl">
        Compare against
        <select
          name="against"
          value={chosen}
          onchange={(e) => set({ against: e.currentTarget.value === bundle.previous?.slug ? null : e.currentTarget.value })}
        >
          {#if !chosen}<option value="">pick a version</option>{/if}
          {#each bundle.timeline.filter((t) => t.slug !== bundle.entry.slug) as t (t.slug)}
            <option value={t.slug}>{entryLabel(t)}{t.slug === bundle.previous?.slug ? " (previous)" : ""}</option>
          {/each}
        </select>
      </label>
      <a href={compareHref(chosen || undefined)}>Compare with another bundle…</a>
    </div>
  </Pane>

  <Pane>
    {@const [bundle, cmp] = await Promise.all([getBundle(bundleArgs(params)), getComparison(args)])}
    {#if !cmp.a || !cmp.diff}
      <p class="dimtext">Oldest version held; pick another version to compare against.</p>
    {:else}
      {@const older = notNewer(bundle.timeline, cmp.a.entry.slug, cmp.b.entry.slug)}
      {#if file}
        <table class="grid gap-above">
          <tbody>
            <tr>
              <td class="k">File</td>
              <td><span class="mono">{file}</span> &middot; <a href={withParams(page.url, { file: null })}>whole bundle</a></td>
            </tr>
          </tbody>
        </table>
      {/if}
      {#if !file}
        {@const s = summary(cmp.diff)}
        <p class="gap-above">
          {#if s.settings.length}
            Settings changed in {#each s.settings as p, i (p)}{i ? ", " : ""}<a href={withParams(page.url, { file: p })} class="mono">{p}</a>{/each}.
          {:else}
            <strong>No settings changed</strong> in the files both versions have.
          {/if}
          {#if s.added}Overrides for {s.added} phone {s.added === 1 ? "group" : "groups"} added.{/if}
          {#if s.removed}Overrides for {s.removed} phone {s.removed === 1 ? "group" : "groups"} removed.{/if}
          {#if s.added || s.removed}<span class="dimtext">(A copy inside an iOS image only has the overrides for that image's phones.)</span>{/if}
        </p>
      {/if}
      <BundleCompare
        diff={cmp.diff}
        a={cmp.a}
        b={cmp.b}
        left={older ? "Before" : "Other"}
        right={older ? "After" : "This"}
        narrowHref={(path) => withParams(page.url, { file: path })}
      />
    {/if}
  </Pane>
</div>
