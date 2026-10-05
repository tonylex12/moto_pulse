# Native setup for MotoPulse

[Back to the project README](../README.md)

This guide describes setup still needed to evaluate native GPS and push. Start
with the [local backend and mobile instructions](../README.md#run-locally), including
both environment files and a backend URL reachable from your device. Commands
below start from the repository root. They are setup instructions, not changes
already applied to the checked-in app.

## Development builds

Use a native development build for the full device workflow. Expo Go is not a
complete test environment: TaskManager/background location has platform limits,
and remote notifications are unavailable in Android Expo Go from SDK 53.
See [Expo TaskManager](https://docs.expo.dev/versions/v57.0.0/sdk/task-manager/)
and [Expo Notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/).

The repository has native build scripts but does not currently include
`expo-dev-client` or an `eas.json` development profile. To set up a development
client in your local checkout, follow [Expo's development build guide](https://docs.expo.dev/develop/development-builds/introduction/).
The local path is:

```sh
cd mobile
npx expo install expo-dev-client
npx expo run:android --device
# Or, on macOS with Xcode and device signing configured:
npx expo run:ios --device
# For later JavaScript-only sessions:
npx expo start --dev-client
```

These setup commands generate native projects and can change local dependencies;
they are instructions, not configuration already added to this repository.
Rebuild the native binary after changing native dependencies or app plugins.

## Background GPS

For background GPS, grant foreground and background location permissions, enable
device location services, and use a physical device to evaluate actual rides.
Android background location and foreground service flags are already configured.
For iOS, the current app configuration does **not** enable
`isIosBackgroundLocationEnabled`: enable it in the `expo-location` plugin and
rebuild before testing background tracking. iOS also requires Always location
permission. The task is defined at module scope in `hooks/useLocation.ts`.
The hook falls back to foreground tracking when background tracking cannot start.
Tracking after app termination is subject to OS restrictions.
See [Expo Location configuration](https://docs.expo.dev/versions/v57.0.0/sdk/location/).

## Remote push

For remote push, follow [Expo's push setup guide](https://docs.expo.dev/push-notifications/push-notifications-setup/):
associate your own EAS project, configure FCM/APNs credentials for the target
platform, add the `expo-notifications` plugin and rebuild. The checked-in
`app.json` has neither that plugin nor `extra.eas.projectId`; the hook reads
`extra.eas.projectId` or `Constants.easConfig.projectId` to request an Expo token.
MotoPulse's hook explicitly skips registration on nonphysical devices, regardless
of simulator support in Expo. Grant notification permission, sign in, and open
the dashboard to register the token with the backend. This setup is required
before evaluating real push delivery; backend tests use simulated sends.


Android push registration currently creates its notification channel after
requesting permission/token. Review that order before evaluating Android 13+
registration; Expo's setup example creates the channel first. Do not interpret a
passing simulated backend push test as evidence of real device delivery.
