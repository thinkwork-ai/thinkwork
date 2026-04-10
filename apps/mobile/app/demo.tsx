import { View, ScrollView, Pressable } from "react-native";
import { useColorScheme } from "nativewind";
import { Moon, Sun } from "lucide-react-native";
import { COLORS } from "@/lib/theme";
import { DataTable, Column } from "@/components/ui/data-table";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Text, H2, Muted } from "@/components/ui/typography";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Laptop, Cloud } from "lucide-react-native";
import { useIsLargeScreen } from "@/lib/hooks/use-media-query";

// Mock data matching the admin dashboard's assistants page
const mockGateways = [
  {
    _id: "1",
    name: "Eric's Mac mini",
    type: "local",
    isDefault: true,
    connectionStatus: "online",
    lastHeartbeatAt: Date.now() - 1000 * 60,
    lastSyncedAt: Date.now() - 1000 * 60 * 5,
  },
  {
    _id: "2", 
    name: "Production Bot",
    type: "cloud",
    isDefault: false,
    connectionStatus: "online",
    lastHeartbeatAt: Date.now() - 1000 * 60 * 2,
    lastSyncedAt: Date.now() - 1000 * 60 * 10,
  },
  {
    _id: "3",
    name: "Dev Bot",
    type: "cloud",
    isDefault: false,
    connectionStatus: "offline",
    lastHeartbeatAt: Date.now() - 1000 * 60 * 60,
    lastSyncedAt: Date.now() - 1000 * 60 * 60 * 2,
  },
  {
    _id: "4",
    name: "Amy's iPhone",
    type: "local",
    isDefault: false,
    connectionStatus: "offline",
    lastHeartbeatAt: null,
    lastSyncedAt: null,
  },
];

type Gateway = typeof mockGateways[0];

function TypeBadge({ type }: { type?: string }) {
  if (type === "local") {
    return (
      <Badge variant="outline" icon={<Laptop size={12} color="#737373" />}>
        Local
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" icon={<Cloud size={12} color="#525252" />}>
      Cloud
    </Badge>
  );
}

function ConnectionBadge({ status, lastHeartbeat }: { status?: string; lastHeartbeat?: number | null }) {
  const now = Date.now();
  const isStale = lastHeartbeat && now - lastHeartbeat > 5 * 60 * 1000;

  if (status === "revoked") return <StatusBadge status="revoked" />;
  if (status === "online" && !isStale) return <StatusBadge status="online" />;
  return <StatusBadge status="offline" />;
}

export default function DemoScreen() {
  const isLargeScreen = useIsLargeScreen();
  const { colorScheme, setColorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;

  const toggleTheme = () => setColorScheme(isDark ? "light" : "dark");

  const columns: Column<Gateway>[] = [
    {
      key: "name",
      header: "Name",
      flex: 2,
      minWidth: 200,
      render: (item) => (
        <View className="flex-row items-center gap-2">
          <Text className="text-sm font-medium">{item.name}</Text>
          {item.isDefault && <Badge variant="secondary">Default</Badge>}
        </View>
      ),
    },
    {
      key: "type",
      header: "Type",
      flex: 1,
      minWidth: 100,
      render: (item) => <TypeBadge type={item.type} />,
    },
    {
      key: "status",
      header: "Status",
      flex: 1,
      minWidth: 100,
      render: (item) => (
        <ConnectionBadge
          status={item.connectionStatus}
          lastHeartbeat={item.lastHeartbeatAt}
        />
      ),
    },
    {
      key: "lastSync",
      header: "Last sync",
      flex: 1.5,
      minWidth: 150,
      render: (item) => (
        <Muted className="text-sm">
          {item.lastSyncedAt
            ? new Date(item.lastSyncedAt).toLocaleString()
            : "Never"}
        </Muted>
      ),
    },
  ];

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-neutral-950"
      contentContainerStyle={{ padding: isLargeScreen ? 24 : 16 }}
    >
      <View className="mb-6 flex-row items-start justify-between">
        <View>
          <H2>DataTable Demo</H2>
          <Muted className="mt-1">
            Testing the table component — resize window to see responsive behavior
          </Muted>
        </View>
        <Pressable
          onPress={toggleTheme}
          className="w-10 h-10 items-center justify-center rounded-lg bg-secondary active:bg-secondary/80"
        >
          {isDark ? (
            <Sun size={20} color={colors.foreground} />
          ) : (
            <Moon size={20} color={colors.foreground} />
          )}
        </Pressable>
      </View>

      {/* Stats cards */}
      <View className="flex-row flex-wrap gap-4 mb-6">
        <Card className="flex-1 min-w-[140px]">
          <CardHeader className="pb-2">
            <Muted className="text-xs uppercase tracking-wider">Total</Muted>
          </CardHeader>
          <CardContent>
            <Text className="text-3xl font-bold">4</Text>
          </CardContent>
        </Card>
        <Card className="flex-1 min-w-[140px]">
          <CardHeader className="pb-2">
            <Muted className="text-xs uppercase tracking-wider">Online</Muted>
          </CardHeader>
          <CardContent>
            <Text className="text-3xl font-bold text-green-600">2</Text>
          </CardContent>
        </Card>
        <Card className="flex-1 min-w-[140px]">
          <CardHeader className="pb-2">
            <Muted className="text-xs uppercase tracking-wider">Offline</Muted>
          </CardHeader>
          <CardContent>
            <Text className="text-3xl font-bold text-muted-foreground">2</Text>
          </CardContent>
        </Card>
      </View>

      {/* The table */}
      <DataTable
        data={mockGateways}
        columns={columns}
        keyExtractor={(item) => item._id}
        onRowPress={(item) => console.log("Clicked:", item.name)}
      />

      {/* Card layout preview */}
      <View className="mt-8">
        <H2 className="mb-4">Card Layout (for narrow screens)</H2>
        {mockGateways.slice(0, 2).map((gateway) => (
          <Card key={gateway._id} className="mb-3">
            <CardContent className="pt-4">
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <View className="flex-row items-center gap-2 flex-wrap">
                    <Text className="text-base font-medium">{gateway.name}</Text>
                    {gateway.isDefault && <Badge variant="secondary">Default</Badge>}
                  </View>
                  <Muted className="mt-1 text-sm">
                    {gateway.lastSyncedAt
                      ? `Last sync: ${new Date(gateway.lastSyncedAt).toLocaleString()}`
                      : "Never synced"}
                  </Muted>
                </View>
                <View className="items-end gap-1.5">
                  <TypeBadge type={gateway.type} />
                  <ConnectionBadge
                    status={gateway.connectionStatus}
                    lastHeartbeat={gateway.lastHeartbeatAt}
                  />
                </View>
              </View>
            </CardContent>
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}
