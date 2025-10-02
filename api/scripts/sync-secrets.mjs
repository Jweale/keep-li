#!/usr/bin/env node
import { spawn } from "node:child_process";

const SECRET_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "SENTRY_DSN"];

const parseArgs = () => {
  const args = process.argv.slice(2);
  let targetEnv;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === "--env" || arg === "-e") && args[i + 1]) {
      targetEnv = args[i + 1];
      i += 1;
    }
  }
  return { targetEnv };
};

const runWrangler = (args, env = process.env) => {
  const command = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`wrangler ${args.join(" ")} exited with code ${code}`));
      } else {
        resolve();
      }
    });
    child.on("error", reject);
  });
};

const maskValue = (value) => {
  if (!value) return "<empty>";
  if (value.length <= 4) return "****";
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
};

const main = async () => {
  const { targetEnv } = parseArgs();
  const wranglerArgsBase = ["secret", "put"];

  for (const key of SECRET_KEYS) {
    const scopedName = targetEnv ? `${targetEnv.toUpperCase()}_${key}` : undefined;
    const value = scopedName && process.env[scopedName] ? process.env[scopedName] : process.env[key];

    if (!value) {
      console.log(`[skip] ${key} not provided in environment, skipping.`);
      continue;
    }

    const args = [...wranglerArgsBase, key];
    if (targetEnv) {
      args.push("--env", targetEnv);
    }
    args.push("--value", value);

    console.log(`[sync] ${key} → ${targetEnv ?? "default"} (${maskValue(value)})`);
    await runWrangler(args);
  }
};

main().catch((error) => {
  console.error("Failed to sync secrets", error);
  process.exitCode = 1;
});
