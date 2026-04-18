/**
 * Home screen stub.
 *
 * The prior home screen was heavily built around LastMile task channel
 * threads (TaskRow, useLastmileWorkflows, RetryTaskSync, executeExternalTaskAction,
 * PinnedExternalTaskHeader). All of that was removed as part of the Phase C
 * Task-concept removal in .prds/react-native-sdk-refactor.md.
 *
 * This stub is intentional — per PRD §"Phase C" verification item 6, the
 * ThinkWork-owned mobile app may "replace Task-specific UI with generic
 * chat UI or drop those screens." A proper replacement home screen (thread
 * list + agent picker + quick actions, none of which require tasks) is a
 * follow-up build; commit on top of this stub when ready.
 */

import { View } from "react-native";
import { Muted, Text } from "@/components/ui/typography";

export default function HomeScreen() {
	return (
		<View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 12 }}>
			<Text style={{ fontSize: 18, fontWeight: "600" }}>Home</Text>
			<Muted style={{ textAlign: "center" }}>
				The prior home screen is being rebuilt on the new SDK after the Task
				concept was removed from ThinkWork. Navigate via Agents / Fleet /
				Settings tabs for now.
			</Muted>
		</View>
	);
}
