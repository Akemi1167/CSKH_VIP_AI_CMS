import { execFileSync, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadConfigFromFile } from "vite";

const loaded = await loadConfigFromFile({ command: "serve", mode: "development" });
const port = loaded?.config.server?.port ?? 5174;

function listeningPids(target) {
  try {
    const output = execFileSync("lsof", ["-nP", `-iTCP:${target}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    });
    return [...new Set(output.split("\n").map((line) => line.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

async function freePort(target) {
  let pids = listeningPids(target).filter((pid) => pid !== String(process.pid));
  if (pids.length === 0) return;

  console.log(`Cổng ${target} đang được dùng bởi tiến trình ${pids.join(", ")}. Dừng rồi khởi động lại.`);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // Tiến trình đã thoát.
    }
  }

  for (let attempt = 0; attempt < 20 && pids.length > 0; attempt += 1) {
    await delay(100);
    pids = listeningPids(target);
  }

  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGKILL");
    } catch {
      // Tiến trình đã thoát.
    }
  }

  if (pids.length > 0) await delay(100);
  const left = listeningPids(target);
  if (left.length > 0) {
    console.error(`Không giải phóng được cổng ${target} (pid ${left.join(", ")}).`);
    process.exit(1);
  }
}

await freePort(port);

const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const child = spawn(process.execPath, [viteBin], { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
