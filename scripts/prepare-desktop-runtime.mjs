import { createHash } from "node:crypto";
import {
  cpSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const DESKTOP_DIST = ".next-desktop";
const RUNTIME_ROOT = join(ROOT, "desktop-runtime");
const SERVER_ROOT = join(RUNTIME_ROOT, "server");
const CACHE_ROOT = join(ROOT, ".desktop-cache");
const NODE_VERSION = "24.16.0";
const NODE_PLATFORM = process.platform === "win32"
  ? "win"
  : process.platform === "darwin"
    ? "darwin"
    : null;
const NODE_ARCH = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : null;
if (!NODE_PLATFORM || !NODE_ARCH) {
  throw new Error(`Desktop runtime packaging is unsupported on ${process.platform}/${process.arch}`);
}
const NODE_FOLDER = `node-v${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}`;
const NODE_ARCHIVE = `${NODE_FOLDER}${process.platform === "win32" ? ".zip" : ".tar.gz"}`;
const NODE_BASE_URL = `https://nodejs.org/dist/v${NODE_VERSION}`;
const NODE_BINARY = process.platform === "win32" ? "node.exe" : "node";
const MAX_SERVER_BYTES = 250 * 1024 * 1024;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

function removeGenerated(path) {
  const resolved = resolve(path);
  if (!resolved.startsWith(`${ROOT}\\`) && !resolved.startsWith(`${ROOT}/`)) {
    throw new Error(`Refusing to remove path outside project: ${resolved}`);
  }
  rmSync(resolved, { recursive: true, force: true });
}

function directorySize(path) {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? directorySize(child) : statSync(child).size;
  }
  return total;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

async function prepareNodeRuntime() {
  mkdirSync(CACHE_ROOT, { recursive: true });
  const archivePath = join(CACHE_ROOT, NODE_ARCHIVE);
  const extractedRoot = join(CACHE_ROOT, NODE_FOLDER);
  const nodePath = process.platform === "win32"
    ? join(extractedRoot, "node.exe")
    : join(extractedRoot, "bin", "node");
  const licensePath = join(extractedRoot, "LICENSE");

  if (!existsSync(nodePath) || !existsSync(licensePath)) {
    if (!existsSync(archivePath)) {
      console.log(`[desktop] downloading Node.js ${NODE_VERSION} runtime`);
      await download(`${NODE_BASE_URL}/${NODE_ARCHIVE}`, archivePath);
    }

    const checksumsPath = join(CACHE_ROOT, `SHASUMS256-${NODE_VERSION}.txt`);
    if (!existsSync(checksumsPath)) {
      await download(`${NODE_BASE_URL}/SHASUMS256.txt`, checksumsPath);
    }
    const checksumLine = readFileSync(checksumsPath, "utf8")
      .split(/\r?\n/)
      .find((line) => line.endsWith(`  ${NODE_ARCHIVE}`));
    if (!checksumLine) throw new Error(`Missing checksum for ${NODE_ARCHIVE}`);
    const expected = checksumLine.split(/\s+/)[0];
    const actual = sha256(archivePath);
    if (actual !== expected) {
      rmSync(archivePath, { force: true });
      throw new Error(`Checksum mismatch for ${NODE_ARCHIVE}`);
    }

    removeGenerated(extractedRoot);
    run("tar", ["-xf", archivePath, "-C", CACHE_ROOT]);
  }

  const bundledNode = join(RUNTIME_ROOT, NODE_BINARY);
  cpSync(nodePath, bundledNode);
  if (process.platform !== "win32") chmodSync(bundledNode, 0o755);
  cpSync(licensePath, join(RUNTIME_ROOT, "NODE-LICENSE.txt"));
  return { nodePath, nodeBytes: statSync(nodePath).size };
}

function verifyStandalone() {
  const forbidden = ["src-tauri", ".git", "desktop-runtime", "tauri-ui"];
  for (const name of forbidden) {
    if (existsSync(join(SERVER_ROOT, name))) {
      throw new Error(`Standalone trace unexpectedly contains ${name}`);
    }
  }
  if (!existsSync(join(SERVER_ROOT, "server.js"))) {
    throw new Error("Next standalone output is missing server.js");
  }
  if (!existsSync(join(SERVER_ROOT, "desktop-bootstrap.cjs"))) {
    throw new Error("Desktop runtime is missing desktop-bootstrap.cjs");
  }
  const bytes = directorySize(SERVER_ROOT);
  if (bytes > MAX_SERVER_BYTES) {
    throw new Error(`Standalone server is too large: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  }
  return bytes;
}

function pruneStandalone() {
  const keep = new Set([
    DESKTOP_DIST,
    "desktop-bootstrap.cjs",
    "node_modules",
    "package.json",
    "public",
    "server.js",
  ]);
  for (const entry of readdirSync(SERVER_ROOT, { withFileTypes: true })) {
    if (!keep.has(entry.name)) {
      rmSync(join(SERVER_ROOT, entry.name), { recursive: true, force: true });
    }
  }
}

function copyNextRuntime() {
  const source = join(ROOT, DESKTOP_DIST);
  const destination = join(SERVER_ROOT, DESKTOP_DIST);
  const skip = new Set(["cache", "dev", "diagnostics", "standalone", "types"]);
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    cpSync(join(source, entry.name), join(destination, entry.name), {
      recursive: true,
      force: true,
    });
  }
}

async function main() {
  removeGenerated(RUNTIME_ROOT);
  mkdirSync(RUNTIME_ROOT, { recursive: true });
  writeFileSync(join(RUNTIME_ROOT, ".gitkeep"), "");
  const skipNextBuild = process.env.AI_USAGE_DESKTOP_SKIP_NEXT_BUILD === "1";
  if (!skipNextBuild) {
    removeGenerated(join(ROOT, DESKTOP_DIST));
    console.log(`[desktop] building Next.js into ${DESKTOP_DIST}`);
    const buildCommand = process.platform === "win32"
      ? [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm", "run", "build"]]
      : ["npm", ["run", "build"]];
    run(buildCommand[0], buildCommand[1], {
      env: { ...process.env, AI_USAGE_NEXT_DIST_DIR: DESKTOP_DIST },
    });
  } else {
    console.log(`[desktop] reusing existing ${DESKTOP_DIST} build`);
  }

  const standaloneRoot = join(ROOT, DESKTOP_DIST, "standalone");
  if (!existsSync(standaloneRoot)) {
    throw new Error(`Missing standalone output: ${relative(ROOT, standaloneRoot)}`);
  }

  mkdirSync(dirname(SERVER_ROOT), { recursive: true });
  cpSync(standaloneRoot, SERVER_ROOT, { recursive: true });
  copyNextRuntime();
  const publicDir = join(ROOT, "public");
  if (existsSync(publicDir)) cpSync(publicDir, join(SERVER_ROOT, "public"), { recursive: true });
  writeFileSync(
    join(SERVER_ROOT, "desktop-bootstrap.cjs"),
    `const parentPid = Number(process.env.AI_USAGE_PARENT_PID);\n` +
      `if (Number.isInteger(parentPid) && parentPid > 0) {\n` +
      `  setInterval(() => {\n` +
      `    try { process.kill(parentPid, 0); } catch { process.exit(0); }\n` +
      `  }, 2000);\n` +
      `}\n` +
      `require("./server.js");\n`,
  );
  pruneStandalone();

  const node = await prepareNodeRuntime();
  const serverBytes = verifyStandalone();
  const manifest = {
    builtAt: new Date().toISOString(),
    nodeVersion: NODE_VERSION,
    platform: process.platform,
    arch: process.arch,
    nodeSha256: sha256(join(RUNTIME_ROOT, NODE_BINARY)),
    nodeBytes: node.nodeBytes,
    serverBytes,
  };
  writeFileSync(join(RUNTIME_ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(RUNTIME_ROOT, ".gitkeep"), "");

  console.log(
    `[desktop] runtime ready: Node ${(node.nodeBytes / 1024 / 1024).toFixed(1)} MB, ` +
      `server ${(serverBytes / 1024 / 1024).toFixed(1)} MB`,
  );
}

await main();
