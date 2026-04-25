import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  parseRoutingTable,
  replaceRoutingTable,
  type RoutingRow,
} from "./routing-table";

export interface RoutingTableEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function RoutingTableEditor({
  value,
  onChange,
}: RoutingTableEditorProps) {
  const parsed = useMemo(() => parseRoutingTable(value), [value]);
  const [rows, setRows] = useState<RoutingRow[]>(parsed.rows);

  useEffect(() => {
    setRows(parsed.rows);
  }, [parsed.rows]);

  const canEdit =
    !parsed.warning || parsed.warning === "No routing table found.";

  const updateRows = (nextRows: RoutingRow[]) => {
    setRows(nextRows);
    onChange(replaceRoutingTable(value, nextRows));
  };

  return (
    <div className="border-b bg-background">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div>
          <h2 className="text-xs font-medium">Routing</h2>
          {parsed.warning ? (
            <p className="mt-0.5 text-xs text-amber-600">{parsed.warning}</p>
          ) : parsed.rowWarnings && parsed.rowWarnings.length > 0 ? (
            <p className="mt-0.5 text-xs text-amber-600">
              {parsed.rowWarnings[0]}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {rows.length} {rows.length === 1 ? "row" : "rows"}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={!canEdit}
          onClick={() =>
            updateRows([...rows, { task: "", goTo: "", read: "", skills: [] }])
          }
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Row
        </Button>
      </div>
      {canEdit && (
        <div className="max-h-56 overflow-auto border-t">
          <div className="grid grid-cols-[1.2fr_0.8fr_1.2fr_1.2fr_32px] gap-2 border-b bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            <span>Task</span>
            <span>Go to</span>
            <span>Read</span>
            <span>Skills</span>
            <span />
          </div>
          {rows.length === 0 ? (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              No routing rows yet.
            </div>
          ) : (
            rows.map((row, index) => (
              <div
                key={index}
                className="grid grid-cols-[1.2fr_0.8fr_1.2fr_1.2fr_32px] gap-2 border-b px-3 py-2 last:border-b-0"
              >
                <RoutingInput
                  value={row.task}
                  onChange={(task) =>
                    updateRows(updateRow(rows, index, { task }))
                  }
                />
                <RoutingInput
                  value={row.goTo}
                  onChange={(goTo) =>
                    updateRows(updateRow(rows, index, { goTo }))
                  }
                />
                <RoutingInput
                  value={row.read}
                  onChange={(read) =>
                    updateRows(updateRow(rows, index, { read }))
                  }
                />
                <RoutingInput
                  value={row.skills.join(", ")}
                  onChange={(skills) =>
                    updateRows(
                      updateRow(rows, index, {
                        skills: skills
                          .split(",")
                          .map((skill) => skill.trim())
                          .filter(Boolean),
                      }),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground"
                  onClick={() =>
                    updateRows(rows.filter((_, rowIndex) => rowIndex !== index))
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function RoutingInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-7 px-2 text-xs"
    />
  );
}

function updateRow(
  rows: RoutingRow[],
  index: number,
  patch: Partial<RoutingRow>,
) {
  return rows.map((row, rowIndex) =>
    rowIndex === index ? { ...row, ...patch } : row,
  );
}
