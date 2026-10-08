<script lang="ts">
  import { page } from "$app/state";
  import { withParams } from "#lib/format.ts";
  import { fileChoices, pickPhoneRow, rowKey } from "#lib/apple/phones.ts";
  import type { At } from "#lib/types.ts";
  import type { Tab } from "../../../params.ts";
  import PhonePicker from "../PhonePicker.svelte";
  import { tabPhoneRows } from "./phone-rows.ts";

  /** The phone whose override file a per-phone tab shows; choosing one drops what was open inside the old file. */
  let { at, tab }: { at: At; tab: Tab } = $props();

  const rows = $derived(await tabPhoneRows(at, tab));
  const picked = $derived(pickPhoneRow(rows, page.url.searchParams.get("file")));
</script>

<PhonePicker
  platform={at.ref.platform}
  choices={fileChoices(rows, (file) => withParams(page.url, { file, pri: null, efs: null, base: null }))}
  selected={picked.row && rowKey(picked.row)}
/>
