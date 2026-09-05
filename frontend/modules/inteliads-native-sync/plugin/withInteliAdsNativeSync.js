const {
  withInfoPlist,
  withEntitlementsPlist,
  createRunOncePlugin,
} = require("expo/config-plugins");

const REFRESH_ID = "io.inteliads.app.refresh";
const PROCESSING_ID = "io.inteliads.app.processing";
const EXPO_PROCESSING_ID = "com.expo.modules.backgroundtask.processing";
const APP_GROUP = "group.io.inteliads.app";

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

const withInteliAdsNativeSync = (config) => {
  config = withInfoPlist(config, (cfg) => {
    const modes = ensureArray(cfg.modResults.UIBackgroundModes);
    for (const mode of ["fetch", "processing", "remote-notification"]) {
      if (!modes.includes(mode)) modes.push(mode);
    }
    cfg.modResults.UIBackgroundModes = modes;

    const ids = ensureArray(cfg.modResults.BGTaskSchedulerPermittedIdentifiers);
    for (const id of [REFRESH_ID, PROCESSING_ID, EXPO_PROCESSING_ID]) {
      if (!ids.includes(id)) ids.push(id);
    }
    cfg.modResults.BGTaskSchedulerPermittedIdentifiers = ids;
    return cfg;
  });

  config = withEntitlementsPlist(config, (cfg) => {
    const groups = ensureArray(cfg.modResults["com.apple.security.application-groups"]);
    if (!groups.includes(APP_GROUP)) groups.push(APP_GROUP);
    cfg.modResults["com.apple.security.application-groups"] = groups;
    return cfg;
  });

  return config;
};

module.exports = createRunOncePlugin(
  withInteliAdsNativeSync,
  "inteliads-native-sync",
  "1.0.0",
);
