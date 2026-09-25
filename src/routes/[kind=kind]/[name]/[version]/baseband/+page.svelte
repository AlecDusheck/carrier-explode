<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { getBundle, getFile } from "$lib/api/bundles.remote";
  import { bundleArgs, rawHref, withParams } from "$lib/format";
  import Pane from "$lib/components/Pane.svelte";
  import FileBody from "$lib/components/FileBody.svelte";
  import ModemDefaults from "$lib/components/ModemDefaults.svelte";

  let { params } = $props();

  const wanted = $derived(page.url.searchParams.get("file"));
  const pick = (file: string) =>
    goto(withParams(page.url, { file, efs: null, base: null }), { replaceState: true, keepFocus: true, noScroll: true });
</script>

<div class="scroll pad">
  <Pane>
    {@const bundle = await getBundle(bundleArgs(params))}
    <!-- Binary overrides first: they are the reason this tab exists. -->
    {@const files = bundle.info.files
      .filter((f) => f.kind === "pri-der" || f.kind === "pri-plain")
      .sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === "pri-der" ? -1 : 1))}
    {@const path = files.find((f) => f.path === wanted)?.path ?? files[0]?.path}

    {#if path}
      <div class="rowflex" style="margin-bottom:8px">
        <label class="lbl grow">
          File
          <select class="grow" name="file" value={path} onchange={(e) => pick(e.currentTarget.value)}>
            {#each files as f (f.path)}
              <option value={f.path}>{f.path}{f.devices?.length ? " - " + f.devices.map((d) => d.name ?? d.code).join(", ") : ""}</option>
            {/each}
          </select>
        </label>
      </div>
      <FileBody
        file={await getFile({ ...params, slug: params.version, path })}
        cc={bundle.cc}
        raw={rawHref(params.kind, params.name, params.version, path)}
        devices={false}
      />
    {:else}
      <p class="dimtext" style="margin:0">No baseband files.</p>
    {/if}
  </Pane>
  {#if params.kind === "carriers"}<ModemDefaults kind={params.kind} name={params.name} slug={params.version} />{/if}
</div>
