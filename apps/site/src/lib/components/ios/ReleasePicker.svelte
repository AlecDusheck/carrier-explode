<script lang="ts">
  import { getBuilds } from "#lib/api/builds.remote.ts";
  import { buildHref } from "#lib/format.ts";
  import type { ListedRelease } from "@carrier-explode/db";
  import BuildPicker from "../BuildPicker.svelte";

  let { release }: { release: ListedRelease } = $props();

  // Images with no modem packages extracted are left out.
  const builds = $derived((await getBuilds()).filter((b) => b.platform === "ios" && (b.modemFamilies.length > 0 || b.id === release.id)));
</script>

<BuildPicker label="iOS version" {builds} current={release.id} href={(b) => buildHref(b.platform, b.id)} />
