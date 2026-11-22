const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// The backend lives in ../backend/convex and is shared with the web app. Watch it, and
// resolve its packages (`convex/server`...) from this app's node_modules, so the
// app bundles one copy of `convex` and needs no root install (EAS builds).
const convexDir = path.resolve(__dirname, "../backend/convex");
// ../shared (plain TS) is imported as @shared and, by the backend, by relative path.
const sharedDir = path.resolve(__dirname, "../shared");
config.watchFolders = [...(config.watchFolders ?? []), convexDir, sharedDir];
config.resolver.extraNodeModules = { "@shared": sharedDir };
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const fromConvex = context.originModulePath.startsWith(convexDir + path.sep);
  const bare = !moduleName.startsWith(".") && !path.isAbsolute(moduleName);
  const ctx = fromConvex && bare ? { ...context, originModulePath: path.join(__dirname, "index.js") } : context;
  return (resolveRequest ?? context.resolveRequest)(ctx, moduleName, platform);
};

// Keep env files (e.g. .env.prod.local with deploy keys) out of the module graph:
// the Android route context otherwise tried to bundle .env.prod.local.
config.resolver.blockList = [
  ...[config.resolver.blockList].flat(),
  /(^|[\\/])\.env(\..*)?$/,
];

module.exports = withNativeWind(config, { input: "./src/global.css", inlineRem: 16 });
