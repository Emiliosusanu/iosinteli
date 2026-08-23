#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const podspecPath = path.join(
  process.cwd(),
  "node_modules",
  "expo-constants",
  "ios",
  "EXConstants.podspec",
);
const iosConfigScriptPath = path.join(
  process.cwd(),
  "node_modules",
  "expo-constants",
  "scripts",
  "get-app-config-ios.sh",
);

const badScript =
  ':script => "bash -l -c \\"#{env_vars}$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\\"",';
const goodScript =
  ':script => "#{env_vars}bash -l \\"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\\"",';

let patched = false;

function patchSupabaseTracingBundle(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const source = fs.readFileSync(filePath, "utf8");
  const marker = "//#region ../../shared/tracing/dist/module/extract.js";
  const endMarker = "\n\n//#endregion";
  const start = source.indexOf(marker);

  if (start === -1) {
    return false;
  }

  const end = source.indexOf(endMarker, start);

  if (end === -1) {
    return false;
  }

  const block = source.slice(start, end + endMarker.length);

  if (!block.includes("@opentelemetry/api") && !block.includes("import(")) {
    return false;
  }

  const replacement = `${marker}
function extractTraceContext() {
\treturn __awaiter(this, void 0, void 0, function* () {
\t\treturn null;
\t});
}

//#endregion`;

  fs.writeFileSync(filePath, source.slice(0, start) + replacement + source.slice(end + endMarker.length));
  return true;
}

if (fs.existsSync(podspecPath)) {
  const source = fs.readFileSync(podspecPath, "utf8");

  if (!source.includes(goodScript)) {
    if (source.includes(badScript)) {
      fs.writeFileSync(podspecPath, source.replace(badScript, goodScript));
      patched = true;
    } else {
      console.warn("[postinstall] expo-constants podspec script was not recognized; skipping path patch.");
    }
  }
}

if (fs.existsSync(iosConfigScriptPath)) {
  const source = fs.readFileSync(iosConfigScriptPath, "utf8");
  const badProjectDirBasename = "PROJECT_DIR_BASENAME=$(basename $PROJECT_DIR)";
  const goodProjectDirBasename = 'PROJECT_DIR_BASENAME=$(basename "$PROJECT_DIR")';

  if (!source.includes(goodProjectDirBasename)) {
    if (source.includes(badProjectDirBasename)) {
      fs.writeFileSync(
        iosConfigScriptPath,
        source.replace(badProjectDirBasename, goodProjectDirBasename),
      );
      patched = true;
    } else {
      console.warn("[postinstall] expo-constants app config script was not recognized; skipping PROJECT_DIR patch.");
    }
  }
}

const supabaseDistFiles = [
  path.join(process.cwd(), "node_modules", "@supabase", "supabase-js", "dist", "index.cjs"),
  path.join(process.cwd(), "node_modules", "@supabase", "supabase-js", "dist", "index.mjs"),
];

for (const filePath of supabaseDistFiles) {
  if (patchSupabaseTracingBundle(filePath)) {
    patched = true;
  }
}

// Expo's dev message socket throws when a dev bundle is loaded from an embedded
// (file://) source instead of the Metro dev server, crashing the runtime with
// "Cannot create devtools websocket connections in embedded environments."
// Skip socket setup in that case instead of throwing.
function patchExpoMessageSocket(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const source = fs.readFileSync(filePath, "utf8");
  const badGuard = "if (__DEV__) {";
  const badThrow =
    "    if (!devServer.bundleLoadedFromServer) {\n" +
    "      throw new Error('Cannot create devtools websocket connections in embedded environments.');\n" +
    "    }\n\n";

  if (!source.includes(badThrow) || !source.includes(badGuard)) {
    return false;
  }

  const patched = source
    .replace(badGuard, "if (__DEV__ && getDevServer().bundleLoadedFromServer) {")
    .replace(badThrow, "");

  fs.writeFileSync(filePath, patched);
  return true;
}

const expoMessageSocketPath = path.join(
  process.cwd(),
  "node_modules",
  "expo",
  "src",
  "async-require",
  "messageSocket.native.ts",
);

if (patchExpoMessageSocket(expoMessageSocketPath)) {
  patched = true;
}

if (patched) {
  console.log("[postinstall] Applied native build compatibility patches.");
}
