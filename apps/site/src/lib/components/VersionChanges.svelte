<script lang="ts" generics="C extends { readonly a: unknown }">
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import { getSourceHead } from "#lib/api/sources.remote.ts";
  import { verArgs } from "#lib/format.ts";
  import type { At } from "#lib/types.ts";
  import ChangesHeader from "./ChangesHeader.svelte";
  import Pane from "./Pane.svelte";

  type Against = ReturnType<typeof verArgs> & { against?: string };

  /** A version against an earlier one on its line: `changes` fetches the two, `diff` draws them. */
  let { at, changes, diff }: { at: At; changes: (args: Against) => Promise<C>; diff: Snippet<[C]> } = $props();

  const against = $derived(page.url.searchParams.get("against"));
  const head = $derived(await getSourceHead(verArgs(at)));
  const chosen = $derived(against ?? head.previous?.slug ?? "");
</script>

<ChangesHeader {at} {head} {chosen} other="source" file={null} />

<Pane awaiting={{ kind: "diff", name: at.version }}>
  {@const c = await changes({ ...verArgs(at), ...(against ? { against } : {}) })}
  {#if !c.a}
    <p class="dimtext">Nothing older to compare against.</p>
  {:else}
    {@render diff(c)}
  {/if}
</Pane>
