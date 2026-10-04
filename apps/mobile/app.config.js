// Adds the web platform only for demo previews (EXPO_PUBLIC_DEMO=1), which
// render the screens in a browser with a fake host. The real app is Android/iOS.
//
// Cloud builds go to your own EAS project: set EAS_PROJECT_ID (and EAS_OWNER if
// it belongs to an organization). On EAS's build servers EAS_BUILD_PROJECT_ID is set.
const projectId = process.env.EAS_PROJECT_ID || process.env.EAS_BUILD_PROJECT_ID;

module.exports = ({ config }) => ({
  ...config,
  platforms: process.env.EXPO_PUBLIC_DEMO ? [...config.platforms, "web"] : config.platforms,
  ...(process.env.EAS_OWNER && { owner: process.env.EAS_OWNER }),
  extra: { ...config.extra, ...(projectId && { eas: { ...config.extra?.eas, projectId } }) },
});
