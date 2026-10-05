<script lang="ts">
  import { asset } from "$app/paths";
  import type { FileKind } from "@carrier-explode/decode-ios";

  /** A bundle file's icon from static/files; signatures are plists the bundle is signed with. */
  let { kind, path }: { kind: FileKind; path: string } = $props();

  const look = $derived(path.startsWith("signatures/") ? "signature" : kind === "pri-der" || kind === "pri-plain" || kind === "tri-der" ? "pri" : kind);
</script>

<img class="file-icon" src={asset(`files/${look}.svg`)} alt="" width="20" height="20" />
