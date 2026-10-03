/** The iOS mapper: the one part of the schema that reads the iOS decoder's output. */

export { iosProfile } from "./profile.ts";
export { manifestSims, parseSupportedSim, type ManifestPlmnTable } from "./identity.ts";
export { IOS_READERS, type IosReader, type IosView } from "./readers.ts";
