<script lang="ts">
  import type { SourceHead } from "#lib/server/head.ts";
  import PhonePicker from "./PhonePicker.svelte";

  /** A source's lines (Android's Pixels, Apple's models), each linking where `href` says. */
  let { head, href }: { head: SourceHead; href: (line: string | null) => string } = $props();
</script>

<PhonePicker
  platform={head.ref.platform}
  choices={head.lines.map((l) => ({ key: l.id ?? "", label: l.name, id: l.id ?? undefined, name: l.name, href: href(l.id) }))}
  selected={head.line ?? ""}
/>
