import { Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@thinkwork/ui";
import { CUSTOMIZE_TABS } from "@/routes/_authed/_shell/customize";

export const ALL_CATEGORIES = "__all__" as const;

export interface CustomizeToolbarProps {
  activeTab: (typeof CUSTOMIZE_TABS)[number]["to"];
  search: string;
  onSearchChange: (value: string) => void;
  category: string;
  categories: string[];
  onCategoryChange: (category: string) => void;
  searchPlaceholder?: string;
}

/**
 * Per-page toolbar shared across the three Customize tabs. Mirrors the
 * Memory module's centered-tabs toolbar pattern (see memory.brain.tsx
 * post the 60cc2f2e centering refactor):
 *
 *   - LEFT: search box
 *   - CENTER (absolutely positioned): the three Customize tab pills
 *   - RIGHT (ml-auto): the category dropdown
 *
 * Filter chips (Discover / All / Connected / Available) are deliberately
 * absent — the Connected/Available split lives in the section grouping
 * inside CustomizeCardGrid instead.
 */
export function CustomizeToolbar({
  activeTab,
  search,
  onSearchChange,
  category,
  categories,
  onCategoryChange,
  searchPlaceholder = "Search…",
}: CustomizeToolbarProps) {
  return (
    <div
      className="relative z-10 flex shrink-0 items-center gap-3 px-4 py-3"
      data-testid="customize-toolbar"
    >
      <div className="relative w-fit min-w-56 max-w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="pl-9"
          data-testid="customize-search"
        />
      </div>

      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="pointer-events-auto">
          <Tabs value={activeTab}>
            <TabsList data-testid="customize-tabs">
              {CUSTOMIZE_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.to}
                  value={tab.to}
                  asChild
                  className="px-3 text-xs"
                >
                  <Link to={tab.to}>{tab.label}</Link>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      <Select value={category} onValueChange={onCategoryChange}>
        <SelectTrigger
          className="ml-auto h-8 min-w-[10rem]"
          data-testid="customize-category"
        >
          <SelectValue placeholder="All categories" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
          {categories.map((cat) => (
            <SelectItem key={cat} value={cat}>
              {cat}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
