"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/shared/processManager.js
var require_processManager = __commonJS({
  "src/shared/processManager.js"(exports2, module2) {
    "use strict";
    var cp = require("child_process");
    var path = require("path");
    var createProcessManager = (jobLog, dbg) => {
      const activeChildren = /* @__PURE__ */ new Set();
      const ppidWatchers = [];
      const killAll = () => {
        dbg(`[KILL] killAll called  activeChildren=${activeChildren.size}`);
        for (const child of activeChildren) {
          try {
            if (!child.killed) {
              dbg(`[KILL] SIGTERM -> pgid=${child.pid}`);
              try {
                process.kill(-child.pid, "SIGTERM");
              } catch (_) {
              }
              child.kill("SIGTERM");
            }
          } catch (_) {
          }
        }
        setTimeout(() => {
          for (const child of activeChildren) {
            try {
              if (!child.killed) {
                dbg(`[KILL] SIGKILL -> pgid=${child.pid}`);
                try {
                  process.kill(-child.pid, "SIGKILL");
                } catch (_) {
                }
                child.kill("SIGKILL");
              }
            } catch (_) {
            }
          }
        }, 3e3);
      };
      const startPpidWatcher = (encoderPid) => {
        const workerPid = process.pid;
        const script = [
          `while kill -0 ${workerPid} 2>/dev/null; do sleep 2; done;`,
          `kill -TERM -${encoderPid} 2>/dev/null;`,
          `sleep 3;`,
          `kill -KILL -${encoderPid} 2>/dev/null`
        ].join(" ");
        const watcher = cp.spawn("bash", ["-c", script], {
          detached: true,
          stdio: "ignore"
        });
        watcher.unref();
        ppidWatchers.push(watcher);
        dbg(`[WATCHDOG] ppid-watcher pid=${watcher.pid}  worker=${workerPid}  encoder-pgid=${encoderPid}`);
      };
      const stopPpidWatchers = () => {
        for (const w of ppidWatchers) {
          try {
            w.kill("SIGTERM");
          } catch (_) {
          }
        }
        ppidWatchers.length = 0;
        dbg("[WATCHDOG] ppid-watchers cancelled");
      };
      const spawnAsync = (bin, spawnArgs, opts) => {
        opts = opts || {};
        return new Promise((resolve) => {
          dbg(`> ${path.basename(bin)} ${spawnArgs.slice(0, 6).join(" ")}${spawnArgs.length > 6 ? " ..." : ""}`);
          const child = cp.spawn(bin, spawnArgs, {
            env: opts.env || process.env,
            cwd: opts.cwd || void 0,
            stdio: ["ignore", "pipe", "pipe"],
            detached: true
          });
          child.unref();
          activeChildren.add(child);
          if (opts.onSpawn) opts.onSpawn(child.pid);
          const silentBuf = [];
          let lastLine = "";
          const handleData = (data) => {
            const text = data.toString();
            const lines = (lastLine + text).split(/[\r\n]/);
            lastLine = lines.pop();
            for (const line of lines) {
              const l = line.trim();
              if (!l) continue;
              if (opts.onLine) opts.onLine(l);
              if (opts.filter && !opts.filter(l)) continue;
              if (opts.silent) {
                silentBuf.push(l);
              } else {
                jobLog(l);
              }
            }
          };
          child.stdout.on("data", handleData);
          child.stderr.on("data", handleData);
          child.on("close", (code, signal) => {
            activeChildren.delete(child);
            if (lastLine.trim()) {
              const l = lastLine.trim();
              if (opts.onLine) opts.onLine(l);
              if (!opts.filter || opts.filter(l)) {
                if (opts.silent) {
                  silentBuf.push(l);
                } else {
                  jobLog(l);
                }
              }
            }
            const exitCode = code !== null ? code : signal ? 1 : 0;
            if (opts.silent && exitCode !== 0) {
              silentBuf.forEach((l) => jobLog(l));
            }
            dbg(`< ${path.basename(bin)} exited ${exitCode}${signal ? ` (signal ${signal})` : ""}`);
            resolve(exitCode);
          });
          child.on("error", (err) => {
            activeChildren.delete(child);
            jobLog(`ERROR spawning ${path.basename(bin)}: ${err.message}`);
            resolve(1);
          });
        });
      };
      let cancelHandler = null;
      const installCancelHandler = (onCancel) => {
        cancelHandler = () => {
          jobLog("[AV1] job cancelled -- killing encoder children");
          stopPpidWatchers();
          killAll();
          if (onCancel) onCancel();
          process.exit(1);
        };
        process.once("SIGTERM", cancelHandler);
        process.once("SIGINT", cancelHandler);
        process.once("disconnect", cancelHandler);
      };
      const removeCancelHandler = () => {
        if (cancelHandler) {
          process.off("SIGTERM", cancelHandler);
          process.off("SIGINT", cancelHandler);
          process.off("disconnect", cancelHandler);
          cancelHandler = null;
        }
      };
      const cleanup = () => {
        stopPpidWatchers();
        killAll();
        removeCancelHandler();
      };
      return {
        spawnAsync,
        startPpidWatcher,
        stopPpidWatchers,
        killAll,
        installCancelHandler,
        removeCancelHandler,
        cleanup
      };
    };
    module2.exports = { createProcessManager };
  }
});

// src/shared/logger.js
var require_logger = __commonJS({
  "src/shared/logger.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path = require("path");
    var createLogger = (tdarrJobLog, workDir) => {
      const debugLogPath = path.join(workDir, "av1-debug.log");
      const jobLog = (msg) => {
        if (typeof tdarrJobLog === "function") tdarrJobLog(msg);
        else console.log(`[AV1] ${msg}`);
      };
      const dbg = (msg) => {
        const line = `[DBG ${(/* @__PURE__ */ new Date()).toISOString()}] ${msg}
`;
        try {
          fs.appendFileSync(debugLogPath, line);
        } catch (_) {
        }
      };
      const flush = () => {
      };
      return { jobLog, dbg, debugLogPath, flush };
    };
    var humanSize = (bytes) => {
      if (bytes <= 0) return "0 B";
      const gib = bytes / 1024 ** 3;
      if (gib >= 1) return `${gib.toFixed(2)} GiB`;
      return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
    };
    module2.exports = { createLogger, humanSize };
  }
});

// src/opusAudio/index.js
function parseBitrateMap(str) {
  const map = {};
  String(str || "").split(",").forEach((pair) => {
    const [c, k] = pair.split("=");
    const ci = parseInt((c || "").trim(), 10);
    const ki = parseInt((k || "").trim(), 10);
    if (ci > 0 && ki > 0) map[ci] = ki;
  });
  return map;
}
var details = () => ({
  name: "Opus Audio (channel-scaled)",
  description: [
    "Transcodes every audio track to Opus, preserving each track's channel count and layout,",
    "with the target bitrate chosen per channel count. Video and subtitles are copied untouched.",
    "Tracks already Opus at/below their target bitrate are left as-is (whole file passes through",
    "unchanged if every track already qualifies)."
  ].join(" "),
  style: { borderColor: "orange" },
  tags: "audio,opus,libopus,transcode,channels",
  isStartPlugin: false,
  pType: "",
  requiresVersion: "2.00.01",
  sidebarPosition: -1,
  icon: "faVolumeHigh",
  inputs: [
    {
      label: "Bitrate by Channels (kbps)",
      name: "bitrate_map",
      type: "string",
      defaultValue: "1=64,2=128,6=256,8=320",
      inputUI: { type: "text" },
      tooltip: `channels=kbps pairs used to pick each track's Opus bitrate from its channel count, e.g. "1=64,2=128,6=256,8=320" (6=5.1, 8=7.1). Channel counts not listed use Per-Channel Fallback.`
    },
    {
      label: "Per-Channel Fallback (kbps)",
      name: "per_channel_kbps",
      type: "number",
      defaultValue: "48",
      inputUI: { type: "text" },
      tooltip: "For channel counts not in the map: bitrate = channels x this value (e.g. 48 -> 5.1/6ch = 288k)."
    },
    {
      label: "Skip If Already Opus At Target",
      name: "skip_if_opus",
      type: "boolean",
      defaultValue: "true",
      inputUI: { type: "switch" },
      tooltip: "If every audio track is already Opus at or below its target bitrate, pass the file through untouched (output 2)."
    }
  ],
  outputs: [
    { number: 1, tooltip: "Audio transcoded to Opus (video + subtitles copied)" },
    { number: 2, tooltip: "No change needed \u2014 all audio already Opus at target" }
  ]
});
var plugin = async (args) => {
  const fs = require("fs");
  const path = require("path");
  const { createProcessManager } = require_processManager();
  const { createLogger } = require_logger();
  const inputs = args.inputs || {};
  const map = parseBitrateMap(inputs.bitrate_map || "1=64,2=128,6=256,8=320");
  const perCh = Number(inputs.per_channel_kbps) || 48;
  const skipIfOpus = inputs.skip_if_opus === void 0 ? true : inputs.skip_if_opus === true || inputs.skip_if_opus === "true";
  const { jobLog, dbg } = createLogger(args.jobLog, args.workDir);
  const file = args.inputFileObj;
  const inputPath = file._id;
  const streams = file.ffProbeData && file.ffProbeData.streams || [];
  const audio = streams.filter((s) => s.codec_type === "audio");
  const updateWorker = (f) => {
    if (typeof args.updateWorker === "function") {
      try {
        args.updateWorker(f);
      } catch (_) {
      }
    }
  };
  if (audio.length === 0) {
    jobLog("[opus] no audio tracks \u2014 passing through");
    return { outputFileObj: file, outputNumber: 2, variables: args.variables };
  }
  const targetKbps = (ch) => map[ch] || Math.max(48, ch * perCh);
  let allOk = true;
  const plan = audio.map((s) => {
    const ch = s.channels || 2;
    const tgt = targetKbps(ch);
    const isOpus = (s.codec_name || "").toLowerCase() === "opus";
    const curKbps = s.bit_rate ? Math.round(parseInt(s.bit_rate, 10) / 1e3) : null;
    const ok = isOpus && (curKbps == null || curKbps <= tgt + 8);
    if (!ok) allOk = false;
    return { ch, tgt, isOpus };
  });
  if (skipIfOpus && allOk) {
    jobLog("[opus] all audio already Opus at/below target \u2014 passing through");
    return { outputFileObj: file, outputNumber: 2, variables: args.variables };
  }
  const FFMPEG = ["/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"].find((p) => fs.existsSync(p)) || "ffmpeg";
  const outputPath = path.join(args.workDir, `${path.parse(inputPath).name}.opus.mkv`);
  const ffargs = ["-hide_banner", "-y", "-i", inputPath, "-map", "0", "-c", "copy", "-c:a", "libopus"];
  plan.forEach((p, ai) => {
    ffargs.push(`-b:a:${ai}`, `${p.tgt}k`);
    if (p.ch > 2) ffargs.push(`-mapping_family:a:${ai}`, "1");
    jobLog(`  audio[${ai}]: ${p.ch}ch -> Opus ${p.tgt}k${p.isOpus ? " (re-encoding existing Opus)" : ""}`);
  });
  ffargs.push(outputPath);
  jobLog(`[opus] ffmpeg ${ffargs.map((a) => /\s/.test(a) ? `"${a}"` : a).join(" ")}`);
  updateWorker({ status: "Opus Audio" });
  const pm = createProcessManager(jobLog, dbg);
  const exit = await pm.spawnAsync(FFMPEG, ffargs, { silent: true });
  pm.cleanup();
  if (exit !== 0 || !fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    throw new Error(`Opus audio transcode failed (ffmpeg exit ${exit})`);
  }
  updateWorker({ percentage: 100 });
  jobLog("[opus] audio transcoded to Opus");
  return {
    outputFileObj: Object.assign({}, file, { _id: outputPath, file: outputPath }),
    outputNumber: 1,
    variables: args.variables
  };
};
module.exports = { details, plugin, parseBitrateMap };
