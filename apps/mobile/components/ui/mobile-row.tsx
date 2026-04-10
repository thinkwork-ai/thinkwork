import { View, Pressable, PressableProps } from "react-native";
import type { ReactNode } from "react";

interface MobileRowProps extends Omit<PressableProps, "children"> {
  /** Left content for line 1 (e.g., title, badges) */
  line1Left?: ReactNode;
  /** Right content for line 1 (e.g., status badge, time) */
  line1Right?: ReactNode;
  /** Left content for line 2 (e.g., description, metadata) */
  line2Left?: ReactNode;
  /** Right content for line 2 (optional) */
  line2Right?: ReactNode;
  /** Whether this is the last item (hides bottom border) */
  isLast?: boolean;
  /** Additional className for the container */
  className?: string;
}

/**
 * Standardized mobile row component for list items.
 * 
 * Structure:
 * - Two lines, each with left and right content
 * - All content on a line is vertically centered
 * - Left content is left justified, right content is right justified
 * 
 * Usage:
 * ```tsx
 * <MobileRow
 *   line1Left={<><Text>Title</Text><Badge>Tag</Badge></>}
 *   line1Right={<StatusBadge status="active" />}
 *   line2Left={<Muted>Description text</Muted>}
 *   line2Right={<Muted>2h ago</Muted>}
 *   onPress={() => navigate()}
 * />
 * ```
 */
export function MobileRow({
  line1Left,
  line1Right,
  line2Left,
  line2Right,
  isLast,
  className,
  disabled,
  ...pressableProps
}: MobileRowProps) {
  const hasLine2 = line2Left || line2Right;

  return (
    <Pressable
      disabled={disabled}
      className={`bg-white dark:bg-neutral-900 px-4 py-3 active:bg-neutral-50 dark:active:bg-neutral-800 ${
        isLast ? "" : "border-b border-neutral-200 dark:border-neutral-800"
      } ${className ?? ""}`}
      {...pressableProps}
    >
      {/* Line 1 */}
      <View className="flex-row items-center justify-between gap-2">
        {line1Left && (
          <View className="flex-row items-center gap-2 flex-1 flex-shrink min-w-0">
            {line1Left}
          </View>
        )}
        {line1Right && (
          <View className="flex-row items-center gap-2 flex-shrink-0">
            {line1Right}
          </View>
        )}
      </View>

      {/* Line 2 */}
      {hasLine2 && (
        <View className="flex-row items-center justify-between gap-2 mt-0.5">
          {line2Left && (
            <View className="flex-row items-center gap-2 flex-1 flex-shrink min-w-0">
              {line2Left}
            </View>
          )}
          {line2Right && (
            <View className="flex-row items-center gap-2 flex-shrink-0">
              {line2Right}
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}
