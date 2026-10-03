<script lang="ts">
  import { asset } from "$app/paths";

  /** Releases with a mark in static/android; others get the plain tile. */
  const MARKS = ["14", "15", "16"] as const;

  /** `version` as a release names it: "16", "16 QPR2". */
  let { version }: { version?: string | undefined } = $props();

  const major = $derived(MARKS.find((m) => m === version?.split(/[ .]/)[0]));
</script>

<img class="ios-icon" src={asset(major ? `android/${major}.svg` : "android/android.svg")} alt="" width="20" height="20" />
