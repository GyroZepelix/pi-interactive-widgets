import { answer } from "./mod.js";
postMessage("module " + self.isSecureContext + " " + answer);
