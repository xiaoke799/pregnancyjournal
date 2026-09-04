#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const packageDir = join(rootDir, ".fnos-build", "package");
const template = JSON.parse(readFileSync(join(rootDir, "template.config.json"), "utf8"));
const errors = [];

function check(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function readJson(relativePath) {
  const filePath = join(packageDir, relativePath);
  check(existsSync(filePath), `Missing ${relativePath}`);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`Invalid JSON in ${relativePath}: ${error.message}`);
    return null;
  }
}

function pngDimensions(relativePath) {
  const filePath = join(packageDir, relativePath);
  check(existsSync(filePath), `Missing ${relativePath}`);
  if (!existsSync(filePath)) {
    return null;
  }

  const buffer = readFileSync(filePath);
  const isPng = buffer.length >= 24 && buffer.subarray(1, 4).toString("ascii") === "PNG";
  check(isPng, `${relativePath} must be a PNG file`);
  if (!isPng) {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

for (const relativePath of [
  "manifest",
  "config/privilege",
  "config/resource",
  "app",
  "cmd",
  "wizard",
  "app/ui/config",
  "app/server/serve.mjs"
]) {
  check(existsSync(join(packageDir, relativePath)), `Missing ${relativePath}`);
}

const manifestPath = join(packageDir, "manifest");
const manifest = {};
if (existsSync(manifestPath)) {
  for (const line of readFileSync(manifestPath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator > 0) {
      manifest[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
}

check(manifest.appname === template.appName, "manifest.appname does not match template config");
check(manifest.source === "thirdparty", "manifest.source must be thirdparty");
check(manifest.os_min_version === template.osMinVersion, "manifest.os_min_version is missing or stale");
check(manifest.ctl_stop === "true", "service applications must expose lifecycle controls");
check(!("service_port" in manifest), "gateway applications must not declare service_port");
check(manifest.desktop_applaunchname === template.desktopLaunchName, "desktop entry ID mismatch");

const privilege = readJson("config/privilege");
check(privilege?.defaults?.["run-as"] === "package", "config/privilege must use run-as=package");

const resource = readJson("config/resource");
check(resource && Object.keys(resource).length === 0, "starter resource declaration should be empty");

const uiConfig = readJson("app/ui/config");
const uiEntry = uiConfig?.[".url"]?.[template.desktopLaunchName];
check(uiEntry?.gatewayPrefix === template.gatewayPrefix, "gatewayPrefix mismatch");
check(uiEntry?.gatewaySocket === template.gatewaySocket, "gatewaySocket mismatch");
check(uiEntry?.url === template.gatewayPrefix, "gateway URL mismatch");
check(uiEntry?.port === undefined, "gateway entry must not declare port");

const icon64 = pngDimensions("ICON.PNG");
const icon256 = pngDimensions("ICON_256.PNG");
check(icon64?.width === 64 && icon64?.height === 64, "ICON.PNG must be 64 x 64");
check(icon256?.width === 256 && icon256?.height === 256, "ICON_256.PNG must be 256 x 256");

for (const iconSize of [64, 256]) {
  const dimensions = pngDimensions(`app/ui/images/icon_${iconSize}.png`);
  check(
    dimensions?.width === iconSize && dimensions?.height === iconSize,
    `app/ui/images/icon_${iconSize}.png has incorrect dimensions`
  );
}

for (const scriptName of [
  "main",
  "install_init",
  "install_callback",
  "upgrade_init",
  "upgrade_callback",
  "uninstall_init",
  "uninstall_callback",
  "config_init",
  "config_callback"
]) {
  const relativePath = `cmd/${scriptName}`;
  const filePath = join(packageDir, relativePath);
  check(existsSync(filePath), `Missing ${relativePath}`);
  if (existsSync(filePath)) {
    check((statSync(filePath).mode & 0o111) !== 0, `${relativePath} must be executable`);
  }
}

check(!existsSync(join(packageDir, "app/ui/index.cgi")), "gateway template must not include index.cgi");
check(!existsSync(join(packageDir, "wizard/install")), "unused install wizard should not be generated");
check(!existsSync(join(packageDir, "wizard/config")), "unused config wizard should not be generated");

const appArchivePath = join(rootDir, "dist", "app.tgz");
check(existsSync(appArchivePath), "Missing dist/app.tgz");
if (existsSync(appArchivePath) && manifest.checksum) {
  const checksum = createHash("md5").update(readFileSync(appArchivePath)).digest("hex");
  check(manifest.checksum === checksum, "manifest checksum does not match dist/app.tgz");
}

if (errors.length > 0) {
  console.error("fnOS package validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("fnOS package validation passed.");
