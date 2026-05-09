import { applet } from "./applet.query.js";
import { appletState } from "./appletState.query.js";
import { saveApplet } from "./saveApplet.mutation.js";
import { saveAppletState } from "./saveAppletState.mutation.js";

export const appletQueries = { applet, appletState };
export const appletMutations = { saveApplet, saveAppletState };
