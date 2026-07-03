import { useState, type ReactNode } from "react";
import type { BaseComponentProps } from "@json-render/react";
import {
  useBoundProp,
  useFieldValidation,
  useStateBinding,
} from "@json-render/react";
import type { ThreadJsonRenderPrimitiveProps } from "@thinkwork/thread-json-render";

import { Button as BaseButton } from "@base-ui/react/button";
import { Input as BaseInput } from "@base-ui/react/input";
import { Checkbox } from "@base-ui/react/checkbox";
import { Switch } from "@base-ui/react/switch";
import { Slider } from "@base-ui/react/slider";
import { Progress } from "@base-ui/react/progress";
import { Separator as BaseSeparator } from "@base-ui/react/separator";
import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import { Tabs } from "@base-ui/react/tabs";
import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Radio } from "@base-ui/react/radio";
import { Select } from "@base-ui/react/select";
import { Collapsible } from "@base-ui/react/collapsible";
import { Accordion } from "@base-ui/react/accordion";
import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import { Menu } from "@base-ui/react/menu";

import { cn } from "@/lib/utils";

/**
 * ThinkWork-owned GenUI primitive implementations (THINK-116, D4 / U10).
 *
 * These replace the Radix-based `@json-render/shadcn` `shadcnComponents` map.
 * Interactive primitives are built on `@base-ui/react`; layout/typography/
 * display primitives — which have no Base UI counterpart — are styled semantic
 * HTML matching the app's design tokens (`bg-card`, `text-foreground`,
 * `border-border`, `text-muted-foreground`, …) so they read consistently with
 * the U3 table + U4 charts. The component type names and prop shapes match the
 * catalog definitions exactly (schema-compatible), so previously-persisted
 * specs render unchanged.
 *
 * Every component is partial-frame tolerant (KTD7): during streaming a prop or
 * child array may not have arrived yet, so we guard missing values and never
 * throw. `emit`/`on`/`bindings` come straight from json-render 0.19's component
 * context; form inputs preserve the `$bindState` two-way binding + validation
 * behavior via the same `@json-render/react` hooks the shadcn layer used.
 */

type P<K extends keyof ThreadJsonRenderPrimitiveComponentPropsMap> =
  BaseComponentProps<ThreadJsonRenderPrimitiveComponentPropsMap[K]>;

type ThreadJsonRenderPrimitiveComponentPropsMap = {
  Card: ThreadJsonRenderPrimitiveProps<"Card">;
  Stack: ThreadJsonRenderPrimitiveProps<"Stack">;
  Grid: ThreadJsonRenderPrimitiveProps<"Grid">;
  Separator: ThreadJsonRenderPrimitiveProps<"Separator">;
  Tabs: ThreadJsonRenderPrimitiveProps<"Tabs">;
  Accordion: ThreadJsonRenderPrimitiveProps<"Accordion">;
  Collapsible: ThreadJsonRenderPrimitiveProps<"Collapsible">;
  Dialog: ThreadJsonRenderPrimitiveProps<"Dialog">;
  Drawer: ThreadJsonRenderPrimitiveProps<"Drawer">;
  Carousel: ThreadJsonRenderPrimitiveProps<"Carousel">;
  Table: ThreadJsonRenderPrimitiveProps<"Table">;
  Heading: ThreadJsonRenderPrimitiveProps<"Heading">;
  Text: ThreadJsonRenderPrimitiveProps<"Text">;
  Image: ThreadJsonRenderPrimitiveProps<"Image">;
  Avatar: ThreadJsonRenderPrimitiveProps<"Avatar">;
  Badge: ThreadJsonRenderPrimitiveProps<"Badge">;
  Alert: ThreadJsonRenderPrimitiveProps<"Alert">;
  Progress: ThreadJsonRenderPrimitiveProps<"Progress">;
  Skeleton: ThreadJsonRenderPrimitiveProps<"Skeleton">;
  Spinner: ThreadJsonRenderPrimitiveProps<"Spinner">;
  Tooltip: ThreadJsonRenderPrimitiveProps<"Tooltip">;
  Popover: ThreadJsonRenderPrimitiveProps<"Popover">;
  Input: ThreadJsonRenderPrimitiveProps<"Input">;
  Textarea: ThreadJsonRenderPrimitiveProps<"Textarea">;
  Select: ThreadJsonRenderPrimitiveProps<"Select">;
  Checkbox: ThreadJsonRenderPrimitiveProps<"Checkbox">;
  Radio: ThreadJsonRenderPrimitiveProps<"Radio">;
  Switch: ThreadJsonRenderPrimitiveProps<"Switch">;
  Slider: ThreadJsonRenderPrimitiveProps<"Slider">;
  Button: ThreadJsonRenderPrimitiveProps<"Button">;
  Link: ThreadJsonRenderPrimitiveProps<"Link">;
  DropdownMenu: ThreadJsonRenderPrimitiveProps<"DropdownMenu">;
  Toggle: ThreadJsonRenderPrimitiveProps<"Toggle">;
  ToggleGroup: ThreadJsonRenderPrimitiveProps<"ToggleGroup">;
  ButtonGroup: ThreadJsonRenderPrimitiveProps<"ButtonGroup">;
  Pagination: ThreadJsonRenderPrimitiveProps<"Pagination">;
};

// ── Shared token-styled fragments ─────────────────────────────────────────

const inputClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const labelClass = "text-sm font-medium text-foreground";

const fieldErrorClass = "text-sm text-destructive";

function buttonClasses(
  variant: "primary" | "secondary" | "danger" | "outline",
): string {
  const base =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
  const byVariant: Record<string, string> = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    danger: "bg-destructive text-white hover:bg-destructive/90",
    outline:
      "border border-border bg-background hover:bg-accent hover:text-accent-foreground",
  };
  return cn(base, byVariant[variant] ?? byVariant.primary);
}

// ── Layout ────────────────────────────────────────────────────────────────

const Card = ({ props, children }: P<"Card">) => {
  const maxWidthClass =
    props?.maxWidth === "sm"
      ? "max-w-xs sm:min-w-[280px]"
      : props?.maxWidth === "md"
        ? "max-w-sm sm:min-w-[320px]"
        : props?.maxWidth === "lg"
          ? "max-w-md sm:min-w-[360px]"
          : "w-full";
  const hasHeader = Boolean(props?.title || props?.description);
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-card text-card-foreground shadow-sm",
        maxWidthClass,
        props?.centered ? "mx-auto" : "",
        props?.className,
      )}
    >
      {hasHeader ? (
        <div className="flex flex-col gap-1 border-b border-border/60 px-4 py-3">
          {props?.title ? (
            <h3 className="text-sm font-semibold leading-5 text-foreground">
              {props.title}
            </h3>
          ) : null}
          {props?.description ? (
            <p className="text-sm text-muted-foreground">{props.description}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </div>
  );
};

const Stack = ({ props, children }: P<"Stack">) => {
  const isHorizontal = props?.direction === "horizontal";
  const gapMap: Record<string, string> = {
    none: "gap-0",
    sm: "gap-2",
    md: "gap-3",
    lg: "gap-4",
    xl: "gap-6",
  };
  const alignMap: Record<string, string> = {
    start: "items-start",
    center: "items-center",
    end: "items-end",
    stretch: "items-stretch",
  };
  const justifyMap: Record<string, string> = {
    start: "",
    center: "justify-center",
    end: "justify-end",
    between: "justify-between",
    around: "justify-around",
  };
  return (
    <div
      className={cn(
        "flex",
        isHorizontal ? "flex-row flex-wrap" : "flex-col",
        gapMap[props?.gap ?? "md"] ?? "gap-3",
        alignMap[props?.align ?? "start"] ?? "items-start",
        justifyMap[props?.justify ?? "start"] ?? "",
        props?.className,
      )}
    >
      {children}
    </div>
  );
};

const Grid = ({ props, children }: P<"Grid">) => {
  const colsMap: Record<number, string> = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
    5: "grid-cols-5",
    6: "grid-cols-6",
  };
  const gridGapMap: Record<string, string> = {
    sm: "gap-2",
    md: "gap-3",
    lg: "gap-4",
    xl: "gap-6",
  };
  const n = Math.max(1, Math.min(6, props?.columns ?? 1));
  return (
    <div
      className={cn(
        "grid",
        colsMap[n] ?? "grid-cols-1",
        gridGapMap[props?.gap ?? "md"] ?? "gap-3",
        props?.className,
      )}
    >
      {children}
    </div>
  );
};

const Separator = ({ props }: P<"Separator">) => (
  <BaseSeparator
    orientation={props?.orientation ?? "horizontal"}
    className={cn(
      "shrink-0 bg-border",
      props?.orientation === "vertical" ? "mx-2 h-full w-px" : "my-3 h-px w-full",
    )}
  />
);

const TabsComponent = ({ props, children, bindings, emit }: P<"Tabs">) => {
  const tabs = props?.tabs ?? [];
  const [boundValue, setBoundValue] = useBoundProp(
    props?.value,
    bindings?.value,
  );
  const [localValue, setLocalValue] = useState(
    props?.defaultValue ?? tabs[0]?.value ?? "",
  );
  const isBound = !!bindings?.value;
  const value = isBound ? (boundValue ?? tabs[0]?.value ?? "") : localValue;
  const setValue = isBound ? setBoundValue : setLocalValue;
  return (
    <Tabs.Root
      value={value}
      onValueChange={(next) => {
        setValue(next as string);
        emit("change");
      }}
    >
      <Tabs.List className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 p-1">
        {tabs.map((tab) => (
          <Tabs.Tab
            key={tab.value}
            value={tab.value}
            className="rounded px-3 py-1 text-sm text-muted-foreground outline-none transition-colors data-[selected]:bg-background data-[selected]:text-foreground data-[selected]:shadow-sm"
          >
            {tab.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      <div className="pt-3">{children}</div>
    </Tabs.Root>
  );
};

const AccordionComponent = ({ props }: P<"Accordion">) => {
  const items = props?.items ?? [];
  return (
    <Accordion.Root
      multiple={props?.type === "multiple"}
      className="w-full divide-y divide-border rounded-md border border-border"
    >
      {items.map((item, i) => (
        <Accordion.Item key={i} value={`item-${i}`} className="px-4">
          <Accordion.Header>
            <Accordion.Trigger className="flex w-full items-center justify-between py-3 text-left text-sm font-medium text-foreground outline-none">
              {item.title}
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel className="pb-3 text-sm text-muted-foreground">
            {item.content}
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
};

const CollapsibleComponent = ({ props, children }: P<"Collapsible">) => (
  <Collapsible.Root
    defaultOpen={props?.defaultOpen ?? false}
    className="w-full"
  >
    <Collapsible.Trigger className="flex w-full items-center justify-between rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted">
      {props?.title}
    </Collapsible.Trigger>
    <Collapsible.Panel className="pt-2 text-sm text-muted-foreground">
      {children}
    </Collapsible.Panel>
  </Collapsible.Root>
);

const DialogComponent = ({ props, children }: P<"Dialog">) => {
  const [open, setOpen] = useStateBinding<boolean>(props?.openPath ?? "");
  return (
    <Dialog.Root open={open ?? false} onOpenChange={(next) => setOpen(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-background p-6 shadow-lg outline-none">
          <div className="flex flex-col gap-2">
            <Dialog.Title className="text-lg font-semibold leading-none text-foreground">
              {props?.title}
            </Dialog.Title>
            {props?.description ? (
              <Dialog.Description className="text-sm text-muted-foreground">
                {props.description}
              </Dialog.Description>
            ) : null}
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

const Drawer = ({ props, children }: P<"Drawer">) => {
  const [open, setOpen] = useStateBinding<boolean>(props?.openPath ?? "");
  return (
    <Dialog.Root open={open ?? false} onOpenChange={(next) => setOpen(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-2 rounded-t-lg border border-border bg-background p-4 shadow-lg outline-none">
          <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-muted" />
          <Dialog.Title className="text-base font-semibold text-foreground">
            {props?.title}
          </Dialog.Title>
          {props?.description ? (
            <Dialog.Description className="text-sm text-muted-foreground">
              {props.description}
            </Dialog.Description>
          ) : null}
          <div className="pt-2">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

const Carousel = ({ props }: P<"Carousel">) => {
  const items = props?.items ?? [];
  return (
    <div className="flex w-full snap-x gap-3 overflow-x-auto pb-2">
      {items.map((item, i) => (
        <div
          key={i}
          className="h-full min-w-[240px] shrink-0 snap-start rounded-lg border border-border bg-card p-4"
        >
          {item.title ? (
            <h4 className="mb-1 text-sm font-semibold text-foreground">
              {item.title}
            </h4>
          ) : null}
          {item.description ? (
            <p className="text-sm text-muted-foreground">{item.description}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
};

// ── Data Display ────────────────────────────────────────────────────────────

const Table = ({ props }: P<"Table">) => {
  const columns = props?.columns ?? [];
  const rows = (props?.rows ?? []).map((row) => (row ?? []).map(String));
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-left text-sm">
        {props?.caption ? (
          <caption className="px-3 py-2 text-left text-xs text-muted-foreground">
            {props.caption}
          </caption>
        ) : null}
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col}
                scope="col"
                className="px-3 py-2 text-xs font-semibold uppercase tracking-normal text-muted-foreground"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/60 last:border-b-0">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-foreground">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Heading = ({ props }: P<"Heading">) => {
  const level = props?.level ?? "h2";
  const text = props?.text ?? "";
  const classByLevel: Record<string, string> = {
    h1: "text-2xl font-bold",
    h2: "text-lg font-semibold",
    h3: "text-base font-semibold",
    h4: "text-sm font-semibold",
  };
  const className = cn(classByLevel[level] ?? classByLevel.h2, "text-left text-foreground");
  if (level === "h1") return <h1 className={className}>{text}</h1>;
  if (level === "h3") return <h3 className={className}>{text}</h3>;
  if (level === "h4") return <h4 className={className}>{text}</h4>;
  return <h2 className={className}>{text}</h2>;
};

const Text = ({ props }: P<"Text">) => {
  const text = props?.text ?? "";
  const variant = props?.variant ?? "body";
  const textClass =
    variant === "caption"
      ? "text-xs text-foreground"
      : variant === "muted"
        ? "text-sm text-muted-foreground"
        : variant === "lead"
          ? "text-xl text-muted-foreground"
          : variant === "code"
            ? "font-mono text-sm bg-muted px-1.5 py-0.5 rounded"
            : "text-sm text-foreground";
  if (variant === "code") {
    return <code className={cn(textClass, "text-left")}>{text}</code>;
  }
  return <p className={cn(textClass, "text-left")}>{text}</p>;
};

const Image = ({ props }: P<"Image">) => {
  if (props?.src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={props.src}
        alt={props.alt ?? ""}
        width={props.width ?? undefined}
        height={props.height ?? undefined}
        className="max-w-full rounded"
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded border border-border bg-muted text-xs text-muted-foreground"
      style={{ width: props?.width ?? 80, height: props?.height ?? 60 }}
    >
      {props?.alt || "img"}
    </div>
  );
};

const Avatar = ({ props }: P<"Avatar">) => {
  const name = props?.name || "?";
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const sizeClass =
    props?.size === "lg" ? "size-12" : props?.size === "sm" ? "size-8" : "size-10";
  return (
    <BaseAvatar.Root
      className={cn(
        "inline-flex items-center justify-center overflow-hidden rounded-full bg-muted align-middle text-sm font-medium text-muted-foreground",
        sizeClass,
      )}
    >
      {props?.src ? (
        <BaseAvatar.Image
          src={props.src}
          alt={name}
          className="size-full object-cover"
        />
      ) : null}
      <BaseAvatar.Fallback className="flex size-full items-center justify-center">
        {initials}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
};

const Badge = ({ props }: P<"Badge">) => {
  const variant = props?.variant ?? "default";
  const byVariant: Record<string, string> = {
    default: "border-transparent bg-primary text-primary-foreground",
    secondary: "border-transparent bg-secondary text-secondary-foreground",
    destructive: "border-transparent bg-destructive text-white",
    outline: "border-border text-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        byVariant[variant] ?? byVariant.default,
      )}
    >
      {props?.text}
    </span>
  );
};

const Alert = ({ props }: P<"Alert">) => {
  const type = props?.type ?? "info";
  const byType: Record<string, string> = {
    success:
      "border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100",
    warning:
      "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-100",
    info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
    error: "border-destructive/50 bg-destructive/10 text-destructive",
  };
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border px-4 py-3 text-sm",
        byType[type] ?? byType.info,
      )}
    >
      <div className="font-medium">{props?.title}</div>
      {props?.message ? (
        <div className="mt-1 opacity-90">{props.message}</div>
      ) : null}
    </div>
  );
};

const ProgressComponent = ({ props }: P<"Progress">) => {
  const max = props?.max ?? 100;
  const value = Math.min(max, Math.max(0, props?.value ?? 0));
  return (
    <Progress.Root value={value} max={max} className="flex flex-col gap-2">
      {props?.label ? (
        <Progress.Label className="text-sm text-muted-foreground">
          {props.label}
        </Progress.Label>
      ) : null}
      <Progress.Track className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <Progress.Indicator className="h-full rounded-full bg-primary transition-all" />
      </Progress.Track>
    </Progress.Root>
  );
};

const Skeleton = ({ props }: P<"Skeleton">) => (
  <div
    className={cn(
      "animate-pulse bg-muted",
      props?.rounded ? "rounded-full" : "rounded-md",
    )}
    style={{
      width: props?.width ?? "100%",
      height: props?.height ?? "1.25rem",
    }}
  />
);

const Spinner = ({ props }: P<"Spinner">) => {
  const sizeClass =
    props?.size === "lg" ? "size-8" : props?.size === "sm" ? "size-4" : "size-6";
  return (
    <div className="flex items-center gap-2">
      <svg
        className={cn("animate-spin text-muted-foreground", sizeClass)}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      {props?.label ? (
        <span className="text-sm text-muted-foreground">{props.label}</span>
      ) : null}
    </div>
  );
};

const TooltipComponent = ({ props }: P<"Tooltip">) => (
  <Tooltip.Provider>
    <Tooltip.Root>
      <Tooltip.Trigger className="cursor-help text-sm underline decoration-dotted">
        {props?.text}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6}>
          <Tooltip.Popup className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
            {props?.content}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
);

const PopoverComponent = ({ props }: P<"Popover">) => (
  <Popover.Root>
    <Popover.Trigger className={buttonClasses("outline")}>
      {props?.trigger}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner sideOffset={6}>
        <Popover.Popup className="w-64 rounded-md border border-border bg-popover p-3 text-sm text-popover-foreground shadow-md outline-none">
          {props?.content}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>
);

// ── Form Inputs ─────────────────────────────────────────────────────────────

const Input = ({ props, bindings, emit }: P<"Input">) => {
  const [boundValue, setBoundValue] = useBoundProp(
    props?.value,
    bindings?.value,
  );
  const [localValue, setLocalValue] = useState("");
  const isBound = !!bindings?.value;
  const value = isBound ? (boundValue ?? "") : localValue;
  const setValue = isBound ? setBoundValue : setLocalValue;
  const validateOn = props?.validateOn ?? "blur";
  const hasValidation = !!(bindings?.value && props?.checks?.length);
  const { errors, validate } = useFieldValidation(
    bindings?.value ?? "",
    hasValidation ? { checks: props?.checks ?? [], validateOn } : undefined,
  );
  return (
    <div className="flex flex-col gap-2">
      {props?.label ? (
        <label htmlFor={props?.name ?? undefined} className={labelClass}>
          {props.label}
        </label>
      ) : null}
      <BaseInput
        id={props?.name ?? undefined}
        name={props?.name ?? undefined}
        type={props?.type ?? "text"}
        placeholder={props?.placeholder ?? ""}
        value={value}
        className={inputClass}
        onChange={(e) => {
          setValue(e.target.value);
          if (hasValidation && validateOn === "change") validate();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") emit("submit");
        }}
        onFocus={() => emit("focus")}
        onBlur={() => {
          if (hasValidation && validateOn === "blur") validate();
          emit("blur");
        }}
      />
      {errors.length > 0 ? (
        <p className={fieldErrorClass}>{errors[0]}</p>
      ) : null}
    </div>
  );
};

const Textarea = ({ props, bindings }: P<"Textarea">) => {
  const [boundValue, setBoundValue] = useBoundProp(
    props?.value,
    bindings?.value,
  );
  const [localValue, setLocalValue] = useState("");
  const isBound = !!bindings?.value;
  const value = isBound ? (boundValue ?? "") : localValue;
  const setValue = isBound ? setBoundValue : setLocalValue;
  const validateOn = props?.validateOn ?? "blur";
  const hasValidation = !!(bindings?.value && props?.checks?.length);
  const { errors, validate } = useFieldValidation(
    bindings?.value ?? "",
    hasValidation ? { checks: props?.checks ?? [], validateOn } : undefined,
  );
  return (
    <div className="flex flex-col gap-2">
      {props?.label ? (
        <label htmlFor={props?.name ?? undefined} className={labelClass}>
          {props.label}
        </label>
      ) : null}
      <textarea
        id={props?.name ?? undefined}
        name={props?.name ?? undefined}
        placeholder={props?.placeholder ?? ""}
        rows={props?.rows ?? 3}
        value={value}
        className={cn(inputClass, "h-auto py-2")}
        onChange={(e) => {
          setValue(e.target.value);
          if (hasValidation && validateOn === "change") validate();
        }}
        onBlur={() => {
          if (hasValidation && validateOn === "blur") validate();
        }}
      />
      {errors.length > 0 ? (
        <p className={fieldErrorClass}>{errors[0]}</p>
      ) : null}
    </div>
  );
};

const SelectComponent = ({ props, bindings, emit }: P<"Select">) => {
  const [boundValue, setBoundValue] = useBoundProp(
    props?.value,
    bindings?.value,
  );
  const [localValue, setLocalValue] = useState("");
  const isBound = !!bindings?.value;
  const value = isBound ? (boundValue ?? "") : localValue;
  const setValue = isBound ? setBoundValue : setLocalValue;
  const options = (props?.options ?? []).map((opt) =>
    typeof opt === "string" ? opt : String(opt ?? ""),
  );
  const validateOn = props?.validateOn ?? "change";
  const hasValidation = !!(bindings?.value && props?.checks?.length);
  const { errors, validate } = useFieldValidation(
    bindings?.value ?? "",
    hasValidation ? { checks: props?.checks ?? [], validateOn } : undefined,
  );
  return (
    <div className="flex flex-col gap-2">
      {props?.label ? <span className={labelClass}>{props.label}</span> : null}
      <Select.Root
        value={value}
        onValueChange={(next) => {
          setValue((next as string) ?? "");
          if (hasValidation && validateOn === "change") validate();
          emit("change");
        }}
      >
        <Select.Trigger
          className={cn(inputClass, "items-center justify-between")}
        >
          <Select.Value placeholder={props?.placeholder ?? "Select..."} />
          <Select.Icon aria-hidden="true">▾</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner sideOffset={4}>
            <Select.Popup className="min-w-[8rem] rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none">
              {options.map((opt, idx) => (
                <Select.Item
                  key={`${idx}-${opt}`}
                  value={opt || `option-${idx}`}
                  className="cursor-pointer rounded px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                >
                  <Select.ItemText>{opt}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
      {errors.length > 0 ? (
        <p className={fieldErrorClass}>{errors[0]}</p>
      ) : null}
    </div>
  );
};

const CheckboxComponent = ({ props, bindings, emit }: P<"Checkbox">) => {
  const [boundChecked, setBoundChecked] = useBoundProp(
    props?.checked,
    bindings?.checked,
  );
  const [localChecked, setLocalChecked] = useState(!!props?.checked);
  const isBound = !!bindings?.checked;
  const checked = isBound ? (boundChecked ?? false) : localChecked;
  const setChecked = isBound ? setBoundChecked : setLocalChecked;
  const validateOn = props?.validateOn ?? "change";
  const hasValidation = !!(bindings?.checked && props?.checks?.length);
  const { errors, validate } = useFieldValidation(
    bindings?.checked ?? "",
    hasValidation ? { checks: props?.checks ?? [], validateOn } : undefined,
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Checkbox.Root
          id={props?.name ?? undefined}
          checked={checked}
          onCheckedChange={(next) => {
            setChecked(next === true);
            if (hasValidation && validateOn === "change") validate();
            emit("change");
          }}
          className="flex size-4 items-center justify-center rounded border border-input bg-background outline-none data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground"
        >
          <Checkbox.Indicator className="text-xs leading-none">
            ✓
          </Checkbox.Indicator>
        </Checkbox.Root>
        <label htmlFor={props?.name ?? undefined} className="cursor-pointer text-sm text-foreground">
          {props?.label}
        </label>
      </div>
      {errors.length > 0 ? (
        <p className={fieldErrorClass}>{errors[0]}</p>
      ) : null}
    </div>
  );
};

const RadioComponent = ({ props, bindings, emit }: P<"Radio">) => {
  const options = (props?.options ?? []).map((opt) =>
    typeof opt === "string" ? opt : String(opt ?? ""),
  );
  const [boundValue, setBoundValue] = useBoundProp(
    props?.value,
    bindings?.value,
  );
  const [localValue, setLocalValue] = useState(options[0] ?? "");
  const isBound = !!bindings?.value;
  const value = isBound ? (boundValue ?? "") : localValue;
  const setValue = isBound ? setBoundValue : setLocalValue;
  const validateOn = props?.validateOn ?? "change";
  const hasValidation = !!(bindings?.value && props?.checks?.length);
  const { errors, validate } = useFieldValidation(
    bindings?.value ?? "",
    hasValidation ? { checks: props?.checks ?? [], validateOn } : undefined,
  );
  return (
    <div className="flex flex-col gap-2">
      {props?.label ? <span className={labelClass}>{props.label}</span> : null}
      <RadioGroup
        value={value}
        onValueChange={(next) => {
          setValue((next as string) ?? "");
          if (hasValidation && validateOn === "change") validate();
          emit("change");
        }}
        className="flex flex-col gap-2"
      >
        {options.map((opt, idx) => {
          const id = `${props?.name}-${idx}-${opt}`;
          return (
            <div key={`${idx}-${opt}`} className="flex items-center gap-2">
              <Radio.Root
                value={opt || `option-${idx}`}
                id={id}
                className="flex size-4 items-center justify-center rounded-full border border-input bg-background outline-none data-[checked]:border-primary"
              >
                <Radio.Indicator className="size-2 rounded-full bg-primary" />
              </Radio.Root>
              <label htmlFor={id} className="cursor-pointer text-sm text-foreground">
                {opt}
              </label>
            </div>
          );
        })}
      </RadioGroup>
      {errors.length > 0 ? (
        <p className={fieldErrorClass}>{errors[0]}</p>
      ) : null}
    </div>
  );
};

const SwitchComponent = ({ props, bindings, emit }: P<"Switch">) => {
  const [boundChecked, setBoundChecked] = useBoundProp(
    props?.checked,
    bindings?.checked,
  );
  const [localChecked, setLocalChecked] = useState(!!props?.checked);
  const isBound = !!bindings?.checked;
  const checked = isBound ? (boundChecked ?? false) : localChecked;
  const setChecked = isBound ? setBoundChecked : setLocalChecked;
  const validateOn = props?.validateOn ?? "change";
  const hasValidation = !!(bindings?.checked && props?.checks?.length);
  const { errors, validate } = useFieldValidation(
    bindings?.checked ?? "",
    hasValidation ? { checks: props?.checks ?? [], validateOn } : undefined,
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={props?.name ?? undefined} className="cursor-pointer text-sm text-foreground">
          {props?.label}
        </label>
        <Switch.Root
          id={props?.name ?? undefined}
          checked={checked}
          onCheckedChange={(next) => {
            setChecked(next);
            if (hasValidation && validateOn === "change") validate();
            emit("change");
          }}
          className="relative h-5 w-9 rounded-full bg-input outline-none transition-colors data-[checked]:bg-primary"
        >
          <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform data-[checked]:translate-x-[1.125rem]" />
        </Switch.Root>
      </div>
      {errors.length > 0 ? (
        <p className={fieldErrorClass}>{errors[0]}</p>
      ) : null}
    </div>
  );
};

const SliderComponent = ({ props, bindings, emit }: P<"Slider">) => {
  const [boundValue, setBoundValue] = useBoundProp(
    props?.value,
    bindings?.value,
  );
  const [localValue, setLocalValue] = useState(props?.min ?? 0);
  const isBound = !!bindings?.value;
  const value = isBound ? (boundValue ?? props?.min ?? 0) : localValue;
  const setValue = isBound ? setBoundValue : setLocalValue;
  return (
    <div className="flex flex-col gap-2">
      {props?.label ? (
        <div className="flex justify-between">
          <span className="text-sm text-foreground">{props.label}</span>
          <span className="text-sm text-muted-foreground">{value}</span>
        </div>
      ) : null}
      <Slider.Root
        value={value}
        min={props?.min ?? 0}
        max={props?.max ?? 100}
        step={props?.step ?? 1}
        onValueChange={(next) => {
          setValue(typeof next === "number" ? next : (next[0] ?? 0));
          emit("change");
        }}
      >
        <Slider.Control className="flex h-5 w-full items-center">
          <Slider.Track className="h-1.5 w-full rounded-full bg-muted">
            <Slider.Indicator className="rounded-full bg-primary" />
            <Slider.Thumb className="size-4 rounded-full border border-primary bg-background shadow-sm outline-none" />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </div>
  );
};

// ── Actions ─────────────────────────────────────────────────────────────────

const Button = ({ props, emit }: P<"Button">) => {
  const variant =
    props?.variant === "danger"
      ? "danger"
      : props?.variant === "secondary"
        ? "secondary"
        : "primary";
  return (
    <BaseButton
      type="button"
      disabled={props?.disabled ?? false}
      className={buttonClasses(variant)}
      onClick={() => emit("press")}
    >
      {props?.label}
    </BaseButton>
  );
};

const Link = ({ props, on }: P<"Link">) => (
  <a
    href={props?.href ?? "#"}
    className="text-sm font-medium text-primary underline-offset-4 hover:underline"
    onClick={(e) => {
      const press = on("press");
      if (press.shouldPreventDefault) e.preventDefault();
      press.emit();
    }}
  >
    {props?.label}
  </a>
);

const DropdownMenu = ({ props, bindings, emit }: P<"DropdownMenu">) => {
  const items = props?.items ?? [];
  const [, setBoundValue] = useBoundProp(props?.value, bindings?.value);
  return (
    <Menu.Root>
      <Menu.Trigger className={buttonClasses("outline")}>
        {props?.label}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4}>
          <Menu.Popup className="min-w-[8rem] rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none">
            {items.map((item) => (
              <Menu.Item
                key={item.value}
                onClick={() => {
                  setBoundValue(item.value);
                  emit("select");
                }}
                className="cursor-pointer rounded px-2 py-1.5 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};

const Toggle = ({ props, bindings, emit }: P<"Toggle">) => {
  const [boundPressed, setBoundPressed] = useBoundProp(
    props?.pressed,
    bindings?.pressed,
  );
  const [localPressed, setLocalPressed] = useState(props?.pressed ?? false);
  const isBound = !!bindings?.pressed;
  const pressed = isBound ? (boundPressed ?? false) : localPressed;
  const setPressed = isBound ? setBoundPressed : setLocalPressed;
  return (
    <BaseToggle
      pressed={pressed}
      onPressedChange={(next) => {
        setPressed(next);
        emit("change");
      }}
      className={cn(
        "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors hover:bg-muted data-[pressed]:bg-accent data-[pressed]:text-accent-foreground",
        props?.variant === "outline" ? "border border-border" : "",
      )}
    >
      {props?.label}
    </BaseToggle>
  );
};

const ToggleGroupComponent = ({ props, bindings, emit }: P<"ToggleGroup">) => {
  const type = props?.type ?? "single";
  const items = props?.items ?? [];
  const [boundValue, setBoundValue] = useBoundProp(
    props?.value,
    bindings?.value,
  );
  const [localValue, setLocalValue] = useState(items[0]?.value ?? "");
  const isBound = !!bindings?.value;
  const value = isBound ? (boundValue ?? "") : localValue;
  const setValue = isBound ? setBoundValue : setLocalValue;
  const selected =
    type === "multiple"
      ? value
        ? value.split(",").filter(Boolean)
        : []
      : value
        ? [value]
        : [];
  return (
    <BaseToggleGroup
      value={selected}
      onValueChange={(next) => {
        const arr = (next as string[]) ?? [];
        if (type === "multiple") {
          setValue(arr.join(","));
          emit("change");
        } else {
          const nextValue = arr[arr.length - 1];
          if (nextValue) {
            setValue(nextValue);
            emit("change");
          }
        }
      }}
      className="inline-flex items-center gap-1 rounded-md border border-border p-1"
    >
      {items.map((item) => (
        <BaseToggle
          key={item.value}
          value={item.value}
          className="inline-flex items-center rounded px-3 py-1 text-sm outline-none transition-colors hover:bg-muted data-[pressed]:bg-accent data-[pressed]:text-accent-foreground"
        >
          {item.label}
        </BaseToggle>
      ))}
    </BaseToggleGroup>
  );
};

const ButtonGroup = ({ props, bindings, emit }: P<"ButtonGroup">) => {
  const buttons = props?.buttons ?? [];
  const [boundSelected, setBoundSelected] = useBoundProp(
    props?.selected,
    bindings?.selected,
  );
  const [localValue, setLocalValue] = useState(buttons[0]?.value ?? "");
  const isBound = !!bindings?.selected;
  const value = isBound ? (boundSelected ?? "") : localValue;
  const setValue = isBound ? setBoundSelected : setLocalValue;
  return (
    <div className="inline-flex rounded-md border border-border">
      {buttons.map((btn, i) => (
        <button
          key={btn.value}
          type="button"
          className={cn(
            "px-3 py-1.5 text-sm transition-colors",
            value === btn.value
              ? "bg-primary text-primary-foreground"
              : "bg-background hover:bg-muted",
            i > 0 ? "border-l border-border" : "",
            i === 0 ? "rounded-l-md" : "",
            i === buttons.length - 1 ? "rounded-r-md" : "",
          )}
          onClick={() => {
            setValue(btn.value);
            emit("change");
          }}
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
};

function paginationRange(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "ellipsis")[] = [1];
  if (current > 3) pages.push("ellipsis");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

const Pagination = ({ props, bindings, emit }: P<"Pagination">) => {
  const [boundPage, setBoundPage] = useBoundProp(props?.page, bindings?.page);
  const currentPage = boundPage ?? 1;
  const totalPages = props?.totalPages ?? 1;
  const pages = paginationRange(currentPage, totalPages);
  const goTo = (page: number) => {
    setBoundPage(page);
    emit("change");
  };
  const navClass =
    "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm text-foreground outline-none transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50";
  return (
    <nav aria-label="pagination" className="flex items-center gap-1">
      <button
        type="button"
        className={navClass}
        disabled={currentPage <= 1}
        onClick={() => currentPage > 1 && goTo(currentPage - 1)}
      >
        Prev
      </button>
      {pages.map((page, idx) =>
        page === "ellipsis" ? (
          <span
            key={`ellipsis-${idx}`}
            className="px-2 text-sm text-muted-foreground"
          >
            …
          </span>
        ) : (
          <button
            key={page}
            type="button"
            aria-current={page === currentPage ? "page" : undefined}
            className={cn(
              navClass,
              page === currentPage
                ? "border border-border bg-accent text-accent-foreground"
                : "",
            )}
            onClick={() => goTo(page)}
          >
            {page}
          </button>
        ),
      )}
      <button
        type="button"
        className={navClass}
        disabled={currentPage >= totalPages}
        onClick={() => currentPage < totalPages && goTo(currentPage + 1)}
      >
        Next
      </button>
    </nav>
  );
};

/**
 * The ThinkWork-owned primitive component map. Keys match the primitive catalog
 * type names one-to-one; passed to `defineRegistry` in the web catalog. Exported
 * under the same name (`threadJsonRenderPrimitiveComponents`) the shadcn map was
 * so existing importers are unchanged.
 */
export const threadJsonRenderPrimitiveComponents = {
  Card,
  Stack,
  Grid,
  Separator,
  Tabs: TabsComponent,
  Accordion: AccordionComponent,
  Collapsible: CollapsibleComponent,
  Dialog: DialogComponent,
  Drawer,
  Carousel,
  Table,
  Heading,
  Text,
  Image,
  Avatar,
  Badge,
  Alert,
  Progress: ProgressComponent,
  Skeleton,
  Spinner,
  Tooltip: TooltipComponent,
  Popover: PopoverComponent,
  Input,
  Textarea,
  Select: SelectComponent,
  Checkbox: CheckboxComponent,
  Radio: RadioComponent,
  Switch: SwitchComponent,
  Slider: SliderComponent,
  Button,
  Link,
  DropdownMenu,
  Toggle,
  ToggleGroup: ToggleGroupComponent,
  ButtonGroup,
  Pagination,
} satisfies Record<
  keyof ThreadJsonRenderPrimitiveComponentPropsMap,
  (ctx: never) => ReactNode
>;
