import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/typography';
import { TextField } from '@/components/genui/fields/TextField';
import { BooleanField } from '@/components/genui/fields/BooleanField';
import { SelectField } from '@/components/genui/fields/SelectField';
import { DateField } from '@/components/genui/fields/DateField';
import { UserPickerField } from '@/components/genui/fields/UserPickerField';
import type { SubmitFn } from '../ExternalTaskCard';
import type { NormalizedTask, TaskFormField, TaskFormSchema } from '../types';

type FormState = Record<string, unknown>;

function initialState(schema: TaskFormSchema): FormState {
  const out: FormState = {};
  for (const f of schema.fields) {
    out[f.key] = f.defaultValue ?? '';
  }
  return out;
}

function isDirty(initial: FormState, current: FormState): boolean {
  for (const k of Object.keys(current)) {
    if (current[k] !== initial[k]) return true;
  }
  return false;
}

export function FormBlock({
  item,
  formId,
  submit,
}: {
  item: NormalizedTask;
  formId: string;
  submit: SubmitFn;
}) {
  const schema = item.forms?.edit?.id === formId ? item.forms?.edit : undefined;
  const initial = useMemo(() => (schema ? initialState(schema) : {}), [schema]);
  const [values, setValues] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!schema) {
    return (
      <View className="px-4 py-3 border-t border-neutral-100 dark:border-neutral-700">
        <Text size="xs" variant="muted">
          Form {formId} not found on this task.
        </Text>
      </View>
    );
  }

  const updateField = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await submit({
        actionType: schema.actionType,
        params: { _formId: schema.id, ...values },
      });
      if (result.error) setError(result.error);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  const dirty = isDirty(initial, values);

  return (
    <View className="px-4 py-3 border-t border-neutral-100 dark:border-neutral-700">
      <Text size="sm" weight="medium" className="dark:text-neutral-100 mb-2">
        {schema.title}
      </Text>
      {schema.description ? (
        <Text size="xs" variant="muted" className="mb-3">
          {schema.description}
        </Text>
      ) : null}

      {schema.fields.map((f: TaskFormField) => {
        if (f.hidden) return null;
        const fieldId = `${schema.id}-${f.key}`;
        const value = values[f.key];
        switch (f.type) {
          case 'text':
            return (
              <TextField
                key={f.key}
                id={fieldId}
                label={f.label}
                required={f.required}
                placeholder={f.placeholder}
                value={typeof value === 'string' ? value : ''}
                disabled={submitting}
                onChange={(v) => updateField(f.key, v)}
              />
            );
          case 'textarea':
            return (
              <TextField
                key={f.key}
                id={fieldId}
                label={f.label}
                required={f.required}
                placeholder={f.placeholder}
                multiline
                value={typeof value === 'string' ? value : ''}
                disabled={submitting}
                onChange={(v) => updateField(f.key, v)}
              />
            );
          case 'select':
            return (
              <SelectField
                key={f.key}
                id={fieldId}
                label={f.label}
                required={f.required}
                options={f.options ?? []}
                value={typeof value === 'string' ? value : undefined}
                disabled={submitting}
                onChange={(v) => updateField(f.key, v)}
              />
            );
          case 'boolean':
            return (
              <BooleanField
                key={f.key}
                id={fieldId}
                label={f.label}
                required={f.required}
                value={typeof value === 'boolean' ? value : undefined}
                disabled={submitting}
                onChange={(v) => updateField(f.key, v)}
              />
            );
          case 'date':
            return (
              <DateField
                key={f.key}
                id={fieldId}
                label={f.label}
                required={f.required}
                value={typeof value === 'string' ? value : ''}
                disabled={submitting}
                onChange={(v) => updateField(f.key, v)}
              />
            );
          case 'user':
            return (
              <UserPickerField
                key={f.key}
                id={fieldId}
                label={f.label}
                required={f.required}
                value={typeof value === 'string' ? value : ''}
                disabled={submitting}
                onChange={(v) => updateField(f.key, v)}
              />
            );
          default:
            return null;
        }
      })}

      {error ? (
        <Text size="xs" className="mb-2 text-red-600">
          {error}
        </Text>
      ) : null}

      <View className="flex-row gap-2 mt-2">
        <Pressable
          onPress={dirty && !submitting ? handleSubmit : undefined}
          disabled={!dirty || submitting}
          className="px-4 py-2 rounded-lg bg-primary dark:bg-primary-dark"
          style={{ opacity: dirty && !submitting ? 1 : 0.5 }}
        >
          <Text size="sm" weight="medium" className="text-white">
            {submitting ? 'Saving…' : schema.submitLabel}
          </Text>
        </Pressable>
        {schema.cancelLabel ? (
          <Pressable
            onPress={() => setValues(initial)}
            disabled={!dirty || submitting}
            className="px-4 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-700"
            style={{ opacity: dirty && !submitting ? 1 : 0.5 }}
          >
            <Text size="sm" weight="medium" className="text-neutral-900 dark:text-neutral-100">
              {schema.cancelLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
