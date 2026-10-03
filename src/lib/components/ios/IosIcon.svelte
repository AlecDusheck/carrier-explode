<script lang="ts">
  import { asset } from "$app/paths";

  /** Releases with a mark in static/ios (drawn after Apple's version icons); others get the plain tile. */
  const MARKS = ["13", "14", "15", "16", "17", "18", "26", "27"] as const;

  /** `version` as the site writes it: "27.0.1", "27.2 beta 2", "27.0" (an OTA's minimum). */
  let { version }: { version?: string } = $props();

  const major = $derived(MARKS.find((m) => m === version?.split(".")[0]));
</script>

<img class="ios-icon" src={asset(major ? `ios/${major}.svg` : "ios/ios.svg")} alt="" width="20" height="20" />
