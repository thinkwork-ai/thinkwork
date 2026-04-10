import { Link } from "@tanstack/react-router";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: {
    direction: "up" | "down";
    value: string;
  };
  subtitle?: string;
  className?: string;
  href?: string;
  icon?: React.ReactNode;
}

export function MetricCard({
  label,
  value,
  trend,
  subtitle,
  className,
  href,
  icon,
}: MetricCardProps) {
  const card = (
    <Card className={cn("@container/card", href && "hover:bg-accent/50 transition-colors cursor-pointer", className)}>
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">{icon}{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {value}
        </CardTitle>
        {trend && (
          <CardAction>
            <Badge variant="outline" className="gap-1">
              {trend.direction === "up" ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {trend.value}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      {subtitle && (
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="text-muted-foreground">{subtitle}</div>
        </CardFooter>
      )}
    </Card>
  );

  if (href) {
    return <Link to={href}>{card}</Link>;
  }
  return card;
}
