import React, { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Text } from '@/components/ui/typography';
import { ChevronRight, ChevronLeft } from 'lucide-react-native';

export const PAGE_SIZE = 5;

/** Lighten a hex color for dark mode readability */
function lightenHex(hex: string, amount = 0.3): string {
  const h = hex.replace('#', '');
  const r = Math.min(255, parseInt(h.substring(0, 2), 16) + Math.round(255 * amount));
  const g = Math.min(255, parseInt(h.substring(2, 4), 16) + Math.round(255 * amount));
  const b = Math.min(255, parseInt(h.substring(4, 6), 16) + Math.round(255 * amount));
  return `rgb(${r},${g},${b})`;
}

/** Derive a fallback color from stage name when no color is provided */
function inferStageColor(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.includes('new') || lower.includes('00-')) return '#3b82f6';
  if (lower.includes('prospect') || lower.includes('10-')) return '#8b5cf6';
  if (lower.includes('working') || lower.includes('10-')) return '#6366f1';
  if (lower.includes('account') || lower.includes('20-')) return '#0ea5e9';
  if (lower.includes('formulate') || lower.includes('30-')) return '#f59e0b';
  if (lower.includes('negotiat') || lower.includes('40-')) return '#0ea5e9';
  if (lower.includes('implement') || lower.includes('50-')) return '#22c55e';
  if (lower.includes('won') || lower.includes('closed')) return '#10b981';
  if (lower.includes('lost') || lower.includes('disqualif')) return '#ef4444';
  return null;
}

/** Colored badge for pipeline stages / statuses */
export function StageBadge({ name, color }: { name?: string; color?: string }) {
  if (!name) return null;
  const resolvedColor = color || inferStageColor(name);
  const textColor = resolvedColor ? lightenHex(resolvedColor, 0.25) : '#d1d5db';
  const borderColor = resolvedColor ? `${resolvedColor}40` : 'rgba(156,163,175,0.3)';
  return (
    <View
      className="self-start px-2 py-0.5 rounded-full mt-0.5"
      style={{
        backgroundColor: resolvedColor ? `${resolvedColor}15` : 'rgba(156,163,175,0.1)',
        borderWidth: 1,
        borderColor,
      }}
    >
      <Text size="xs" weight="medium" style={{ color: textColor }}>{name}</Text>
    </View>
  );
}

/** Priority badge with color mapping */
export function PriorityBadge({ priority }: { priority?: string }) {
  if (!priority) return null;
  const colors: Record<string, string> = {
    critical: '#ef4444', high: '#0ea5e9', medium: '#eab308', low: '#22c55e',
  };
  const color = colors[priority.toLowerCase()] || '#9ca3af';
  return (
    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${color}20` }}>
      <Text size="xs" weight="medium" style={{ color }}>{priority}</Text>
    </View>
  );
}

/** Formatted currency value */
export function CurrencyValue({ value }: { value?: number | null }) {
  if (value == null) return null;
  const formatted = `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  return <Text size="sm" weight="medium" className="text-emerald-600 dark:text-emerald-400">{formatted}</Text>;
}

/** Full name from firstName/lastName object */
export function personName(o?: { firstName?: string; lastName?: string } | null): string {
  return [o?.firstName, o?.lastName].filter(Boolean).join(' ') || '';
}

/** Pagination control */
export function Pager({ page, total, onPrev, onNext }: { page: number; total: number; onPrev: () => void; onNext: () => void }) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (totalPages <= 1) return null;
  return (
    <View className="flex-row items-center justify-between px-4 py-2">
      <Pressable onPress={onPrev} disabled={page === 0} style={{ opacity: page === 0 ? 0.3 : 1 }} hitSlop={8}>
        <View className="flex-row items-center gap-1">
          <ChevronLeft size={14} color="#9ca3af" />
          <Text size="xs" variant="muted">Previous</Text>
        </View>
      </Pressable>
      <Text size="xs" variant="muted">{page + 1} / {totalPages}</Text>
      <Pressable onPress={onNext} disabled={page >= totalPages - 1} style={{ opacity: page >= totalPages - 1 ? 0.3 : 1 }} hitSlop={8}>
        <View className="flex-row items-center gap-1">
          <Text size="xs" variant="muted">Next</Text>
          <ChevronRight size={14} color="#9ca3af" />
        </View>
      </Pressable>
    </View>
  );
}

/** Reusable pressable row with chevron */
export function EntityRow({ onPress, children }: { onPress?: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed && onPress ? 0.7 : 1 })}
      className="flex-row items-center py-3 px-4 border-b border-neutral-100 dark:border-neutral-700/50"
    >
      <View className="flex-1">{children}</View>
      <ChevronRight size={16} color="#9ca3af" />
    </Pressable>
  );
}

/** Hook for pagination state */
export function usePager() {
  const [page, setPage] = useState(0);
  return {
    page,
    prev: () => setPage((p) => Math.max(0, p - 1)),
    next: () => setPage((p) => p + 1),
    slice: <T,>(items: T[]) => items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
  };
}
