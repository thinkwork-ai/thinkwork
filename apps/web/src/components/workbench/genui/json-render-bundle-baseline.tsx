import { createRoot } from "react-dom/client";

export function JsonRenderBundleBaseline() {
  return (
    <section aria-label="Thread GenUI baseline bundle smoke">
      <h1>Thread GenUI baseline</h1>
      <p>Baseline React render path for the json-render adoption spike.</p>
    </section>
  );
}

const root = document.getElementById("root") ?? document.createElement("div");

if (!root.parentElement) {
  document.body.append(root);
}

createRoot(root).render(<JsonRenderBundleBaseline />);
