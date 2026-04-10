import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import { loadOrCreateIdentity, signPayload } from './useDeviceIdentity';
import type { UiEnvelope } from '@/lib/ui-envelope-types';

export interface GatewayChatOptions {
  useDeviceAuth?: boolean;
  sessionKey?: string;
  onFirstExchange?: (userMsg: string, assistantMsg: string) => void;
  caller?: {
    name?: string;
    email?: string;
    role?: string;
    isOwner?: boolean;
  };
}

// Simple UUID generator (no deps)
function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  artifactId?: string;
  artifact?: {
    id: string;
    kind?: 'tool_result' | 'structured_result' | 'ui_envelope';
    runtime?: string;
    toolName?: string;
    serverName?: string;
    runId?: string;
    schemaHints?: unknown;
  } | null;
  /** Durable artifact from the artifacts table (markdown-first) */
  durableArtifact?: {
    id: string;
    title: string;
    type: string;
    status: string;
    content?: string;
    summary?: string;
  } | null;
  structuredData?: unknown;
  uiEnvelope?: UiEnvelope | null;
  /** GenUI: typed JSON objects from MCP tool results (rendered as rich components) */
  toolResults?: Array<Record<string, unknown>> | null;
  timestamp: number;
  isStreaming?: boolean;
  isTypingPlaceholder?: boolean;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface UseGatewayChatReturn {
  messages: ChatMessage[];
  isConnected: boolean;
  isStreaming: boolean;
  historyLoaded: boolean;
  send: (text: string) => void;
  loadHistory: () => Promise<void>;
  connectionStatus: ConnectionStatus;
}

interface PendingRequest {
  resolve: (payload: any) => void;
  reject: (err: Error) => void;
}

function extractContent(msg: any): string {
  if (typeof msg === 'string') return msg;
  // msg might be a message object with { role, content } or just a content array
  const content = msg?.content ?? msg;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('');
  }
  return '';
}

export function useGatewayChat(
  baseUrl: string | undefined,
  token: string | undefined,
  options?: GatewayChatOptions
): UseGatewayChatReturn {
  const useDeviceAuth = options?.useDeviceAuth ?? false;
  const caller = options?.caller;
  const effectiveSessionKey = options?.sessionKey ?? 'main';
  const onFirstExchange = options?.onFirstExchange;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [isStreaming, setIsStreaming] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const reconnectDelay = useRef(1000);
  const mountedRef = useRef(true);
  const streamingMsgRef = useRef<ChatMessage | null>(null);

  // First exchange tracking
  const isNewSessionRef = useRef<boolean | null>(null); // null = not yet determined
  const firstUserMsgRef = useRef<string | null>(null);
  const firstExchangeFiredRef = useRef(false);

  const sendFrame = useCallback((frame: any) => {
    wsRef.current?.send(JSON.stringify(frame));
  }, []);

  const sendRequest = useCallback(
    (method: string, params: any): Promise<any> => {
      return new Promise((resolve, reject) => {
        const id = genId();
        pendingRef.current.set(id, { resolve, reject });
        sendFrame({ type: 'req', id, method, params });
        // Timeout after 30s
        setTimeout(() => {
          if (pendingRef.current.has(id)) {
            pendingRef.current.delete(id);
            reject(new Error('Request timeout'));
          }
        }, 30000);
      });
    },
    [sendFrame]
  );

  const [historyLoaded, setHistoryLoaded] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await sendRequest('chat.history', { sessionKey: effectiveSessionKey, limit: 50 });
      if (!res?.messages) return;
      const history: ChatMessage[] = res.messages.map((m: any, i: number) => ({
        id: m.id || `hist-${i}-${m.timestamp || Date.now()}`,
        role: m.role as ChatMessage['role'],
        content: extractContent(m.content),
        durableArtifact: m.durableArtifact ?? null,
        timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
      }));
      if (mountedRef.current) {
        setMessages(history);
        // Determine if this is a new (empty) session for first-exchange tracking
        if (isNewSessionRef.current === null) {
          isNewSessionRef.current = history.length === 0;
        }
      }
    } catch (e) {
      console.warn('[GatewayChat] loadHistory failed:', e);
    } finally {
      if (mountedRef.current) {
        setHistoryLoaded(true);
      }
    }
  }, [sendRequest, effectiveSessionKey]);

  const connect = useCallback(() => {
    if (!baseUrl || !token) return;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionStatus('connecting');
    // baseUrl may be a full URL (https://...) or just a hostname — normalize to wss://
    const wsUrl = baseUrl.replace(/^https?:\/\//, 'wss://').replace(/^wss?:\/\//, 'wss://');
    const finalUrl = wsUrl.startsWith('wss://') ? wsUrl : `wss://${wsUrl}`;
    console.log('[GatewayChat] connecting to:', finalUrl);
    const ws = new WebSocket(finalUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Wait for connect.challenge event
    };

    ws.onmessage = (event) => {
      let frame: any;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }

      // Handle response frames
      if (frame.type === 'res') {
        const pending = pendingRef.current.get(frame.id);
        if (pending) {
          pendingRef.current.delete(frame.id);
          if (frame.ok) {
            pending.resolve(frame.payload);
          } else {
            pending.reject(new Error(frame.error?.message || 'Request failed'));
          }
        }
        return;
      }

      // Handle event frames
      if (frame.type === 'event') {
        if (frame.event === 'connect.challenge') {
          const nonce = frame.payload?.nonce ?? '';

          const sendConnect = (device?: any) => {
            const id = genId();
            pendingRef.current.set(id, {
              resolve: () => {
                if (!mountedRef.current) return;
                setConnectionStatus('connected');
                reconnectDelay.current = 1000;
                loadHistory();
              },
              reject: (err) => {
                console.error('[GatewayChat] connect rejected:', err);
                if (mountedRef.current) setConnectionStatus('error');
              },
            });
            sendFrame({
              type: 'req',
              id,
              method: 'connect',
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: 'webchat-ui',
                  version: '1.0.0',
                  platform: Platform.OS,
                  mode: 'webchat',
                },
                role: 'operator',
                scopes: ['operator.admin', 'operator.read', 'operator.write'],
                caps: [],
                auth: { token },
                ...(device ? { device } : {}),
              },
            });
          };

          if (useDeviceAuth) {
            // BYOB: use Ed25519 device identity for operator scopes
            (async () => {
              try {
                const identity = await loadOrCreateIdentity();
                const signedAt = Date.now();
                const payloadStr = [
                  'v2',
                  identity.deviceId,
                  'webchat-ui',
                  'webchat',
                  'operator',
                  'operator.admin',
                  String(signedAt),
                  token || '',
                  nonce,
                ].join('|');
                const signature = await signPayload(identity.privateKey, payloadStr);
                sendConnect({
                  id: identity.deviceId,
                  publicKey: identity.publicKey,
                  signature,
                  signedAt,
                  nonce,
                });
              } catch (err) {
                console.error('[GatewayChat] device identity error:', err);
                // Fall back to connecting without device auth
                sendConnect();
              }
            })();
          } else {
            // Hosted: connect without device identity
            sendConnect();
          }
        } else if (frame.event === 'chat') {
          const { state, message, runId } = frame.payload ?? {};
          if (state === 'delta') {
            const msg: ChatMessage = {
              id: `streaming-${runId}`,
              role: 'assistant',
              content: extractContent(message),
              timestamp: Date.now(),
              isStreaming: true,
            };
            streamingMsgRef.current = msg;
            if (mountedRef.current) {
              setIsStreaming(true);
              setMessages((prev) => {
                const idx = prev.findIndex((m) => m.id === msg.id);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = msg;
                  return next;
                }
                return [...prev, msg];
              });
            }
          } else if (state === 'final') {
            const streamedContent = streamingMsgRef.current?.content ?? '';
            streamingMsgRef.current = null;
            if (mountedRef.current) {
              setIsStreaming(false);
              // Fire first-exchange callback if this is a new session
              if (
                onFirstExchange &&
                isNewSessionRef.current === true &&
                !firstExchangeFiredRef.current &&
                firstUserMsgRef.current
              ) {
                firstExchangeFiredRef.current = true;
                onFirstExchange(firstUserMsgRef.current, streamedContent);
              }
              loadHistory();
            }
          } else if (state === 'error' || state === 'aborted') {
            streamingMsgRef.current = null;
            if (mountedRef.current) {
              setIsStreaming(false);
              // Remove streaming message
              setMessages((prev) => prev.filter((m) => !m.isStreaming));
            }
          }
        }
      }
    };

    ws.onerror = () => {
      if (mountedRef.current) setConnectionStatus('error');
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (!mountedRef.current) return;
      setConnectionStatus('disconnected');
      // Auto-reconnect with exponential backoff
      reconnectTimer.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, reconnectDelay.current);
      reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
    };
  }, [baseUrl, token, sendFrame, loadHistory, useDeviceAuth]);

  const send = useCallback(
    (text: string) => {
      if (!text.trim() || connectionStatus !== 'connected') return;
      let message = text;
      if (caller?.name || caller?.email) {
        const name = caller.name ?? 'Unknown';
        const email = caller.email ?? 'unknown@example.com';
        const notice =
          caller.isOwner === false
            ? `[Caller: ${name} (${email}) — NOT the admin]\n\n`
            : `[Caller: ${name} (${email})]\n\n`;
        message = notice + text;
      }
      const userMsg: ChatMessage = {
        id: `user-${genId()}`,
        role: 'user',
        content: text, // show original text in UI
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      // Track first user message for new sessions
      if (isNewSessionRef.current === true && !firstUserMsgRef.current) {
        firstUserMsgRef.current = text;
      }
      sendRequest('chat.send', {
        sessionKey: effectiveSessionKey,
        message, // send prefixed message to gateway
        deliver: false,
        idempotencyKey: genId(),
      }).catch((err) => console.warn('[GatewayChat] send failed:', err));
    },
    [connectionStatus, sendRequest, caller, effectiveSessionKey]
  );

  // Connect/disconnect lifecycle
  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
      pendingRef.current.clear();
    };
  }, [connect]);

  return {
    messages,
    isConnected: connectionStatus === 'connected',
    isStreaming,
    historyLoaded,
    send,
    loadHistory,
    connectionStatus,
  };
}
