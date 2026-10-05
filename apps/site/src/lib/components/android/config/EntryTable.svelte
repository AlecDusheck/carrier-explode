<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import type { Entry } from "@carrier-explode/decode-android";
  import NotUnderstood from "../../values/NotUnderstood.svelte";

  /** A list value, one row per entry in order; an entry the platform would drop shows as written. */
  let { entries, head, row }: { entries: readonly Entry<T>[]; head: readonly string[]; row: Snippet<[T]> } = $props();
</script>

<div class="hscroll">
  <table class="grid fit decoded">
    <thead><tr><th class="num">#</th>{#each head as h (h)}<th>{h}</th>{/each}</tr></thead>
    <tbody>
      {#each entries as e, i (i)}
        <tr>
          <td class="num">{i + 1}</td>
          {#if e.ok}
            {@render row(e.value)}
          {:else}
            <td colspan={head.length}><span class="mono breakall">{e.text}</span><NotUnderstood reason={e.reason} /></td>
          {/if}
        </tr>
      {:else}
        <tr><td colspan={head.length + 1} class="dimtext">empty</td></tr>
      {/each}
    </tbody>
  </table>
</div>
