# Thinkwork Mobile

Mobile app for Thinkwork.

## EAS Account

- **Account:** <your-eas-account>
- **Project:** @thinkwork/agent
- **Bundle ID:** ai.thinkwork.agent

## Deployment

### OTA Update (JS-only changes, fast)

```bash
eas update --channel production --message "Description of changes"
```

⚠️ **Important:** Use `--channel production`, not `--branch main`. The production build is configured to pull updates from the `production` channel.

### TestFlight Build (full native build, 10-20 min)

```bash
eas build --platform ios --auto-submit
```

This will build and submit to TestFlight automatically.

## Development

```bash
pnpm install
pnpm start
```
