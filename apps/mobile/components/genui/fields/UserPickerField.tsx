import React, { useMemo, useState } from "react";
import { Pressable, TextInput, View, useColorScheme } from "react-native";
import { gql, useQuery } from "urql";
import { Search, X, Check } from "lucide-react-native";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useAuth } from "@/lib/auth-context";

export interface UserPickerFieldProps {
  id: string;
  label: string;
  required?: boolean;
  /** Stored value is the user's email (matches what create_sub_thread expects). */
  value: string | undefined;
  disabled?: boolean;
  onChange: (value: string) => void;
}

interface TenantMemberUser {
  id: string;
  email: string | null;
  name: string | null;
}

interface TenantMember {
  principalType: string;
  principalId: string;
  user: TenantMemberUser | null;
}

// Inline raw GraphQL query — bypasses codegen for this one-off use.
// Mirrors the agent-side `_fetch_tenant_members` query in
// packages/skill-catalog/agent-thread-management/scripts/threads.py.
const TenantUsersQuery = gql`
  query TenantUsersForFormPicker($tenantId: ID!) {
    tenantMembers(tenantId: $tenantId) {
      principalType
      principalId
      user {
        id
        email
        name
      }
    }
  }
`;

/**
 * PRD-46: User picker field for QuestionCard.
 *
 * Fetches all tenant members once, then filters client-side as the user
 * types. Stores the selected user's email so the agent can pass it
 * straight into create_sub_thread.assignee_email.
 */
export function UserPickerField({ id, label, required, value, disabled, onChange }: UserPickerFieldProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const placeholderColor = isDark ? "#737373" : "#a3a3a3";

  const { user: authUser } = useAuth();
  const tenantId = authUser?.tenantId;

  const [{ data, fetching }] = useQuery({
    query: TenantUsersQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const allUsers = useMemo<TenantMemberUser[]>(() => {
    const members = (data?.tenantMembers as TenantMember[] | undefined) ?? [];
    return members
      .map((m) => m.user)
      .filter((u): u is TenantMemberUser => !!u && !!u.email);
  }, [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allUsers.slice(0, 20);
    return allUsers
      .filter((u) =>
        (u.name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [allUsers, query]);

  const selected = useMemo(
    () => allUsers.find((u) => u.email === value) ?? null,
    [allUsers, value],
  );

  // Selected pill view (collapsed state)
  if (selected && !open) {
    return (
      <View className="mb-4">
        <Text size="xs" weight="medium" variant="muted" className="uppercase tracking-wide mb-1.5">
          {label}{required ? " *" : ""}
        </Text>
        <View
          className="flex-row items-center justify-between rounded-xl border px-3 py-3"
          style={{
            backgroundColor: isDark ? "#262626" : "#fff",
            borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)",
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <View className="flex-1 mr-2">
            <Text size="base" weight="medium">{selected.name || selected.email}</Text>
            {selected.name && (
              <Text size="xs" variant="muted">{selected.email}</Text>
            )}
          </View>
          {!disabled && (
            <Pressable
              testID={`questioncard-field-${id}-clear`}
              onPress={() => { onChange(""); setOpen(true); }}
              className="p-1 active:opacity-70"
            >
              <X size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  // Search view
  return (
    <View className="mb-4">
      <Text size="xs" weight="medium" variant="muted" className="uppercase tracking-wide mb-1.5">
        {label}{required ? " *" : ""}
      </Text>
      <View
        className="flex-row items-center rounded-xl border px-3"
        style={{
          backgroundColor: isDark ? "#262626" : "#fff",
          borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <Search size={16} color={colors.mutedForeground} />
        <TextInput
          testID={`questioncard-field-${id}`}
          value={query}
          editable={!disabled}
          onChangeText={(t) => { setQuery(t); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={fetching ? "Loading users…" : "Search by name or email"}
          placeholderTextColor={placeholderColor}
          autoCapitalize="none"
          autoCorrect={false}
          className="flex-1 py-3 pl-2 text-base"
          style={{ color: colors.foreground }}
        />
      </View>
      {open && filtered.length > 0 && (
        <View
          className="mt-1 rounded-xl overflow-hidden"
          style={{
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)",
            backgroundColor: isDark ? "#262626" : "#fff",
            maxHeight: 240,
          }}
        >
          {filtered.map((u) => (
            <Pressable
              key={u.id}
              testID={`questioncard-field-${id}-option-${u.email}`}
              onPress={() => {
                if (u.email) {
                  onChange(u.email);
                  setQuery("");
                  setOpen(false);
                }
              }}
              className="flex-row items-center justify-between px-3 py-2.5 active:opacity-70"
              style={{
                borderBottomWidth: 0.5,
                borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
              }}
            >
              <View className="flex-1">
                <Text size="sm" weight="medium">{u.name || u.email}</Text>
                {u.name && (
                  <Text size="xs" variant="muted">{u.email}</Text>
                )}
              </View>
              {value === u.email && <Check size={14} color={colors.primary} />}
            </Pressable>
          ))}
        </View>
      )}
      {open && !fetching && filtered.length === 0 && (
        <Text size="xs" variant="muted" className="mt-2 ml-1">No users match.</Text>
      )}
    </View>
  );
}

export default UserPickerField;
