<script lang="ts">
  import type { ConfigFormats } from "@carrier-explode/decode-android";

  let { value }: { value: ConfigFormats["signal-levels"] } = $props();

  const LEVELS = ["none", "poor", "moderate", "good", "excellent"] as const;
  const bounds = $derived([value.min, ...value.thresholds, value.max]);
</script>

<div class="hscroll">
  <table class="grid fit decoded">
    <thead><tr><th>{value.measure}</th><th class="num">From</th><th class="num">Below</th></tr></thead>
    <tbody>
      {#each LEVELS as level, i (level)}
        <tr>
          <td>{level}</td>
          <td class="num">{bounds[i]} {value.unit}</td>
          <td class="num">{bounds[i + 1]} {value.unit}{i === LEVELS.length - 1 ? ", inclusive" : ""}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
