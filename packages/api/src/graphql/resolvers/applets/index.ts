import { applet } from "./applet.query.js";
import { applets } from "./applets.query.js";
import { appletState } from "./appletState.query.js";
import { regenerateApplet } from "./regenerateApplet.mutation.js";
import { saveApplet } from "./saveApplet.mutation.js";
import { saveAppletState } from "./saveAppletState.mutation.js";

export const appletQueries = { applet, applets, appletState };
export const appletMutations = { saveApplet, regenerateApplet, saveAppletState };
