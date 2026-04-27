---
title: Verify Expo splash changes in a native dev build
date: 2026-04-27
category: best-practices
module: Mobile App
problem_type: best_practice
component: development_workflow
severity: low
applies_when:
  - Changing Expo splash screen, launch screen, status bar, or root background behavior.
  - Debugging a white loading screen seen while the app is bundling.
  - Verifying React Native app theme before the first React render.
tags: [expo, splash-screen, mobile, ios-simulator, dark-mode]
---

# Verify Expo splash changes in a native dev build

## Context

Expo Go can show its own white JavaScript bundling shell before the app's native launch screen and React tree are in control. That makes it a poor oracle for app-owned splash, status bar, and root background fixes.

In the mobile dark splash fix, the white screen still appeared in Expo Go even after the app config was corrected. Running the native development build with `pnpm run ios` showed the real app behavior: the generated iOS launch storyboard was dark, and a cold-launch simulator capture showed the dark ThinkWork splash.

## Guidance

Use the native development build for splash/theme verification:

```sh
cd apps/mobile
pnpm run ios
```

When config changed, refresh the generated native project before judging the result:

```sh
cd apps/mobile
pnpm exec expo prebuild --platform ios --no-install
pnpm run ios
```

Check the generated native values when the symptom is launch-time white:

```sh
plutil -p ios/ThinkWork/Info.plist | rg 'UIUserInterfaceStyle|RCTRootViewBackgroundColor'
rg -n "SplashScreenBackground|backgroundColor" \
  ios/ThinkWork/SplashScreen.storyboard \
  ios/ThinkWork/Images.xcassets/SplashScreenBackground.colorset/Contents.json
```

For a cold-launch visual check, terminate and relaunch the app from `simctl`, then capture quickly:

```sh
xcrun simctl terminate booted ai.thinkwork.agent || true
sleep 0.5
(xcrun simctl launch booted ai.thinkwork.agent >/tmp/launch.log 2>&1 &)
sleep 0.25
xcrun simctl io booted screenshot /tmp/thinkwork-splash.png
```

## Why This Matters

The native splash screen renders before JavaScript runs. Expo Go's loading shell is a development-container behavior, not necessarily the app's launch screen. Testing only through Expo Go can make a correct native configuration look broken, or hide a native launch-screen bug behind the container UI.

The app should still set the React-side background and theme from first render:

```ts
const DARK_BACKGROUND = "#070a0f";

SplashScreen.preventAutoHideAsync().catch(() => {});
SystemUI.setBackgroundColorAsync(DARK_BACKGROUND).catch(() => {});

<ThemeProvider value={NAV_THEME.dark}>
  <Stack screenOptions={{ headerShown: false }} />
</ThemeProvider>
```

Keep the native config and the first React render aligned. Otherwise the launch screen can be dark while the first mounted view flashes light, or the app can be dark after mount while the native launch screen stays white.

## When to Apply

- Any change to `expo-splash-screen`, `expo-system-ui`, `userInterfaceStyle`, `UIUserInterfaceStyle`, `StatusBar`, or app root backgrounds.
- Any report of a white splash or white flash during mobile startup.
- Any simulator test where Expo Go is still visible in the status/back affordance.

## Examples

Prefer this verification signal:

```text
› Using development build
› Opening on iPhone ... (ai.thinkwork.agent)
```

Do not treat this as final evidence for app-owned splash behavior:

```text
Expo Go
Building JavaScript bundle...
```

## Related

- [Mobile dev server instructions](/AGENTS.md#mobile-dev-server)
- [Expo mobile app config](/apps/mobile/app.json)
