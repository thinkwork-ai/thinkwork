import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Shared selection-visibility treatment for every CodeMirror embed in the app
 * (THINK-296). With `drawSelection` on (the basic-setup default), the native
 * `::selection` path is dead — CodeMirror forces it transparent at
 * `Prec.highest` and paints a `.cm-selectionLayer` at negative z-index inside
 * `.cm-scroller` instead. Selection visibility therefore comes down to two
 * things this module and its consumers control:
 *
 * 1. The drawn `.cm-selectionBackground` bands must have a color that reads on
 *    the app's dark editor surfaces — defined once here, from theme tokens,
 *    with focused and (dimmer) unfocused arms. `Prec.high` + `!important`
 *    out-cascades vscodeDark's own `!important` selection colors.
 * 2. No embed may paint `.cm-content` with an opaque background — in-flow
 *    content backgrounds paint ABOVE the negative-z selection layer and hide
 *    it. Surface color belongs on `&` (the editor root) and `.cm-scroller`,
 *    whose own backgrounds paint below the layer.
 */
export const selectionHighlightSpec = {
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor:
      "color-mix(in oklab, var(--primary) 32%, transparent) !important",
  },
  ".cm-selectionBackground": {
    backgroundColor:
      "color-mix(in oklab, var(--primary) 20%, transparent) !important",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in oklab, var(--primary) 14%, transparent)",
  },
} as const;

export const editorSelectionHighlight = Prec.high(
  EditorView.theme(selectionHighlightSpec, { dark: true }),
);
