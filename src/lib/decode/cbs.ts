/** Cell-broadcast message identifiers: what each 3GPP range carries. */

/** Cross-reference for cell-broadcast message identifiers. 3GPP TS 23.041 9.4.1.2.2 */
export const CBS_MESSAGE_IDS: Array<{ from: number; to: number; label: string }> = [
  { from: 4352, to: 4352, label: "ETWS earthquake warning" },
  { from: 4353, to: 4353, label: "ETWS tsunami warning" },
  { from: 4354, to: 4354, label: "ETWS earthquake and tsunami warning" },
  { from: 4355, to: 4355, label: "ETWS test message" },
  { from: 4356, to: 4356, label: "ETWS other emergency" },
  { from: 4370, to: 4370, label: "Presidential-level alert (CMAS class 1)" },
  { from: 4371, to: 4372, label: "Extreme threat, observed/likely" },
  { from: 4373, to: 4378, label: "Severe threat" },
  { from: 4379, to: 4379, label: "Child abduction (AMBER)" },
  { from: 4380, to: 4380, label: "Required monthly test" },
  { from: 4381, to: 4381, label: "CMAS exercise" },
  { from: 4382, to: 4382, label: "Operator-defined use" },
  { from: 4383, to: 4383, label: "Presidential-level alert (additional language)" },
  { from: 4384, to: 4391, label: "Extreme/severe threat (additional language)" },
  { from: 4392, to: 4392, label: "Child abduction (additional language)" },
  { from: 4393, to: 4393, label: "Required monthly test (additional language)" },
  { from: 4394, to: 4394, label: "CMAS exercise (additional language)" },
  { from: 4395, to: 4395, label: "Operator-defined use (additional language)" },
  { from: 4396, to: 4397, label: "Public safety message" },
  { from: 4398, to: 4399, label: "State/local test" },
  { from: 4400, to: 4400, label: "Geofence trigger message (not user-visible)" },
];

/** The alert a message identifier belongs to. */
export function describeMessageId(id: number): string | undefined {
  for (const r of CBS_MESSAGE_IDS) if (id >= r.from && id <= r.to) return r.label;
  return undefined;
}
