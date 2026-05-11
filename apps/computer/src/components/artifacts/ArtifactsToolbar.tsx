import { Search } from "lucide-react";
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
import {
  ALL_KINDS,
  SORT_GENERATED,
  SORT_NAME,
  TAB_ALL,
  type ArtifactSortBy,
} from "./artifacts-filtering";

export const ARTIFACT_TABS = [
  { value: TAB_ALL, label: "All" },
  { value: "applet", label: "Apps" },
] as const;

export type ArtifactTabValue = (typeof ARTIFACT_TABS)[number]["value"];

export interface ArtifactsToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  tab: string;
  onTabChange: (value: string) => void;
  kind: string;
  kinds: string[];
  onKindChange: (value: string) => void;
  sortBy: ArtifactSortBy;
  onSortByChange: (value: ArtifactSortBy) => void;
  searchPlaceholder?: string;
}

// Tabs are in-page state (not route children like Customize) because
// Artifacts has only the `applet` kind today — promote to routes when a
// second kind ships and each tab needs distinct data fetching.
export function ArtifactsToolbar({
  search,
  onSearchChange,
  tab,
  onTabChange,
  kind,
  kinds,
  onKindChange,
  sortBy,
  onSortByChange,
  searchPlaceholder = "Search artifacts…",
}: ArtifactsToolbarProps) {
  return (
    <div
      className="relative z-10 flex shrink-0 items-center gap-3 px-4 py-3"
      data-testid="artifacts-toolbar"
    >
      <div className="relative w-fit min-w-56 max-w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="pl-9"
          data-testid="artifacts-search"
        />
      </div>

      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="pointer-events-auto">
          <Tabs value={tab} onValueChange={onTabChange}>
            <TabsList data-testid="artifacts-tabs">
              {ARTIFACT_TABS.map((entry) => (
                <TabsTrigger
                  key={entry.value}
                  value={entry.value}
                  className="px-3 text-xs"
                >
                  {entry.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      <Select
        value={sortBy}
        onValueChange={(value) => onSortByChange(value as ArtifactSortBy)}
      >
        <SelectTrigger
          className="ml-auto h-8 min-w-[10rem]"
          data-testid="artifacts-sort"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SORT_GENERATED}>Generated (newest)</SelectItem>
          <SelectItem value={SORT_NAME}>Name (A–Z)</SelectItem>
        </SelectContent>
      </Select>

      <Select value={kind} onValueChange={onKindChange}>
        <SelectTrigger
          className="h-8 min-w-[10rem]"
          data-testid="artifacts-kind"
        >
          <SelectValue placeholder="All kinds" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_KINDS}>All kinds</SelectItem>
          {kinds.map((k) => (
            <SelectItem key={k} value={k}>
              {k}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
