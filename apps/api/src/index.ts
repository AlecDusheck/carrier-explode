/** The Worker: the public API, and the purge the extractor calls after a publish. */

import { api } from "./api.ts";
import { purge } from "./purge.ts";

export default api.route("/", purge);
