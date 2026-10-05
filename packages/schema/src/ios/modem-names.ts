/** How an iOS modem generation reads to a person. */

import { modemLabel } from "@carrier-explode/decode-ios";

/** "Qualcomm X80 · Mav25", "Apple C1", "Intel · ICE19": a label's name for the generation, else its vendor's, with the generation. */
export const iosModemName = (generation: string, label: string | undefined): string => modemLabel(generation, label);
