import { Redirect } from "expo-router";

/** Legacy route — threads are now on the main index tab. */
export default function ThreadsRedirect() {
  return <Redirect href="/(tabs)" />;
}
