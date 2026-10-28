importScripts("./worker-dep.js");
postMessage("classic " + self.isSecureContext + " " + self.DEP);
