import { homedir } from "node:os";
import { join } from "node:path";
import * as action from "@actions/core";
import { downloadTool, extractTar } from "@actions/tool-cache";
import * as cache from "@actions/cache";
import { restoreCache, saveCache } from "@actions/cache";
import { mv } from "@actions/io";
import { getExecOutput } from "@actions/exec";

export default async (
  options
): Promise<{
  version: string;
  cacheHit: boolean;
}> => {
  // throw error on unsupported platforms (windows)
  if (process.platform === "win32") {
    throw new Error("Crosup is not supported on Windows");
  }

  const { url, cacheKey } = getDownloadUrl({
    version: options.version,
  });
  const cacheEnabled = cacheKey && cache.isFeatureAvailable();
  const dir = join(homedir(), ".crosup", "bin");
  action.addPath(dir);
  const path = join(dir, "crosup");
  let version: string | undefined;
  let cacheHit = false;

  if (cacheEnabled) {
    const cacheRestored = await restoreCache([dir], cacheKey);
    if (cacheRestored) {
      version = await verifyCrosup(path);
      if (version) {
        cacheHit = true;
        action.info(`Crosup ${version} restored from cache`);
      } else {
        action.warning(
          "Found a cached version of Crosup, but it appears to be corrupted? Attempting to download a new version."
        );
      }
    }
  }

  if (!cacheHit) {
    action.info(`Downloading a new version of Crosup: ${url}`);
    const tarPath = await downloadTool(url);
    const extractedPath = await extractTar(tarPath);
    const exePath = join(extractedPath, "crosup");
    await mv(exePath, path);
    version = await verifyCrosup(path);
  }
  if (!version) {
    throw new Error("Unable to verify the downloaded version of Crosup");
  }
  if (cacheEnabled) {
    try {
      await saveCache([path], cacheKey);
    } catch (error) {
      action.warning(
        `Failed to save the downloaded version of Crosup to the cache: ${error.message}`
      );
    }
  }

  if (options.packages.length > 0) {
    action.info(`Installing packages: ${options.packages.join(", ")}`);
    await getExecOutput(path, ["install", ...options.packages]);
  }

  return {
    version,
    cacheHit,
  };
};

function getDownloadUrl(options?: {
  version?: string;
  os?: string;
  arch?: string;
}): { url: string; cacheKey: string } {
  const release = encodeURIComponent(options?.version ?? "v0.4.8");
  const platform = {
    darwin: "apple-darwin",
    linux: "unknown-linux-gnu",
  };
  const os = encodeURIComponent(options?.os ?? platform[process.platform]);
  const arch = encodeURIComponent(options?.arch ?? process.arch);
  const cpu = {
    x64: "x86_64",
  };
  const { href } = new URL(
    `${release}/crosup_${release}_${cpu[arch] || arch}-${os}.tar.gz`,
    "https://github.com/tsirysndr/crosup/releases/download/"
  );

  return {
    url: href,
    cacheKey: `crosup-${release}-${arch}-${platform}`,
  };
}

async function verifyCrosup(path: string): Promise<string | undefined> {
  const { exitCode, stdout } = await getExecOutput(path, ["--version"], {
    ignoreReturnCode: true,
  });
  return exitCode === 0 ? stdout.trim() : undefined;
}
