<script lang="ts">
  import { page } from "$app/state";
  import { getBundle, getOverridePlist, getRare } from "#lib/api/bundles.remote.ts";
  import { getBundleOverrides } from "#lib/api/tables.remote.ts";
  import { bundleArgs, bundleHref, withParams } from "#lib/format.ts";
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
  const show = $derived(sp.get("show") === "unique" ? "unique" : sp.get("show") === "phone" ? "phone" : "all");
  const VIEWS = [["all", "All"], ["unique", "Unique"], ["phone", "This phone's overrides"]] as const;

  const tree = new TreeState();
  // A link from the Overview names the key to show.
  tree.filter = page.url.searchParams.get("filter") ?? "";

  /** Badges merged per key, in a fixed order: source first, then rarity. */
  function badgesFor(keys: string[], phone: Set<string>, rare: Record<string, KeyBadge[]>, country: Set<string>, phoneName: string) {
    const out: Record<string, KeyBadge[]> = {};
    for (const k of keys) {
      const b: KeyBadge[] = [];
      if (phone.has(k)) b.push({ text: "phone", tone: "phone", title: `Set by ${phoneName}'s override file` });
      if (country.has(k)) b.push({ text: "country too", tone: "country", title: "The home country bundle sets this key as well" });
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
    {@const row = pickPhoneRow(rows, { file: sp.get("file"), copy: sp.get("copy") ?? undefined }, ov?.home)}
    {@const over = row ? await getOverridePlist({ ...args, slug: row.copy ?? bundle.entry.slug, path: row.path }) : null}
    {@const phoneDict = asDict(over?.plist)}
    {@const rare = await getRare(args)}
    {@const home = bundle.related.country ? await getBundle({ kind: "countries", name: bundle.related.country }) : null}
    {@const homeDict = asDict(home?.quick["carrier.plist"])}

    <PhonePicker {rows} selected={row} />
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
      {@const keep = (k: string) => show === "all" || (show === "unique" ? k in rareTop : eff.fromPhone.has(k))}
      {@const shown = Object.fromEntries(Object.entries(eff.merged).filter(([k]) => keep(k)))}
      {@const badges = badgesFor(Object.keys(shown), eff.fromPhone, rareTop, country, phoneName)}

      <p class="dimtext note">
        {#if phoneDict}
          carrier.plist with <span class="mono">{over?.path}</span> on top, as {phoneName} get{row && row.phones.length === 1 ? "s" : ""} it: the override's keys replace carrier.plist's.
        {:else}
          carrier.plist as every phone gets it{rows.length ? "; this phone group has no override plist" : ""}.
        {/if}
        {#if rare.indexed}Keys marked <span class="badge rare">n of N</span> hold a value at most three other bundles share.{/if}
      </p>

      {#each groupSettings(shown) as [title, picked] (title)}
        <fieldset class="hgroup">
          <legend>{title} ({Object.keys(picked).length})</legend>
          <Tree value={picked} ctx={{ file: "carrier.plist", cc: bundle.cc }} state={tree} {badges} />
        </fieldset>
      {:else}
        <p class="dimtext note">No keys in this view.</p>
      {/each}

      {#if homeDict && home && show === "all"}
        <fieldset class="hgroup">
          <legend>Home country bundle: <a href={bundleHref("countries", home.name)}>{home.name}</a></legend>
          <p class="dimtext note">
            Picked by the network the phone is on, not the SIM, so abroad it is that country's bundle instead.
            Where both bundles set a key, which one wins is not documented.
          </p>
          <Tree value={homeDict} ctx={{ file: "carrier.plist", cc: home.cc }} state={tree} />
        </fieldset>
      {/if}
    {/if}

    {#if bundle.info.locales.length && show === "all"}
      <fieldset class="hgroup" id="text">
        <legend>Localised text ({bundle.info.locales.length} languages)</legend>
        <LocalisedText {bundle} />
      </fieldset>
    {/if}
  </Pane>
</div>
