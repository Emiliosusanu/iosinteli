#!/usr/bin/env node

/**
 * Persist RN 0.81.5 launch-crash guards (iOS 26 SIGSEGV in debugJavaScript).
 * RN#55533 — Debug Hermes registerForProfiling / substring DEBUG=1 hermes swap.
 */

const fs = require("fs");
const path = require("path");

const root = process.cwd();
let patched = false;

function replaceOnce(filePath, find, replace) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const source = fs.readFileSync(filePath, "utf8");
  if (source.includes(replace) && !source.includes(find)) {
    return false;
  }
  if (!source.includes(find)) {
    return false;
  }
  fs.writeFileSync(filePath, source.replace(find, replace));
  return true;
}

const hermesInstance = path.join(
  root,
  "node_modules",
  "react-native",
  "ReactCommon",
  "react",
  "runtime",
  "hermes",
  "HermesInstance.cpp",
);

if (
  replaceOnce(
    hermesInstance,
    "  void unstable_initializeOnJsThread() override {\n    runtime_->registerForProfiling();\n  }",
    "  void unstable_initializeOnJsThread() override {\n    // RN#55533 / iOS 26: Debug Hermes SIGSEGV in debugJavaScript via registerForProfiling.\n  }",
  )
) {
  patched = true;
}

if (
  replaceOnce(
    hermesInstance,
    "          .withGCConfig(gcConfig.build())\n          .withEnableSampleProfiling(true)\n          .withMicrotaskQueue(",
    "          .withGCConfig(gcConfig.build())\n          .withMicrotaskQueue(",
  )
) {
  patched = true;
}

const podspec = path.join(
  root,
  "node_modules",
  "react-native",
  "sdks",
  "hermes-engine",
  "hermes-engine.podspec",
);

if (
  replaceOnce(
    podspec,
    '        if echo $GCC_PREPROCESSOR_DEFINITIONS | grep -q "DEBUG=1"; then',
    '        if echo "$GCC_PREPROCESSOR_DEFINITIONS" | grep -Eq \'(^|[[:space:]])DEBUG=1($|[[:space:]])\'; then',
  )
) {
  patched = true;
}

if (patched) {
  console.log("[postinstall] Applied RN#55533 Hermes iOS 26 launch patches.");
}
