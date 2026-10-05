/** 3GPP enumerations the band combination files index from 1. */

/** Bandwidth classes, by letter in 3GPP order. */
export const BANDWIDTH_CLASSES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q"] as const;
export type BandwidthClass = (typeof BANDWIDTH_CLASSES)[number];

/** maxNumberMIMO-LayersPDSCH. */
export const DL_MIMO_LAYERS = [2, 4, 8] as const;
