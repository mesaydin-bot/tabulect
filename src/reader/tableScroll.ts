/** Table body scroll helpers. Keep document-flow rows; never snap on fill. */

export const FOLLOW_BOTTOM_PX = 72;

export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  px = FOLLOW_BOTTOM_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= px;
}

/** Scroll the selected row only when the user (or open/nav) changes selection, not when rows grow. */
export function shouldScrollSelectedRow(
  prevSelectedId: string | null,
  nextSelectedId: string | null,
  prevDocumentId?: string | null,
  nextDocumentId?: string | null,
): boolean {
  if (!nextSelectedId) return false;
  return prevSelectedId !== nextSelectedId || prevDocumentId !== nextDocumentId;
}

/** Stick to newly appended rows only while the user is already at the bottom. */
export function shouldStickToEnd(rowCountGrew: boolean, following: boolean): boolean {
  return rowCountGrew && following;
}

/** Adjust only the table pane, not ancestor scrollers (avoids window jump). */
export function scrollChildIntoNearest(pane: HTMLElement, child: HTMLElement): void {
  const paneRect = pane.getBoundingClientRect();
  const rowRect = child.getBoundingClientRect();
  if (rowRect.top < paneRect.top) {
    pane.scrollTop -= paneRect.top - rowRect.top;
  } else if (rowRect.bottom > paneRect.bottom) {
    pane.scrollTop += rowRect.bottom - paneRect.bottom;
  }
}
