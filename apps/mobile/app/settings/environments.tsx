import { ScrollView } from "react-native";
import { DetailLayout } from "@/components/layout/detail-layout";
import { EnvironmentPicker } from "@/components/environments/EnvironmentPicker";

export default function EnvironmentsSettingsScreen() {
  return (
    <DetailLayout title="Environments">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <EnvironmentPicker presentation="screen" />
      </ScrollView>
    </DetailLayout>
  );
}
