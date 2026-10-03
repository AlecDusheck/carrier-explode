<script lang="ts">
  import { link } from "#lib/format.ts";
  import { sourcePath } from "#lib/schema/types.ts";
  import type { BundleHead } from "#lib/server/head.ts";
  import PhonePicker from "./PhonePicker.svelte";

  /** A source's device lines (Android's Pixels): picking one opens the same tab at that device's newest version. */
  let { head, tab }: { head: BundleHead; tab: string } = $props();

  const href = (line: string): string => link(`${sourcePath(head.ref)}/${encodeURIComponent(line)}${tab ? `/${tab}` : ""}`);
</script>

<PhonePicker platform={head.ref.platform} choices={head.lines.map((l) => ({ key: l.id, label: l.name, id: l.id, name: l.name, href: href(l.id) }))} selected={head.line} />
