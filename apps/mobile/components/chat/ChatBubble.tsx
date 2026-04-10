import React, { useEffect, useRef, useCallback } from 'react';
import { View, Animated } from 'react-native';
import { Text } from '@/components/ui/typography';
import type { ChatMessage } from '@/hooks/useGatewayChat';
import { MarkdownMessage } from './MarkdownMessage';
import { ArtifactCard } from './ArtifactCard';
import { type UiAction } from '@/lib/ui-envelope-types';
import { parseTypedJson, getGenUIComponent, parseMessageBlocks, type MessageBlock, type GenUIAction } from '@/lib/genui-registry';
import {
  getRenderableMessageContent,
  isInteractionOnlyMessage,
  isSystemMessage,
} from './system-message';
import { AnimatedEntry } from './AnimatedEntry';
import { TypingIndicator } from './TypingIndicator';
import { InlineApprovalCard } from '../inbox/InlineApprovalCard';

/** Extract inline approval metadata from message content if present. */
function extractApprovalMeta(
  content: string,
): { inboxItemId: string; title: string; description?: string; type: string } | null {
  // Pattern 1: [APPROVAL_REQUEST:id] or [APPROVAL_REQUEST:id:title]
  const tagMatch = content.match(/\[APPROVAL_REQUEST:([^\]\s:]+)(?::([^\]]*))?\]/);
  if (tagMatch) {
    return {
      inboxItemId: tagMatch[1],
      title: tagMatch[2]?.trim() || 'Approval Request',
      type: 'APPROVAL',
    };
  }
  // Pattern 2: JSON block with inboxItemId
  const jsonMatch = content.match(/```json\s*\n?([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed?.inboxItemId) {
        return {
          inboxItemId: parsed.inboxItemId,
          title: parsed.title || 'Approval Request',
          description: parsed.description,
          type: parsed.type || 'APPROVAL',
        };
      }
    } catch {
      // not valid JSON — ignore
    }
  }
  // Pattern 3: inline JSON object with inboxItemId (no code fence)
  const inlineMatch = content.match(/\{[^}]*"inboxItemId"\s*:\s*"([^"]+)"[^}]*\}/);
  if (inlineMatch) {
    try {
      const parsed = JSON.parse(inlineMatch[0]);
      return {
        inboxItemId: parsed.inboxItemId,
        title: parsed.title || 'Approval Request',
        description: parsed.description,
        type: parsed.type || 'APPROVAL',
      };
    } catch {
      // fallback: just use the captured id
      return {
        inboxItemId: inlineMatch[1],
        title: 'Approval Request',
        type: 'APPROVAL',
      };
    }
  }
  return null;
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function BlinkingCursor() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{ opacity }}
      className="w-2 h-4 bg-neutral-400 dark:bg-neutral-500 rounded-sm ml-1"
    />
  );
}

export function ChatBubble({
  message,
  onEnvelopeAction,
  showSystemMessages = false,
  animate = false,
}: {
  message: ChatMessage;
  onEnvelopeAction?: (action: UiAction, context?: Record<string, unknown>) => void;
  showSystemMessages?: boolean;
  animate?: boolean;
}) {
  // Bridge GenUI onAction → envelope action pipeline
  const handleGenUIAction = useCallback((action: GenUIAction) => {
    if (onEnvelopeAction && action.type === 'tool.invoke') {
      onEnvelopeAction({ action: { type: 'tool.invoke', tool: action.tool, args: action.args } });
    }
  }, [onEnvelopeAction]);

  // Render typing placeholder inline — the typing cell and the real message
  // share the same FlatList key (__typing__) so the cell stays mounted.
  // Use a React key on the inner content to remount AnimatedEntry when
  // transitioning from dots → message, which triggers the bounce animation.
  if (message.isTypingPlaceholder) {
    return (
      <View className="mb-3 px-4 items-start">
        <AnimatedEntry key="typing-dots" animate={animate}>
          <TypingIndicator inline />
        </AnimatedEntry>
      </View>
    );
  }

  const isUser = message.role === 'user';
  const content = getRenderableMessageContent(message, showSystemMessages);

  // Don't render empty bubbles (e.g., hidden system messages or tool calls with no text content)
  if (!content && !message.isStreaming) return null;

  const displayContent = content ?? '';
  // Optimistic user messages: always animate (slide up on send)
  // New assistant messages: animate if flagged by parent (not in initial load)
  // Server user messages replacing optimistic: never animate (avoid flash)
  const shouldAnimate = message.id.startsWith('optimistic-') ||
    (message.role === 'assistant' && animate);

  // If this is an interaction message in hidden mode, render it as a user bubble (right-aligned, orange)
  if (isInteractionOnlyMessage(displayContent) && !showSystemMessages) {
    const interactionMatch = displayContent.match(/\[INTERACTION\](.*?)\[\/INTERACTION\]/s);
    const interactionText = interactionMatch?.[1]?.trim() ?? '';
    return (
      <View className="mb-3 px-4 items-end">
        <AnimatedEntry animate={shouldAnimate}>
          <View className="max-w-[85%] rounded-2xl px-4 py-2.5 bg-primary dark:bg-primary-dark rounded-br-md">
            <Text size="sm" className="text-white dark:text-neutral-900">
              {interactionText}
            </Text>
          </View>
          <Text size="xs" variant="muted" className="mt-1 pr-0 text-right">
            {relativeTime(message.timestamp)}
          </Text>
        </AnimatedEntry>
      </View>
    );
  }

  // GenUI: typed tool results attached to message (rendered after text content)
  if (!isUser && message.toolResults) {
    console.log('[GenUI ChatBubble] toolResults:', message.toolResults.length, 'items');
  }
  const genuiComponents = !isUser ? (message.toolResults || [])
    .filter((tr) => tr && typeof tr._type === 'string')
    .map((tr) => {
      const comp = getGenUIComponent(String(tr._type));
      return comp ? { data: tr, component: comp } : null;
    })
    .filter(Boolean) as Array<{ data: Record<string, unknown>; component: React.LazyExoticComponent<React.ComponentType<any>> }> : [];

  // Also check for genui fences in content (direct passthrough case)
  const messageBlocks = !isUser && genuiComponents.length === 0 ? parseMessageBlocks(displayContent) : null;

  const isSystem = isSystemMessage(message);

  // Check for inline approval metadata in assistant messages
  const approvalMeta = !isUser ? extractApprovalMeta(displayContent) : null;

  return (
    <View className={`mb-3 px-4 ${isUser ? 'items-end' : 'items-start'}`}>
      <AnimatedEntry key={`msg-${message.id}`} animate={shouldAnimate}>
        <View
          className={`${
            isUser
              ? 'max-w-[85%] rounded-2xl px-4 py-2.5 bg-primary dark:bg-primary-dark rounded-br-md'
              : 'w-full py-1'
          }`}
        >
          {genuiComponents.length > 0 ? (
            <View className="gap-3">
              {/* LLM text content first */}
              {displayContent && <MarkdownMessage content={displayContent} isUser={false} />}
              {/* Then GenUI components from tool results */}
              {genuiComponents.map((gc, i) => (
                <React.Suspense key={i} fallback={<Text size="sm" variant="muted">Loading...</Text>}>
                  <View className="mt-2">
                    <gc.component data={gc.data} onAction={handleGenUIAction} />
                  </View>
                </React.Suspense>
              ))}
            </View>
          ) : messageBlocks ? (
            <View className="gap-3">
              {messageBlocks.map((block, i) =>
                block.type === 'text' ? (
                  <MarkdownMessage key={i} content={block.content} isUser={false} />
                ) : (
                  <React.Suspense key={i} fallback={<Text size="sm" variant="muted">Loading...</Text>}>
                    <View className="mt-2">
                      <block.component data={block.data} onAction={handleGenUIAction} />
                    </View>
                  </React.Suspense>
                )
              )}
            </View>
          ) : message.durableArtifact ? (
            <ArtifactCard
              title={message.durableArtifact.title}
              type={message.durableArtifact.type?.toLowerCase()}
              status={message.durableArtifact.status?.toLowerCase()}
              content={message.durableArtifact.content ?? displayContent}
            />
          ) : (
            <MarkdownMessage content={displayContent} isUser={isUser} />
          )}
          {approvalMeta && (
            <InlineApprovalCard
              inboxItemId={approvalMeta.inboxItemId}
              title={approvalMeta.title}
              description={approvalMeta.description}
              type={approvalMeta.type}
            />
          )}
          {showSystemMessages && isSystem ? (
            <Text size="xs" variant="muted" className="mt-2 uppercase tracking-widest">
              System message
            </Text>
          ) : null}
          {message.isStreaming && (
            <View className="mt-1">
              <BlinkingCursor />
            </View>
          )}
        </View>
        <Text size="xs" variant="muted" className={`mt-1 ${isUser ? 'pr-0 text-right' : 'pl-0'}`}>
          {relativeTime(message.timestamp)}
        </Text>
      </AnimatedEntry>
    </View>
  );
}
