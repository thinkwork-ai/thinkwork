import { compileAppletSource } from "./transform";

self.onmessage = (event: MessageEvent<{ source: string }>) => {
  const result = compileAppletSource(event.data.source);
  if (result.ok) {
    self.postMessage({ ok: true, compiledCode: result.code });
  } else {
    self.postMessage({ ok: false, error: result.error });
  }
};
