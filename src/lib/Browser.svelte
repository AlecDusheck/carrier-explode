<script lang="ts">
  import { api, refLabel, type BundlePayload, type BundleRef, type IndexPayload } from "./api.ts";
  import { router, menuTrigger, copyText } from "./state.svelte.ts";
  import BundleView from "./BundleView.svelte";

  let {
    index,
    family,
    drawerOpen = $bindable(false),
  }: { index: IndexPayload; family: "iPhone" | "Watch" | "Country"; drawerOpen: boolean } = $props();

  let query = $state("");
  let refs = $state<BundleRef[]>([]);
  let cc = $state<string | undefined>(undefined);
  let activeUrl = $state<string | null>(null);
  let bundle = $state<BundlePayload | null>(null);
  let error = $state<string | null>(null);
  let busy = $state(false);
  let refsToken = 0;
  let bundleToken = 0;

  const isCountry = $derived(family === "Country");
  const selName = $derived(router.name);

  const countryList = $derived.by(() => {
    const seen = new Map<string, number>();
    for (const c of index.image?.countries ?? []) seen.set(c.name, 1);
    for (const c of index.countries) {
      if (c.family === "iPhone") seen.set(c.id, (seen.get(c.id) ?? 0) + 1);
    }
    return [...seen]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, n]) => ({ name, display: name, versions: Array<string>(n).fill(""), cc: undefined as string | undefined, image: undefined as string | undefined }));
  });

  const source = $derived(
    isCountry ? countryList : (family === "Watch" ? index.watchCarriers : index.carriers),
  );

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return source;
    return source.filter((c: { name: string; display: string; cc?: string }) =>
      c.name.toLowerCase().includes(q) ||
      c.display.toLowerCase().includes(q) ||
      (c.cc ?? "").includes(q));
  });

  $effect(() => {
    const name = selName;
    const mine = ++refsToken;
    refs = [];
    cc = undefined;
    activeUrl = null;
    bundle = null;
    error = null;
    if (!name) return;

    if (isCountry) {
      api.country(name)
        .then((d) => {
          if (mine !== refsToken) return;
          refs = d.refs;
          activeUrl = d.refs[0]?.url ?? null;
        })
        .catch((e) => { if (mine === refsToken) error = String(e.message ?? e); });
      return;
    }

    api.carrier(name)
      .then((d) => {
        if (mine !== refsToken) return;
        refs = d.refs;
        cc = d.country.cc;
        // Default to the newest plain iPhone bundle rather than a per-model one.
        activeUrl = (d.refs.find((r) => !r.productType) ?? d.refs[0])?.url ?? null;
      })
      .catch((e) => { if (mine === refsToken) error = String(e.message ?? e); });
  });

  $effect(() => {
    const url = activeUrl;
    const mine = ++bundleToken;
    if (!url) { bundle = null; return; }
    busy = true;
    error = null;
    api.bundle(url, isCountry ? undefined : (selName ?? undefined))
      .then((b) => { if (mine === bundleToken) bundle = b; })
      .catch((e) => { if (mine === bundleToken) error = String(e.message ?? e); })
      .finally(() => { if (mine === bundleToken) busy = false; });
  });

  /** The manifest publishes the same file under several iOS keys; collapse them. */
  const refOptions = $derived.by(() => {
    const byUrl = new Map<string, { url: string; os: string[]; first: BundleRef }>();
    for (const r of refs) {
      const hit = byUrl.get(r.url);
      if (hit) {
        if (!hit.os.includes(r.os)) hit.os.push(r.os);
      } else {
        byUrl.set(r.url, { url: r.url, os: [r.os], first: r });
      }
    }
    return [...byUrl.values()].map((o) => ({ url: o.url, label: refLabel({ ...o.first, os: o.os.join(", ") }) }));
  });

  function pick(name: string) {
    router.go(router.view, name);
    drawerOpen = false;
  }

  function rowMenu(name: string) {
    return () => ({
      title: name,
      items: [
        { label: "Open", run: () => pick(name) },
        { label: "Copy bundle name", run: () => copyText(name) },
        { label: "Compare against this", run: () => { sessionStorage.setItem("compare.right", name); router.go("compare"); } },
      ],
    });
  }
</script>

<div class="split">
  <div class="pane-left" class:open={drawerOpen}>
    <div style="padding:6px; display:flex; gap:6px">
      <input class="grow" type="search" placeholder={isCountry ? "find a country" : "find a carrier"} bind:value={query} />
      <button class="btn drawer-btn" onclick={() => (drawerOpen = false)}>Close</button>
    </div>
    <div class="scroll" style="margin:0 6px 6px">
      <ul class="list" role="listbox" aria-label={isCountry ? "countries" : "carriers"}>
        {#each filtered as c (c.name)}
          <li role="option" aria-selected={c.name === selName}>
            <button type="button" onclick={() => pick(c.name)} use:menuTrigger={rowMenu(c.name)}>
              <span class="name">{c.display}</span>
              <span class="dim">{c.cc ? c.cc.toUpperCase() + " " : ""}{c.versions.length + (c.image ? 1 : 0)}</span>
            </button>
          </li>
        {:else}
          <li class="dimtext">nothing matches</li>
        {/each}
      </ul>
    </div>
    <div class="statusbar" style="padding:2px 6px 6px">
      <span class="cell grow">{filtered.length} of {source.length}</span>
    </div>
  </div>

  <div class="backdrop" class:open={drawerOpen} onclick={() => (drawerOpen = false)} role="presentation"></div>

  <div class="pane-right">
    {#if !selName}
      <div class="scroll pad">
        <h2 style="margin-top:0">
          {isCountry ? "Country bundles" : family === "Watch" ? "Apple Watch carrier bundles" : "Carrier bundles"}
        </h2>
        <p class="lead dimtext">
          {#if index.image}
            Bundles from the iOS {index.image.version} image, plus anything newer or older on Apple's asset
            server. Right-click a setting to compare it across bundles.
          {:else}
            Bundles from Apple's asset server. Right-click a setting to compare it across bundles.
          {/if}
        </p>
        <button class="btn drawer-btn" onclick={() => (drawerOpen = true)}>Open the list</button>
      </div>
    {:else}
      <div class="toolbar">
        <button class="btn drawer-btn" onclick={() => (drawerOpen = true)}>List</button>
        <b>{selName}</b>
        {#if cc}<span class="chip">{cc.toUpperCase()}</span>{/if}
        <span class="grow"></span>
        <label class="lbl">
          Version
          <select bind:value={activeUrl}>
            {#each refOptions as o (o.url)}
              <option value={o.url}>{o.label}</option>
            {/each}
          </select>
        </label>
      </div>
      {#if busy}<p class="pad dimtext">Fetching and decoding.</p>{/if}
      {#if error}<div class="banner err" style="margin:8px">{error}</div>{/if}
      {#if bundle && !busy}
        <BundleView {bundle} {cc} kind={isCountry ? "country" : "carrier"} />
      {/if}
      {#if !bundle && !busy && !error && refs.length === 0}
        <p class="pad dimtext">No published bundles for this entry.</p>
      {/if}
    {/if}
  </div>
</div>
