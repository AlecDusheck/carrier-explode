<script lang="ts">
  import type { SourceHead } from "#lib/server/head.ts";
  import ModelPicker from "./ModelPicker.svelte";

  /** A source's lines (Android's phones, Apple's models), each linking where `href` says. */
  let { head, href }: { head: SourceHead; href: (line: string) => string } = $props();
</script>

<ModelPicker phones={head.lines} selected={head.line} {href} />
