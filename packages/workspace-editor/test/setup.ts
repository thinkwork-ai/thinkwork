// Minimal jsdom stubs for @thinkwork/ui primitives (Radix + resizable panels)
// that observe layout. Component tests mock @uiw/react-codemirror, so no
// CodeMirror measurement happens here.

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver =
  globalThis.ResizeObserver ?? (ResizeObserverStub as typeof ResizeObserver);

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
