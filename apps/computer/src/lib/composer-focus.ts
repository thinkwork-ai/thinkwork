export const COMPUTER_COMPOSER_FOCUS_EVENT = "thinkwork:focus-composer";

export function requestComputerComposerFocus() {
  window.dispatchEvent(new CustomEvent(COMPUTER_COMPOSER_FOCUS_EVENT));
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(COMPUTER_COMPOSER_FOCUS_EVENT));
  }, 0);
}
