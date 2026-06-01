# Employee Agent iOS Shell

This is a minimal Capacitor iOS shell for loading the existing Employee Agent web app from an HTTPS origin.

## Prerequisites

- macOS with Xcode installed
- iPhone connected to the Mac
- Node.js 22 or newer
- pnpm

## First Run

From the repository root on your Mac:

```bash
pnpm --dir apps/ios install
LINGXIA_IOS_SERVER_URL="https://your-local-https-domain" pnpm --dir apps/ios cap:sync
LINGXIA_IOS_SERVER_URL="https://your-local-https-domain" pnpm --dir apps/ios cap:open
```

The `ios/` project is already checked in. Run `cap:add:ios` only if you intentionally delete and regenerate the native project.

In Xcode:

1. Select the `App` target.
2. Set your Apple account Team.
3. Change Bundle Identifier if needed.
4. Select your iPhone as the run target.
5. Run.

## Notes

- The shell loads `LINGXIA_IOS_SERVER_URL` directly, so the existing web deployment remains the source of UI and backend behavior.
- Use a trusted HTTPS certificate on the server URL. Do not use self-signed certificates for the first validation pass.
- Keep app-specific UI changes scoped under a Capacitor/iOS marker later, so browser UI remains unchanged.
