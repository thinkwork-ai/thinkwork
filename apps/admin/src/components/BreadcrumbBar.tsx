import { Fragment, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { cn } from "@/lib/utils";

export function BreadcrumbBar() {
  const { breadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const [popoverOpen, setPopoverOpen] = useState(false);

  if (breadcrumbs.length === 0) {
    return <div className="flex items-center flex-1 min-w-0" />;
  }

  // Single breadcrumb = page title
  if (breadcrumbs.length === 1) {
    return (
      <div className="flex items-center flex-1 min-w-0">
        <h1 className="text-xs font-medium tracking-wider text-muted-foreground truncate">
          {breadcrumbs[0].label}
        </h1>
      </div>
    );
  }

  // Multiple breadcrumbs = trail with separators
  return (
    <div className="flex items-center flex-1 min-w-0 overflow-hidden">
      <nav className="flex items-center gap-1 text-xs font-medium text-muted-foreground min-w-0 overflow-hidden">
        {breadcrumbs.map((crumb, i) => {
          const isLast = i === breadcrumbs.length - 1;
          return (
            <Fragment key={i}>
              {i > 0 && (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
              )}
              {crumb.popoverItems && crumb.popoverItems.length > 0 ? (
                <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "flex items-center gap-0.5 hover:text-foreground transition-colors",
                        isLast ? "text-foreground" : "",
                      )}
                    >
                      {crumb.label}
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-44 p-0">
                    <div className="max-h-52 overflow-y-auto py-1">
                      {crumb.popoverItems.map((item) => (
                        <button
                          type="button"
                          key={item.href}
                          className={cn(
                            "flex w-full items-center px-2.5 py-1.5 text-sm hover:bg-accent/50",
                            item.label === crumb.label && "bg-accent text-accent-foreground",
                          )}
                          onClick={() => {
                            setPopoverOpen(false);
                            navigate({ to: item.href });
                          }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : isLast || !crumb.href ? (
                <span
                  className={
                    isLast
                      ? "truncate text-foreground"
                      : "shrink-0 truncate"
                  }
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  to={crumb.href}
                  className="shrink-0 hover:text-foreground transition-colors"
                >
                  {crumb.label}
                </Link>
              )}
            </Fragment>
          );
        })}
      </nav>
    </div>
  );
}
