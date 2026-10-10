/** A modem configuration's settings on any platform: its sections, and a page of them at a time. */

import { query } from "$app/server";
import * as modem from "#lib/server/modem-config.ts";
import { modemItemsQuery, modemPageQuery } from "./schemas";

export const getModemSections = query(modemItemsQuery, modem.getModemSections);
export const getModemItems = query(modemPageQuery, modem.getModemItems);
