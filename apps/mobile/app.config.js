// Adds the web platform only for demo previews (EXPO_PUBLIC_DEMO=1), which
// render the screens in a browser with a fake host. The real app is Android/iOS.
module.exports = ({ config }) => ({
  ...config,
  platforms: process.env.EXPO_PUBLIC_DEMO ? [...config.platforms, "web"] : config.platforms,
});
