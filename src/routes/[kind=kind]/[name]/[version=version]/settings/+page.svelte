<script lang="ts">
  import { page } from "$app/state";
  import { getBundle, getOverridePlist, getRare } from "#lib/api/bundles.remote.ts";
  import { getBundleOverrides } from "#lib/api/tables.remote.ts";
  import { bundleArgs, withParams } from "#lib/format.ts";
  import { phoneList, phoneRows, pickPhoneRow } from "#lib/phones.ts";
  import { asDict, effective, groupSettings, rareBadges } from "#lib/settings.ts";
  import { TreeState } from "#lib/ui-state.svelte.ts";
  import type { KeyBadge } from "#lib/components/Tree.svelte";
  import Pane from "#lib/components/Pane.svelte";
  import Tree from "#lib/components/Tree.svelte";
  import TreeToolbar from "#lib/components/TreeToolbar.svelte";
  import PhonePicker from "#lib/components/PhonePicker.svelte";
  import LocalisedText from "#lib/components/LocalisedText.svelte";

  let { params } = $props();

  const args = $derived(bundleArgs(params));
  const sp = $derived(page.url.searchParams);
  const show = $derived(sp.get("show") === "phone" ? "phone" : "all");
  const VIEWS = [["all", "All"], ["phone", "This phone's overrides"]] as const;

  const tree = new TreeState();
  // A link from the Overview names the key to show.
  tree.filter = page.url.searchParams.get("filter") ?? "";

  /** Badges merged per key, in a fixed order: source first, then rarity. */
  function badgesFor(keys: string[], phone: Set<string>, rare: Record<string, KeyBadge[]>, country: Set<string>, phoneName: string) {
    const out: Record<string, KeyBadge[]> = {};
    for (const k of keys) {
      const b: KeyBadge[] = [];
      if (phone.has(k)) b.push({ text: "phone", tone: "phone", title: `Set by ${phoneName}'s override file` });
      if (country.has(k)) b.push({ text: "country too", tone: "country", title: "The home country bundle sets this too; which one wins is not documented" });
      b.push(...(rare[k] ?? []));
      if (b.length) out[k] = b;
    }
    return out;
  }
</script>

<div class="scroll pad">
  <Pane>
    {@const bundle = await getBundle(args)}
    {@const carrier = asDict(bundle.quick["carrier.plist"])}
    {@const ov = bundle.kind === "countries" ? null : await getBundleOverrides(args)}
    {@const rows = phoneRows(bundle.entry, bundle.info.files, ov).filter((r) => r.phones.length)}
    {@const { row, missing } = pickPhoneRow(rows, { file: sp.get("file") })}
    {@const over = row ? await getOverridePlist({ ...args, slug: bundle.entry.slug, path: row.path }) : null}
    {@const phoneDict = asDict(over?.plist)}
    {@const rare = await getRare(args)}
    {@const home = bundle.related.country ? await getBundle({ kind: "countries", name: bundle.related.country }) : null}
    {@const homeDict = asDict(home?.quick["carrier.plist"])}

    <PhonePicker {rows} selected={row} />
    {#if missing}
      <div class="banner">No phone reads <span class="mono">{missing}</span> in this version; showing {row ? phoneList(row.phones) : "carrier.plist alone"} instead.</div>
    {/if}
    <TreeToolbar state={tree} label="filter settings">
      {#each VIEWS as [v, label] (v)}
        {#if v !== "phone" || phoneDict}
          <a class="btn" href={withParams(page.url, { show: v === "all" ? null : v })} aria-current={show === v ? "page" : undefined}>{label}</a>
        {/if}
      {/each}
    </TreeToolbar>

    {#if !carrier}
      <div class="banner">No carrier.plist.</div>
    {:else}
      {@const eff = effective(carrier, phoneDict)}
      {@const rareTop = rare.indexed ? rareBadges(rare.rows) : {}}
      {@const country = new Set(Object.keys(homeDict ?? {}))}
      {@const phoneName = row ? phoneList(row.phones) : ""}
      {@const keep = (k: string) => show === "all" || eff.fromPhone.has(k)}
      {@const shown = Object.fromEntries(Object.entries(eff.merged).filter(([k]) => keep(k)))}
      {@const badges = badgesFor(Object.keys(shown), eff.fromPhone, rareTop, country, phoneName)}

      {#if phoneDict}
        <p class="dimtext note">carrier.plist + <span class="mono">{over?.path}</span></p>
      {:else if rows.length}
        <p class="dimtext note">No override plist for these phones.</p>
      {/if}

      {#each groupSettings(shown) as [title, picked] (title)}
        <fieldset class="hgroup">
          <legend>{title} ({Object.keys(picked).length})</legend>
          <Tree value={picked} ctx={{ file: "carrier.plist", cc: bundle.cc }} state={tree} {badges} />
        </fieldset>
      {:else}
        <p class="dimtext note">No keys in this view.</p>
      {/each}
    {/if}

    {#if bundle.info.locales.length && show === "all"}
      <fieldset class="hgroup" id="text">
        <legend>Localised text ({bundle.info.locales.length} languages)</legend>
        <LocalisedText {bundle} />
      </fieldset>
    {/if}
  </Pane>
</div>
