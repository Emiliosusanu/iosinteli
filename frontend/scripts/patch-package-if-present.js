#!/usr/bin/env node

const {spawnSync} = require("child_process");
const fs = require("fs");
const path = require("path");

const bin = path.join(process.cwd(), "node_modules", "patch-package", "index.js");
if (!fs.existsSync(bin)) {
  process.exit(0);
}

const result = spawnSync(process.execPath, [bin], {stdio: "inherit"});
process.exit(result.status ?? 1);
