/**
 * Open a URL in a new browser TAB via a synthetic anchor click.
 *
 * Not window.open: passing any features string (even just "noopener")
 * makes Chrome treat the call as a popup request and spawn a separate
 * bare WINDOW — no tab strip, no URL bar. An anchor with target=_blank
 * honors the user's tab preference; rel keeps the opener detached.
 */
export function openInNewTab(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
