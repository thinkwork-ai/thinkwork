import React from "react";
import { View, Pressable, Platform } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { Text, Muted } from "./typography";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  width?: number | string;
  minWidth?: number;
  flex?: number;
  render?: (item: T, index: number) => React.ReactNode;
  align?: "left" | "center" | "right";
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (item: T, index: number) => string;
  onRowPress?: (item: T, index: number) => void;
  isLoading?: boolean;
  emptyMessage?: string;
  estimatedItemSize?: number;
  className?: string;
}

function TableHeaderCell({
  column,
}: {
  column: Column<any>;
}) {
  return (
    <View
      className={cn(
        "h-10 justify-center px-3",
        column.align === "right" && "items-end",
        column.align === "center" && "items-center"
      )}
      style={{
        flex: column.flex ?? 1,
        minWidth: column.minWidth,
        width: column.width,
      }}
    >
      <Text className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {column.header}
      </Text>
    </View>
  );
}

function TableRow<T>({
  item,
  index,
  columns,
  onPress,
}: {
  item: T;
  index: number;
  columns: Column<T>[];
  onPress?: () => void;
}) {
  const content = (
    <View className="flex-row items-center border-b border-neutral-200 dark:border-neutral-800" style={{ height: 45 }}>
      {columns.map((col) => (
        <View
          key={col.key}
          className={cn(
            "justify-center px-3",
            col.align === "right" && "items-end",
            col.align === "center" && "items-center"
          )}
          style={{
            flex: col.flex ?? 1,
            minWidth: col.minWidth,
            width: col.width,
            overflow: "hidden",
          }}
        >
          {col.render ? (
            col.render(item, index)
          ) : (
            <Text className="text-sm text-neutral-900 dark:text-neutral-100">
              {String((item as any)[col.key] ?? "")}
            </Text>
          )}
        </View>
      ))}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        className="active:bg-neutral-100 dark:active:bg-neutral-800"
        style={({ pressed }) => [
          Platform.OS === "web" && { cursor: "pointer" },
          pressed && { opacity: 0.7 },
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

function LoadingSkeleton() {
  return (
    <View className="p-4 gap-2">
      {[1, 2, 3].map((i) => (
        <View key={i} className="h-10 rounded-md bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
      ))}
    </View>
  );
}

export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  onRowPress,
  isLoading,
  emptyMessage = "No data available",
  estimatedItemSize = 48,
  className,
}: DataTableProps<T>) {
  const renderItem = React.useCallback(
    ({ item, index }: { item: T; index: number }) => (
      <TableRow
        item={item}
        index={index}
        columns={columns}
        onPress={onRowPress ? () => onRowPress(item, index) : undefined}
      />
    ),
    [columns, onRowPress]
  );

  if (isLoading) {
    return (
      <View className={cn("rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden", className)}>
        <LoadingSkeleton />
      </View>
    );
  }

  if (data.length === 0) {
    return (
      <View className={cn("rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden", className)}>
        <View className="py-12 items-center">
          <Muted>{emptyMessage}</Muted>
        </View>
      </View>
    );
  }

  return (
    <View className={cn(
      "rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden",
      "bg-white dark:bg-neutral-900",
      className
    )}>
      {/* Header */}
      <View className="flex-row border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50">
        {columns.map((col) => (
          <TableHeaderCell key={col.key} column={col} />
        ))}
      </View>

      {/* Body */}
      {Platform.OS === "web" ? (
        <View>
          {data.map((item, index) => (
            <TableRow
              key={keyExtractor(item, index)}
              item={item}
              index={index}
              columns={columns}
              onPress={onRowPress ? () => onRowPress(item, index) : undefined}
            />
          ))}
        </View>
      ) : (
        <FlashList
          data={data}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          estimatedItemSize={estimatedItemSize}
        />
      )}
    </View>
  );
}

// Simplified table for when you just need basic rendering
export function SimpleTable<T extends Record<string, any>>({
  data,
  columns,
  onRowPress,
  isLoading,
  emptyMessage,
  className,
}: Omit<DataTableProps<T>, "keyExtractor" | "estimatedItemSize"> & {
  keyExtractor?: (item: T, index: number) => string;
}) {
  return (
    <DataTable
      data={data}
      columns={columns}
      keyExtractor={(item, index) => (item as any)._id ?? (item as any).id ?? String(index)}
      onRowPress={onRowPress}
      isLoading={isLoading}
      emptyMessage={emptyMessage}
      className={className}
    />
  );
}
