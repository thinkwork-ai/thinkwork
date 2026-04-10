import React, { useMemo, useState } from "react";
import { ActivityIndicator, View, useColorScheme } from "react-native";
import { useMutation } from "urql";
import { CheckCircle2 } from "lucide-react-native";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import type { GenUIProps } from "@/lib/genui-registry";
import { SendMessageMutation } from "@/lib/graphql-queries";

import TextField from "./fields/TextField";
import BooleanField from "./fields/BooleanField";
import SelectField, { type SelectOption } from "./fields/SelectField";
import DateField from "./fields/DateField";
import UserPickerField from "./fields/UserPickerField";

// ---------------------------------------------------------------------------
// Schema types — match references/intake-form.json shape
// ---------------------------------------------------------------------------

type FieldType = "text" | "textarea" | "boolean" | "select" | "user_picker" | "date";

interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: SelectOption[];
}

interface FormSchema {
  id: string;
  title?: string;
  description?: string;
  submit_label?: string;
  fields: FormField[];
}

type FieldValue = string | boolean | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFieldFilled(field: FormField, value: FieldValue): boolean {
  if (field.type === "boolean") return value === true || value === false;
  if (typeof value === "string") return value.trim().length > 0;
  return value !== undefined && value !== null;
}

function buildFormResponseContent(formId: string, values: Record<string, FieldValue>): string {
  // Use a triple-backtick fenced block with `form_response` language tag.
  // The agent's next turn sees this as part of the user message and parses
  // the JSON to drive task creation. Matches PRD-46 spec.
  return [
    "```form_response",
    JSON.stringify({ form_id: formId, values }, null, 2),
    "```",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuestionCard({ data, context }: GenUIProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;

  const schema = data.schema as FormSchema | undefined;
  const initialValues = (data.values as Record<string, FieldValue> | undefined) ?? {};

  const [values, setValues] = useState<Record<string, FieldValue>>(() => ({ ...initialValues }));
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [, executeSendMessage] = useMutation(SendMessageMutation);

  const setField = (fieldId: string, next: FieldValue) => {
    setValues((prev) => ({ ...prev, [fieldId]: next }));
  };

  const missingRequired = useMemo<string[]>(() => {
    if (!schema) return [];
    return schema.fields
      .filter((f) => f.required && !isFieldFilled(f, values[f.id]))
      .map((f) => f.label);
  }, [schema, values]);

  const canSubmit = !submitted && !submitting && missingRequired.length === 0;

  if (!schema || !Array.isArray(schema.fields)) {
    return (
      <View className="rounded-xl border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-4">
        <Text size="sm" className="text-red-700 dark:text-red-300">
          QuestionCard: invalid form schema (missing fields).
        </Text>
      </View>
    );
  }

  const handleSubmit = async () => {
    if (!context) {
      setError("Cannot submit: no thread context. Please reload the thread.");
      return;
    }
    if (missingRequired.length > 0) {
      setError(`Please fill: ${missingRequired.join(", ")}`);
      return;
    }
    setError(null);
    setSubmitting(true);

    // Drop undefined values so the agent only sees actual answers.
    const cleanValues: Record<string, FieldValue> = {};
    for (const f of schema.fields) {
      const v = values[f.id];
      if (v !== undefined && !(typeof v === "string" && v.trim() === "")) {
        cleanValues[f.id] = typeof v === "string" ? v.trim() : v;
      }
    }

    try {
      const result = await executeSendMessage({
        input: {
          threadId: context.threadId,
          role: "USER" as any,
          content: buildFormResponseContent(schema.id, cleanValues),
          senderType: "human",
          senderId: context.currentUserId,
        },
      });
      if (result.error) {
        setError(result.error.message);
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch (exc: any) {
      setError(exc?.message ?? "Failed to submit form");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)",
        backgroundColor: isDark ? "#1c1c1e" : "#fff",
      }}
    >
      {/* Header */}
      <View className="px-4 pt-4 pb-2">
        {schema.title && (
          <Text size="lg" weight="bold">{schema.title}</Text>
        )}
        {schema.description && (
          <Text size="sm" variant="muted" className="mt-1">{schema.description}</Text>
        )}
      </View>

      {/* Fields */}
      <View className="px-4 pt-2 pb-4">
        {schema.fields.map((field) => {
          const value = values[field.id];
          const commonProps = {
            id: field.id,
            label: field.label,
            required: field.required,
            disabled: submitted || submitting,
          } as const;

          if (field.type === "text") {
            return (
              <TextField
                key={field.id}
                {...commonProps}
                placeholder={field.placeholder}
                value={(value as string) ?? ""}
                onChange={(v) => setField(field.id, v)}
              />
            );
          }
          if (field.type === "textarea") {
            return (
              <TextField
                key={field.id}
                {...commonProps}
                placeholder={field.placeholder}
                multiline
                value={(value as string) ?? ""}
                onChange={(v) => setField(field.id, v)}
              />
            );
          }
          if (field.type === "boolean") {
            return (
              <BooleanField
                key={field.id}
                {...commonProps}
                value={value as boolean | undefined}
                onChange={(v) => setField(field.id, v)}
              />
            );
          }
          if (field.type === "select") {
            return (
              <SelectField
                key={field.id}
                {...commonProps}
                placeholder={field.placeholder}
                options={field.options ?? []}
                value={value as string | undefined}
                onChange={(v) => setField(field.id, v)}
              />
            );
          }
          if (field.type === "user_picker") {
            return (
              <UserPickerField
                key={field.id}
                {...commonProps}
                value={value as string | undefined}
                onChange={(v) => setField(field.id, v)}
              />
            );
          }
          if (field.type === "date") {
            return (
              <DateField
                key={field.id}
                {...commonProps}
                value={value as string | undefined}
                onChange={(v) => setField(field.id, v)}
              />
            );
          }
          // Unknown field type — render a small inline error so authors notice.
          return (
            <View key={field.id} className="mb-4">
              <Text size="xs" weight="medium" variant="muted" className="uppercase tracking-wide mb-1.5">
                {field.label}
              </Text>
              <Text size="xs" className="text-red-500">
                Unsupported field type: {String((field as any).type)}
              </Text>
            </View>
          );
        })}

        {error && (
          <Text size="sm" className="mb-2 text-red-500">{error}</Text>
        )}

        {/* Submit / submitted state */}
        {submitted ? (
          <View
            className="flex-row items-center justify-center gap-2 py-3 rounded-xl"
            style={{ backgroundColor: isDark ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.10)" }}
          >
            <CheckCircle2 size={18} color="#22c55e" />
            <Text size="sm" weight="medium" style={{ color: "#22c55e" }}>Submitted</Text>
          </View>
        ) : (
          <Button
            onPress={handleSubmit}
            disabled={!canSubmit}
            className="mt-2"
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text size="base" weight="semibold" style={{ color: colors.primaryForeground }}>
                {schema.submit_label || "Submit"}
              </Text>
            )}
          </Button>
        )}
      </View>
    </View>
  );
}

export default QuestionCard;
