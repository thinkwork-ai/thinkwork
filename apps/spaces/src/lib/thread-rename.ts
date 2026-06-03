/**
 * Bridge between the thread `…` actions menu (ThreadDetailActions) and the
 * inline title editor (ThreadTitleInlineRename), which are sibling components
 * in the thread header. The "Rename thread" menu item dispatches this event;
 * the inline title editor for the matching thread enters edit mode.
 */
export const THREAD_RENAME_EVENT = "thinkwork:rename-thread";

export interface ThreadRenameEventDetail {
  threadId: string;
}
