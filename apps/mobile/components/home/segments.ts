export const HOME_SEGMENTS = [
  { key: "threads", label: "Threads" },
  { key: "work-items", label: "Work Items" },
  { key: "wiki", label: "Wiki" },
] as const;

export type HomeSegment = (typeof HOME_SEGMENTS)[number];
export type HomeSegmentKey = HomeSegment["key"];

export function isHomeSegmentKey(value: string): value is HomeSegmentKey {
  return HOME_SEGMENTS.some((segment) => segment.key === value);
}
