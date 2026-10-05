<script lang="ts">
  import type { ModemConfig } from "@carrier-explode/schema/types";

  /** What a modem file's header states. */
  let { facts }: { facts: ModemConfig["facts"] } = $props();
</script>

{#if facts.length}
  <fieldset class="hgroup">
    <legend>Header</legend>
    <table class="grid">
      <tbody>
        {#each facts as f (f.label)}
          <!-- Versions, ids and digests are tokens; a phrase ("Qualcomm modem") reads as text. -->
          <tr><td class="k">{f.label}</td><td class:mono={!f.value.includes(" ")}>{f.value}</td></tr>
        {/each}
      </tbody>
    </table>
  </fieldset>
{/if}
