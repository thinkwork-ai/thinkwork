import React from "react";
import Svg, { Circle, Path } from "react-native-svg";
import { WorkItemStatusCategory } from "@/lib/gql/graphql";

interface WorkItemStatusIconProps {
  category: WorkItemStatusCategory;
  color: string;
  size?: number;
}

/**
 * Small circular progress-style glyph communicating work item status by
 * shape + color, matching the Threads/Wiki leading-icon family:
 *  - TODO: empty outlined circle
 *  - ACTIVE: half-filled circle (in progress)
 *  - BLOCKED: thick outlined circle (stalled)
 *  - DONE: fully filled circle
 *  - SKIPPED: dashed outline (muted, opted out)
 */
export function WorkItemStatusIcon({
  category,
  color,
  size = 20,
}: WorkItemStatusIconProps) {
  const r = size / 2 - 1.5;
  const cx = size / 2;
  const cy = size / 2;

  switch (category) {
    case WorkItemStatusCategory.Done:
      return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle cx={cx} cy={cy} r={r} fill={color} />
        </Svg>
      );
    case WorkItemStatusCategory.Active:
      return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={color}
            strokeWidth={1.5}
            fill="none"
          />
          <Path
            d={`M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r} Z`}
            fill={color}
          />
        </Svg>
      );
    case WorkItemStatusCategory.Blocked:
      return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={color}
            strokeWidth={2.5}
            fill="none"
          />
        </Svg>
      );
    case WorkItemStatusCategory.Skipped:
      return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={color}
            strokeWidth={1.5}
            fill="none"
            strokeDasharray="2,2"
          />
        </Svg>
      );
    case WorkItemStatusCategory.Todo:
    default:
      return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={color}
            strokeWidth={1.5}
            fill="none"
          />
        </Svg>
      );
  }
}
