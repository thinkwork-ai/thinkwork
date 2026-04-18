/**
 * Thread detail stub.
 *
 * The prior thread detail screen combined a sub-task FlatList
 * (TaskRow), a pinned external-task header (PinnedExternalTaskHeader),
 * and a timeline fed by the external-task GenUI card registry. All of
 * that was removed as part of Phase C Task-concept removal
 * (see .prds/react-native-sdk-refactor.md §"Phase C").
 *
 * A generic thread-detail screen — message list + composer + agent
 * streaming — can be rebuilt on top of `@thinkwork/react-native-sdk`
 * hooks (useThread, useMessages, useSendMessage, useNewMessageSubscription)
 * in a follow-up commit. Stub kept so Expo Router still resolves the
 * route.
 */

import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Muted, Text } from "@/components/ui/typography";

export default function ThreadDetailScreen() {
	const { threadId } = useLocalSearchParams<{ threadId: string }>();
	return (
		<View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 12 }}>
			<Text style={{ fontSize: 18, fontWeight: "600" }}>Thread</Text>
			<Muted style={{ textAlign: "center" }}>
				Thread ID: {threadId}
			</Muted>
			<Muted style={{ textAlign: "center" }}>
				Thread detail UI is being rebuilt on the new SDK. Check back later.
			</Muted>
		</View>
	);
}
