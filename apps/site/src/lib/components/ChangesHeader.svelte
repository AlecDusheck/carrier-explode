<script lang="ts">
  import { page } from "$app/state";
  import { compareHref, withParams } from "#lib/format.ts";
  import type { SourceHead } from "#lib/server/head.ts";
  import type { At } from "#lib/types.ts";
  import VersionPicker from "./VersionPicker.svelte";

  /** The version a Changes tab compares against, and the same two versions on /compare, there narrowed to `file`. */
  let { at, head, chosen, other, file }: { at: At; head: SourceHead; chosen: string; other: string; file: string | null } = $props();
</script>

<div class="rowflex">
  <VersionPicker
    label="Compare against"
    timeline={head.timeline.filter((t) => t.slug !== at.version)}
    current={chosen}
    shipping={head.current}
    href={(slug) => withParams(page.url, { against: slug === head.previous?.slug ? null : slug })}
  />
  <a href={compareHref({ source: at.ref, slug: chosen || undefined, line: at.line }, { source: at.ref, slug: at.version, line: at.line }, file)}>Compare with another {other}…</a>
</div>
