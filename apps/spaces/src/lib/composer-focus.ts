export const SPACES_COMPOSER_FOCUS_EVENT = "thinkwork:focus-composer";

export function requestSpacesComposerFocus() {
  window.dispatchEvent(new CustomEvent(SPACES_COMPOSER_FOCUS_EVENT));
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(SPACES_COMPOSER_FOCUS_EVENT));
  }, 0);
}
