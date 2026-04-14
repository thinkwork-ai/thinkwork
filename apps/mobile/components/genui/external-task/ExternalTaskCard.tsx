import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useMutation } from 'urql';
import { Text } from '@/components/ui/typography';
import { ExecuteExternalTaskActionMutation } from '@/lib/graphql-queries';
import type { GenUIProps } from '@/lib/genui-registry';
import { buildExecuteExternalTaskActionVariables } from '@/lib/external-task-action';
import { TaskHeader } from './blocks/TaskHeader';
import { FieldList } from './blocks/FieldList';
import { BadgeRow } from './blocks/BadgeRow';
import { ActionBar } from './blocks/ActionBar';
import { FormBlock } from './blocks/FormBlock';
import type {
  ExternalTaskEnvelope,
  NormalizedTask,
  TaskActionSpec,
  TaskActionType,
  TaskBlock,
} from './types';

export type SubmitFn = (args: {
  actionType: TaskActionType;
  params: Record<string, unknown>;
}) => Promise<{ envelope?: ExternalTaskEnvelope; error?: string }>;

function renderBlock({
  block,
  item,
  submitting,
  handleActionPress,
  submit,
  keyPrefix,
}: {
  block: TaskBlock;
  item: NormalizedTask;
  submitting: boolean;
  handleActionPress: (a: TaskActionSpec) => void;
  submit: SubmitFn;
  keyPrefix: string;
}): React.ReactNode {
  switch (block.type) {
    case 'task_header':
      return (
        <TaskHeader
          key={`${keyPrefix}header`}
          item={item}
          showSource={block.showSource}
          showUpdatedAt={block.showUpdatedAt}
        />
      );
    case 'field_list':
      return (
        <FieldList
          key={`${keyPrefix}fields`}
          item={item}
          fieldKeys={block.fieldKeys}
          columns={block.columns}
          title={block.title}
        />
      );
    case 'badge_row':
      return (
        <BadgeRow
          key={`${keyPrefix}badges`}
          item={item}
          fieldKeys={block.fieldKeys}
        />
      );
    case 'action_bar':
      return (
        <ActionBar
          key={`${keyPrefix}actions`}
          item={item}
          actionIds={block.actionIds}
          disabled={submitting}
          onActionPress={handleActionPress}
        />
      );
    case 'form':
      return (
        <FormBlock
          key={`${keyPrefix}form-${block.formId}`}
          item={item}
          formId={block.formId}
          submit={submit}
        />
      );
    case 'section':
      return (
        <View key={`${keyPrefix}section`}>
          {block.title ? (
            <Text
              size="xs"
              weight="medium"
              variant="muted"
              className="uppercase tracking-wider px-4 pt-3"
            >
              {block.title}
            </Text>
          ) : null}
          {block.blocks.map((child, i) =>
            renderBlock({
              block: child,
              item,
              submitting,
              handleActionPress,
              submit,
              keyPrefix: `${keyPrefix}sec${i}-`,
            }),
          )}
        </View>
      );
    case 'empty_state':
      return (
        <View
          key={`${keyPrefix}empty`}
          className="px-4 py-6 border-t border-neutral-100 dark:border-neutral-700"
        >
          <Text size="sm" weight="medium" className="dark:text-neutral-100 mb-1">
            {block.title}
          </Text>
          {block.body ? (
            <Text size="xs" variant="muted">
              {block.body}
            </Text>
          ) : null}
        </View>
      );
    case 'activity_list':
    default:
      return null;
  }
}

function ExternalTaskCard({ data, context }: GenUIProps) {
  const envelope = data as unknown as ExternalTaskEnvelope;
  const threadId = context?.threadId;

  const [currentEnvelope, setCurrentEnvelope] = useState<ExternalTaskEnvelope>(envelope);
  const [submitting, setSubmitting] = useState(false);
  const [topLevelError, setTopLevelError] = useState<string | null>(null);

  const [, executeExternalTaskAction] = useMutation(ExecuteExternalTaskActionMutation);

  const submit: SubmitFn = useCallback(
    async ({ actionType, params }) => {
      if (!threadId) {
        const err = 'Missing threadId context — external task actions are only available in the thread timeline';
        setTopLevelError(err);
        return { error: err };
      }
      setSubmitting(true);
      setTopLevelError(null);
      try {
        const vars = buildExecuteExternalTaskActionVariables({ threadId, actionType, params });
        const result = await executeExternalTaskAction(vars);
        if (result.error) {
          const msg = result.error.message || 'Action failed';
          setTopLevelError(msg);
          return { error: msg };
        }
        const payload = result.data?.executeExternalTaskAction?.envelope;
        if (payload) {
          const next =
            typeof payload === 'string'
              ? (JSON.parse(payload) as ExternalTaskEnvelope)
              : (payload as unknown as ExternalTaskEnvelope);
          setCurrentEnvelope(next);
          return { envelope: next };
        }
        return {};
      } finally {
        setSubmitting(false);
      }
    },
    [executeExternalTaskAction, threadId],
  );

  const item = currentEnvelope.item;
  const blocks = currentEnvelope.blocks;

  if (!item || !Array.isArray(blocks)) {
    return (
      <View className="rounded-xl border border-red-200 bg-red-50 p-3">
        <Text size="xs" className="text-red-600">
          Invalid external_task envelope
        </Text>
      </View>
    );
  }

  const handleActionPress = (a: TaskActionSpec) => {
    if (a.formId) {
      return;
    }
    submit({ actionType: a.type, params: a.params ?? {} });
  };

  return (
    <View className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 overflow-hidden">
      {blocks.map((b, i) =>
        renderBlock({
          block: b,
          item,
          submitting,
          handleActionPress,
          submit,
          keyPrefix: `${i}-`,
        }),
      )}
      {topLevelError ? (
        <View className="px-4 py-2 border-t border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20">
          <Text size="xs" className="text-red-600">
            {topLevelError}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default ExternalTaskCard;
