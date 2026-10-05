<script lang="ts">
  import { asset } from "$app/paths";
  import type { Platform } from "@carrier-explode/schema/types";
  import { VERSION_MARKS } from "#lib/platforms.ts";

  /** `version` as the site writes it: "27.0.1", "27.2 beta 2", "16 QPR2". */
  let { platform, version }: { platform: Platform; version?: string | undefined } = $props();
</script>

<img class="ios-icon" src={asset(VERSION_MARKS[platform](version))} alt="" width="20" height="20" />
