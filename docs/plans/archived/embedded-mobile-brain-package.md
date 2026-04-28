# Superseded

This PRD has been superseded by [`react-native-sdk-refactor.md`](./react-native-sdk-refactor.md).

The original direction split the embedded experience across `@thinkwork/react-native-core` + `@thinkwork/react-native-brain` and introduced thread↔entity linkage keys on the ThinkWork backend. That design leaked external provider-shaped vocabulary into ThinkWork. The replacement collapses the SDK into a hooks-only `@thinkwork/react-native-sdk` with zero shipping UI, and moves task↔thread correlation out of ThinkWork entirely (lives on the host's own schema).
