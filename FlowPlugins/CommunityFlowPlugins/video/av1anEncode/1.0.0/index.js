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

// src/shared/encoderFlags.js
var require_encoderFlags = __commonJS({
  "src/shared/encoderFlags.js"(exports2, module2) {
    "use strict";
    var primTable = {
      bt709: { aom: "bt709", svt: 1 },
      bt470m: { aom: "bt470m", svt: 4 },
      bt470bg: { aom: "bt470bg", svt: 5 },
      smpte170m: { aom: "smpte170m", svt: 6 },
      smpte240m: { aom: "smpte240m", svt: 7 },
      film: { aom: "film", svt: 8 },
      bt2020: { aom: "bt2020", svt: 9 },
      smpte428: { aom: "smpte428", svt: 10 },
      smpte431: { aom: "smpte431", svt: 11 },
      smpte432: { aom: "smpte432", svt: 12 }
    };
    var transTable = {
      bt709: { aom: "bt709", svt: 1 },
      bt470m: { aom: "bt470m", svt: 4 },
      bt470bg: { aom: "bt470bg", svt: 5 },
      smpte170m: { aom: "smpte170m", svt: 6 },
      smpte240m: { aom: "smpte240m", svt: 7 },
      linear: { aom: "linear", svt: 8 },
      log100: { aom: "log100", svt: 9 },
      log316: { aom: "log316", svt: 10 },
      iec61966: { aom: "iec61966", svt: 12 },
      "bt2020-10": { aom: "bt2020-10bit", svt: 14 },
      "bt2020-12": { aom: "bt2020-12bit", svt: 15 },
      smpte2084: { aom: "smpte2084", svt: 16 },
      smpte428: { aom: "smpte428", svt: 17 },
      "arib-std-b67": { aom: "arib-std-b67", svt: 18 }
    };
    var matTable = {
      bt709: { aom: "bt709", svt: 1 },
      fcc: { aom: "fcc73", svt: 4 },
      bt470bg: { aom: "bt470bg", svt: 5 },
      smpte170m: { aom: "smpte170m", svt: 6 },
      smpte240m: { aom: "smpte240m", svt: 7 },
      bt2020nc: { aom: "bt2020ncl", svt: 9 },
      bt2020ncl: { aom: "bt2020ncl", svt: 9 },
      bt2020c: { aom: "bt2020cl", svt: 10 },
      bt2020cl: { aom: "bt2020cl", svt: 10 },
      smpte2085: { aom: "smpte2085", svt: 11 },
      "chroma-derived-ncl": { aom: "chroma-derived-ncl", svt: 12 },
      "chroma-derived-cl": { aom: "chroma-derived-cl", svt: 13 },
      ictcp: { aom: "ictcp", svt: 14 }
    };
    var chromaTable = {
      left: { svt: 1 },
      topleft: { svt: 2 }
    };
    var detectHdrMeta = (stream) => {
      const prim = primTable[stream.color_primaries];
      const trans = transTable[stream.color_transfer];
      const matrix = matTable[stream.color_space];
      const chroma = chromaTable[stream.chroma_location];
      let hdrAom = "";
      let hdrSvt = "";
      if (prim && trans && matrix) {
        hdrAom = `--color-primaries=${prim.aom} --transfer-characteristics=${trans.aom} --matrix-coefficients=${matrix.aom}`;
        hdrSvt = [
          `--color-primaries ${prim.svt}`,
          `--transfer-characteristics ${trans.svt}`,
          `--matrix-coefficients ${matrix.svt}`,
          chroma ? `--chroma-sample-position ${chroma.svt}` : ""
        ].filter(Boolean).join(" ");
      }
      return { prim, trans, matrix, chroma, hdrAom, hdrSvt };
    };
    var buildAomFlags = (preset, hdrAom) => {
      return [
        "--end-usage=q",
        `--cpu-used=${preset}`,
        "--tune=ssim",
        "--enable-fwd-kf=0",
        "--disable-kf",
        "--kf-max-dist=9999",
        "--enable-qm=1",
        "--bit-depth=10",
        "--lag-in-frames=48",
        "--tile-columns=0",
        "--tile-rows=0",
        "--sb-size=dynamic",
        "--deltaq-mode=0",
        "--aq-mode=0",
        "--arnr-strength=1",
        "--arnr-maxframes=4",
        "--enable-chroma-deltaq=1",
        "--enable-dnl-denoising=0",
        "--disable-trellis-quant=0",
        "--quant-b-adapt=1",
        "--enable-keyframe-filtering=1",
        hdrAom
      ].filter(Boolean).join(" ");
    };
    var svtConfig = (preset, hdrSvt) => {
      const entries = [
        ["rc", "0"],
        ["preset", String(preset)],
        ["tune", "1"],
        ["input-depth", "10"],
        ["lookahead", "48"],
        ["keyint", "-1"],
        ["irefresh-type", "2"],
        ["enable-overlays", "1"],
        ["enable-variance-boost", "1"],
        ["variance-boost-strength", "2"],
        ["variance-octile", "6"],
        ["enable-qm", "1"],
        ["qm-min", "0"],
        ["qm-max", "15"],
        ["chroma-qm-min", "8"],
        ["chroma-qm-max", "15"],
        ["tf-strength", "1"],
        ["sharpness", "1"],
        ["tile-columns", "1"],
        ["scm", "0"]
      ];
      return { entries, hdrSvt };
    };
    var formatSvtForAv1an = ({ entries, hdrSvt }) => entries.map(([k, v]) => `--${k} ${v}`).concat(hdrSvt || []).filter(Boolean).join(" ");
    var formatSvtForAbAv1 = ({ entries }) => entries.map(([k, v]) => `--svt ${k}=${v}`).join(" ");
    var buildSvtFlags = (preset, hdrSvt, extra = "") => [formatSvtForAv1an(svtConfig(preset, hdrSvt)), extra].filter(Boolean).join(" ");
    var buildAbAv1SvtFlags = (extra = "") => {
      const cfg = svtConfig(0, "");
      const skip = /* @__PURE__ */ new Set(["rc", "preset", "input-depth", "keyint"]);
      const filtered = { entries: cfg.entries.filter(([k]) => !skip.has(k)), hdrSvt: "" };
      return [formatSvtForAbAv1(filtered), "--keyint 10s", "--scd true", extra].filter(Boolean).join(" ");
    };
    var buildAbAv1AomFlags = (preset, hdrAom) => {
      const ffmpegArgs = [
        "--enc tune=ssim",
        "--enc lag-in-frames=48",
        "--enc tile-columns=0",
        "--enc tile-rows=0",
        "--enc aq-mode=0",
        "--enc arnr-strength=1",
        "--enc arnr-max-frames=4"
      ];
      const aomParams = [
        "enable-qm=1",
        "sb-size=dynamic",
        "deltaq-mode=0",
        "enable-chroma-deltaq=1",
        "disable-trellis-quant=0",
        "quant-b-adapt=1",
        "enable-keyframe-filtering=1",
        "enable-dnl-denoising=0"
      ].join(":");
      return [...ffmpegArgs, `--enc aom-params=${aomParams}`].join(" ");
    };
    module2.exports = {
      detectHdrMeta,
      buildAomFlags,
      buildSvtFlags,
      buildAbAv1SvtFlags,
      buildAbAv1AomFlags
    };
  }
});

// src/shared/downscale.js
var require_downscale = __commonJS({
  "src/shared/downscale.js"(exports2, module2) {
    "use strict";
    var RESOLUTION_PRESETS = {
      "720p": { width: 1280, height: 720 },
      "1080p": { width: 1920, height: 1080 },
      "1440p": { width: 2560, height: 1440 }
    };
    var shouldDownscale = (sourceWidth, resolution) => {
      const preset = RESOLUTION_PRESETS[resolution];
      if (!preset) return false;
      return sourceWidth > preset.width;
    };
    var buildVsDownscaleLines = (resolution) => {
      const preset = RESOLUTION_PRESETS[resolution];
      if (!preset) return [];
      return [
        "src_w, src_h = src.width, src.height",
        `tgt_w = ${preset.width}`,
        "tgt_h = int(round(src_h * tgt_w / src_w / 2) * 2)",
        "src = core.resize.Lanczos(src, width=tgt_w, height=tgt_h, filter_param_a=3)"
      ];
    };
    var buildAv1anVmafResArgs = (resolution) => {
      const preset = RESOLUTION_PRESETS[resolution];
      if (!preset) return [];
      const vmafW = Math.floor(preset.width / 2);
      const vmafH = Math.floor(preset.height / 2);
      const vmafHEven = vmafH % 2 === 0 ? vmafH : vmafH + 1;
      return ["--vmaf-res", `${vmafW}x${vmafHEven}`];
    };
    var buildAbAv1DownscaleArgs = (resolution) => {
      const preset = RESOLUTION_PRESETS[resolution];
      if (!preset) return [];
      return ["--vfilter", `scale=${preset.width}:-2:flags=lanczos`];
    };
    module2.exports = {
      RESOLUTION_PRESETS,
      shouldDownscale,
      buildVsDownscaleLines,
      buildAv1anVmafResArgs,
      buildAbAv1DownscaleArgs
    };
  }
});

// src/shared/audioMerge.js
var require_audioMerge = __commonJS({
  "src/shared/audioMerge.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path = require("path");
    var cp = require("child_process");
    var findMkvmerge = () => {
      for (const p of ["/usr/local/bin/mkvmerge", "/usr/bin/mkvmerge"]) {
        if (fs.existsSync(p)) return p;
      }
      return "mkvmerge";
    };
    var probeAudioSize = async (inputPath, workDir, jobLog, dbg) => {
      const mkvmergeBin = findMkvmerge();
      const tmpAudio = path.join(workDir, "audio-size-probe.mkv");
      try {
        await new Promise((resolve) => {
          const proc = cp.spawn(mkvmergeBin, ["-q", "-o", tmpAudio, "-D", inputPath]);
          proc.on("close", resolve);
          proc.on("error", resolve);
        });
        if (!fs.existsSync(tmpAudio)) return 0;
        const bytes = fs.statSync(tmpAudio).size;
        try {
          fs.unlinkSync(tmpAudio);
        } catch (_) {
        }
        const gb = bytes / 1024 ** 3;
        const mb = bytes / 1024 ** 2;
        jobLog(`[init] audio+subs size: ${mb.toFixed(1)} MiB -- will be added to output estimate`);
        dbg(`probeAudioSize: ${gb.toFixed(3)} GiB`);
        return gb;
      } catch (_) {
        try {
          fs.unlinkSync(tmpAudio);
        } catch (__) {
        }
        return 0;
      }
    };
    var mergeAudioVideo = async (videoPath, inputPath, outputPath, processManager, jobLog, dbg) => {
      const mkvmergeBin = findMkvmerge();
      jobLog("[mux] muxing audio + subtitles from original via mkvmerge...");
      const muxExit = await processManager.spawnAsync(mkvmergeBin, [
        "-o",
        outputPath,
        videoPath,
        "--no-video",
        inputPath
      ], { silent: true });
      if (muxExit >= 2) {
        jobLog(`ERROR: mkvmerge failed (exit ${muxExit})`);
        return false;
      }
      if (muxExit === 1) {
        jobLog("[mux] mkvmerge warnings (exit 1) -- treating as success");
      }
      if (!fs.existsSync(outputPath)) {
        jobLog("ERROR: mux output not found after mkvmerge");
        return false;
      }
      dbg(`[mux] merge complete: ${outputPath}`);
      return true;
    };
    module2.exports = { probeAudioSize, mergeAudioVideo };
  }
});

// src/shared/progressTracker.js
var require_progressTracker = __commonJS({
  "src/shared/progressTracker.js"(exports2, module2) {
    "use strict";
    var fs = require("fs");
    var path = require("path");
    var { humanSize } = require_logger();
    var POLL_INTERVAL_MS = 5e3;
    var LOG_INTERVAL_MS = 10 * 60 * 1e3;
    var formatEta = (seconds) => {
      if (seconds <= 0) return "";
      const h = Math.floor(seconds / 3600);
      const m = Math.floor(seconds % 3600 / 60);
      const s = Math.floor(seconds % 60);
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    };
    var createAv1anTracker = (opts) => {
      const {
        workBase,
        audioSizeGb,
        sourceSizeGb,
        maxEncodedPercent,
        updateWorker,
        jobLog,
        dbg,
        onSizeExceeded
      } = opts;
      let interval = null;
      let smoothedFps = 0;
      let encodeStartMs = 0;
      let lastProgressLogMs = 0;
      const av1anTemp = path.join(workBase, "work");
      const logDir = path.join(workBase, "vs", "logs");
      const scenesFile = opts.scenesFile || path.join(av1anTemp, "scenes.json");
      const doneFile = path.join(av1anTemp, "done.json");
      const pushStats = (fields) => {
        updateWorker(fields);
      };
      const poll = () => {
        if (process.connected === false) {
          dbg("[WATCHDOG] IPC disconnected in av1an interval");
          return "cancelled";
        }
        if (!fs.existsSync(scenesFile) || !fs.existsSync(doneFile)) {
          dbg(`progress: waiting for files | scenes=${fs.existsSync(scenesFile)} done=${fs.existsSync(doneFile)}`);
          return "waiting";
        }
        let scenes, done;
        try {
          scenes = JSON.parse(fs.readFileSync(scenesFile, "utf8"));
        } catch (e) {
          dbg(`progress: failed to parse scenes.json: ${e.message}`);
          return "error";
        }
        try {
          done = JSON.parse(fs.readFileSync(doneFile, "utf8"));
        } catch (e) {
          dbg(`progress: failed to parse done.json: ${e.message}`);
          return "error";
        }
        const totalFrames = scenes.frames || 0;
        const totalChunks = Array.isArray(scenes.scenes) ? scenes.scenes.length : 0;
        if (totalFrames === 0) return "waiting";
        const doneEntries = done.done || {};
        const doneChunks = Object.keys(doneEntries).length;
        const encodedFrames = Object.values(doneEntries).reduce((s, e) => s + (e.frames || 0), 0);
        const encodedBytes = Object.values(doneEntries).reduce((s, e) => s + (e.size_bytes || 0), 0);
        if (doneChunks >= 1 && encodeStartMs === 0) {
          encodeStartMs = Date.now();
          pushStats({ status: "Encoding" });
        }
        let workerFps = 0;
        if (fs.existsSync(logDir)) {
          let logFiles;
          try {
            logFiles = fs.readdirSync(logDir).filter((f) => f.startsWith("av1an.log"));
          } catch (_) {
            logFiles = [];
          }
          const allFpsSamples = [];
          for (const lf of logFiles) {
            let lines;
            try {
              lines = fs.readFileSync(path.join(logDir, lf), "utf8").split("\n");
            } catch (_) {
              continue;
            }
            const recent = lines.slice(-300);
            for (const line of recent) {
              const m1 = line.match(/(\d+(?:\.\d+)?)\s+fps,/i);
              if (m1) {
                allFpsSamples.push(parseFloat(m1[1]));
                continue;
              }
              if (/finished/i.test(line)) {
                const m2 = line.match(/(\d+(?:\.\d+)?)\s*fps/i);
                if (m2) allFpsSamples.push(parseFloat(m2[1]));
              }
            }
          }
          const recentSamples = allFpsSamples.slice(-20);
          if (recentSamples.length >= 2) {
            const sorted = [...recentSamples].sort((a, b) => a - b);
            const trimmed = sorted.length > 2 ? sorted.slice(1, -1) : sorted;
            workerFps = trimmed.reduce((s, v) => s + v, 0) / trimmed.length;
          } else if (recentSamples.length === 1) {
            workerFps = recentSamples[0];
          }
        }
        if (workerFps > 0) {
          smoothedFps = smoothedFps === 0 ? workerFps : smoothedFps * 0.7 + workerFps * 0.3;
        }
        let throughputFps = smoothedFps;
        if (encodeStartMs > 0 && encodedFrames > 0) {
          const elapsedS = (Date.now() - encodeStartMs) / 1e3;
          if (elapsedS > 0) throughputFps = encodedFrames / elapsedS;
        }
        const totalFps = throughputFps;
        const pct = Math.min(99, Math.round(encodedFrames / totalFrames * 100));
        const remainingFrames = totalFrames - encodedFrames;
        const etaS = totalFps > 0 ? Math.round(remainingFrames / totalFps) : 0;
        const etaStr = formatEta(etaS);
        const estVideoBytes = encodedFrames > 0 ? Math.round(encodedBytes / encodedFrames * totalFrames) : 0;
        const actualSizeGb = encodedBytes / 1024 ** 3;
        const estFinalSizeGb = estVideoBytes / 1024 ** 3 + audioSizeGb;
        if (maxEncodedPercent < 100 && pct >= 10 && sourceSizeGb > 0 && estFinalSizeGb > 0) {
          const estPercent = estFinalSizeGb / sourceSizeGb * 100;
          dbg(`size-check: est=${humanSize(estVideoBytes + audioSizeGb * 1024 ** 3)}  src=${humanSize(sourceSizeGb * 1024 ** 3)}  est%=${estPercent.toFixed(1)}  limit=${maxEncodedPercent}%`);
          if (estPercent > maxEncodedPercent) {
            jobLog(`[av1an] ABORT: estimated output ${estPercent.toFixed(1)}% of source exceeds limit of ${maxEncodedPercent}% -- killing encode`);
            onSizeExceeded();
            return "exceeded";
          }
        }
        pushStats({
          percentage: pct,
          fps: Math.round(totalFps * 10) / 10,
          ETA: etaStr,
          outputFileSizeInGbytes: actualSizeGb,
          estimatedFinalFileSizeInGbytes: estFinalSizeGb,
          estimatedFinalSize: estFinalSizeGb,
          estSize: estFinalSizeGb
        });
        const now = Date.now();
        if (now - lastProgressLogMs >= LOG_INTERVAL_MS) {
          lastProgressLogMs = now;
          jobLog(
            `[av1an] ${pct}%  ${doneChunks}/${totalChunks} chunks  ${totalFps > 0 ? totalFps.toFixed(1) + " fps" : ""}` + (etaStr ? `  ETA ${etaStr}` : "") + (estFinalSizeGb > 0 ? `  est ${humanSize(estFinalSizeGb * 1024 ** 3)}` : "")
          );
        }
        dbg(
          `PROGRESS ${pct}%  chunk ${doneChunks}/${totalChunks}  frames ${encodedFrames}/${totalFrames}  workerFps=${workerFps.toFixed(1)}  smoothed=${smoothedFps.toFixed(1)}  totalFps=${totalFps.toFixed(1)}  actual=${humanSize(encodedBytes)}  est=${humanSize(estFinalSizeGb * 1024 ** 3)}` + (etaStr ? `  ETA ${etaStr}` : "")
        );
        return "ok";
      };
      return {
        start: () => {
          interval = setInterval(poll, POLL_INTERVAL_MS);
        },
        stop: () => {
          if (interval) {
            clearInterval(interval);
            interval = null;
          }
          poll();
        }
      };
    };
    var createAbAv1Tracker = (opts) => {
      const {
        outputPath,
        sourceSizeGb,
        updateWorker,
        jobLog,
        dbg,
        onSizeExceeded
      } = opts;
      let interval = null;
      let currentPct = 0;
      let currentFps = 0;
      let encodeStarted = false;
      let encodeReached100 = false;
      let reached100AtMs = 0;
      let lastHeartbeatLogMs = 0;
      let lastProgressLogMs = 0;
      let lastEtaSec = 0;
      let lastEtaReceivedMs = 0;
      let encodeStartMs = 0;
      let lastEstPct = 0;
      let cachedEstSizeGb = 0;
      const pushStats = (fields) => {
        updateWorker(fields);
      };
      const onLine = (line) => {
        dbg(`[ab-av1] ${line}`);
        if (!encodeStarted && /command::encode\]\s*encoding/i.test(line)) {
          encodeStarted = true;
          encodeStartMs = Date.now();
          pushStats({ status: "Encoding" });
          jobLog(line);
          return;
        }
        if (/command::crf_search\]/i.test(line)) {
          jobLog(line);
        }
        const predM = line.match(/predicted video stream size\s+([\d.]+)\s*(GiB|MiB)/i);
        if (predM) {
          const val = parseFloat(predM[1]);
          const videoGb = /MiB/i.test(predM[2]) ? val / 1024 : val;
          pushStats({ estimatedFinalFileSizeInGbytes: videoGb, estimatedFinalSize: videoGb, estSize: videoGb });
          dbg(`[ab-av1] estFinalSize updated: ${videoGb.toFixed(3)} GiB`);
        }
        if (/\b(error|warn|panic|failed|abort)\b/i.test(line)) {
          jobLog(line);
        }
        if (/failed to find a suitable crf/i.test(line)) {
          jobLog("[ab-av1] could not find a suitable CRF -- passing through");
          onSizeExceeded();
        }
        if (/encoded size .* too large|max.encoded.percent|will not be smaller/i.test(line)) {
          jobLog("[ab-av1] estimated output exceeds max-encoded-percent limit");
          onSizeExceeded();
        }
        if (encodeStarted) {
          const pctM = line.match(/\b(\d{1,3})%(?!\d)/);
          if (pctM) {
            const p = parseInt(pctM[1], 10);
            if (p === 100 && !encodeReached100) {
              encodeReached100 = true;
              reached100AtMs = Date.now();
              lastHeartbeatLogMs = Date.now();
              jobLog("[ab-av1] video encode 100% -- post-encode (audio / mux)...");
              pushStats({ status: "Finalizing" });
              currentPct = 99;
            } else if (p > 0 && p < 100) {
              currentPct = p;
              if (p !== lastEstPct) {
                lastEstPct = p;
                try {
                  if (fs.existsSync(outputPath)) {
                    const nowSizeGb = fs.statSync(outputPath).size / 1024 ** 3;
                    if (nowSizeGb > 0) {
                      cachedEstSizeGb = nowSizeGb / (p / 100);
                    }
                  }
                } catch (_) {
                }
              }
            }
          }
          if (!encodeReached100) {
            const fpsM = line.match(/(\d+\.?\d*)\s*fps/i);
            if (fpsM) {
              currentFps = parseFloat(fpsM[1]);
            }
            const etaM = line.match(/\beta\s+(\d+)\s*(minute|second|min|sec)/i);
            if (etaM) {
              const etaVal = parseInt(etaM[1], 10);
              const etaUnit = etaM[2].toLowerCase();
              lastEtaSec = /^s/.test(etaUnit) ? etaVal : etaVal * 60;
              lastEtaReceivedMs = Date.now();
            }
          }
        }
      };
      const intervalTick = () => {
        let actualSizeGb = 0;
        try {
          if (fs.existsSync(outputPath)) {
            actualSizeGb = fs.statSync(outputPath).size / 1024 ** 3;
          }
        } catch (_) {
        }
        const estFinalSizeGb = encodeReached100 ? 0 : cachedEstSizeGb;
        if (encodeReached100) {
          pushStats({
            percentage: 99,
            fps: 0,
            ETA: "",
            outputFileSizeInGbytes: actualSizeGb
          });
          const now2 = Date.now();
          if (now2 - lastHeartbeatLogMs >= 5 * 60 * 1e3) {
            const elapsedMin = Math.round((now2 - reached100AtMs) / 6e4);
            jobLog(`[ab-av1] post-encode still running (${elapsedMin}m since video done)...`);
            lastHeartbeatLogMs = now2;
          }
          return;
        }
        if (currentPct === 0) {
          if (actualSizeGb > 0) {
            pushStats({ outputFileSizeInGbytes: actualSizeGb });
          }
          return;
        }
        let remain;
        if (lastEtaSec > 0) {
          const sinceLastEta = (Date.now() - lastEtaReceivedMs) / 1e3;
          remain = Math.max(0, lastEtaSec - sinceLastEta);
        } else if (encodeStartMs > 0) {
          const elapsed = (Date.now() - encodeStartMs) / 1e3;
          remain = elapsed / currentPct * (100 - currentPct);
        } else {
          remain = 0;
        }
        const eta = formatEta(remain);
        pushStats({
          percentage: currentPct,
          fps: currentFps,
          ETA: eta,
          outputFileSizeInGbytes: actualSizeGb,
          estimatedFinalFileSizeInGbytes: estFinalSizeGb,
          estimatedFinalSize: estFinalSizeGb,
          estSize: estFinalSizeGb
        });
        const now = Date.now();
        if (now - lastProgressLogMs >= LOG_INTERVAL_MS) {
          lastProgressLogMs = now;
          const etaMin = Math.round(remain / 60);
          jobLog(`[ab-av1] ${currentPct}%  ${currentFps.toFixed(0)} fps  ETA ~${etaMin}m`);
        }
      };
      return {
        onLine,
        startInterval: () => {
          interval = setInterval(intervalTick, POLL_INTERVAL_MS);
        },
        stop: () => {
          if (interval) {
            clearInterval(interval);
            interval = null;
          }
        }
      };
    };
    module2.exports = { createAv1anTracker, createAbAv1Tracker };
  }
});

// src/av1anEncode/index.js
var details = () => ({
  name: "AV1 Encode (av1an)",
  description: [
    "Encodes video to AV1 using av1an scene-based chunked encoding.",
    "Supports aomenc (quality) and SVT-AV1 (speed) encoders.",
    "Live progress, FPS, and ETA on dashboard. Cancel kills encoder immediately."
  ].join(" "),
  style: { borderColor: "purple" },
  tags: "av1,av1an,svt-av1,aomenc,vmaf",
  isStartPlugin: false,
  pType: "",
  requiresVersion: "2.00.01",
  sidebarPosition: -1,
  icon: "faVideo",
  inputs: [
    {
      label: "Encoder",
      name: "encoder",
      type: "string",
      defaultValue: "svt-av1",
      inputUI: { type: "dropdown", options: ["aom", "svt-av1"] },
      tooltip: "aom = aomenc (quality, slower). svt-av1 = SVT-AV1 (speed, faster)."
    },
    {
      label: "Target VMAF",
      name: "target_vmaf",
      type: "number",
      defaultValue: "93",
      inputUI: { type: "text" },
      tooltip: "VMAF score to target (0-100). Typically 90-96."
    },
    {
      label: "QP Range",
      name: "qp_range",
      type: "string",
      defaultValue: "10-50",
      inputUI: { type: "text" },
      tooltip: 'QP floor-ceiling for target-quality search. E.g. "10-50".'
    },
    {
      label: "Preset",
      name: "preset",
      type: "number",
      defaultValue: "4",
      inputUI: { type: "text" },
      tooltip: "aomenc: cpu-used (0-8, lower=slower/better). SVT-AV1: preset (0-13). Recommended: 3 for aom, 4-6 for SVT."
    },
    {
      label: "Max Encoded Percent",
      name: "max_encoded_percent",
      type: "number",
      defaultValue: "80",
      inputUI: { type: "text" },
      tooltip: "Abort if estimated output exceeds this % of source size. Set to 100 to disable."
    },
    {
      label: "Enable Downscale",
      name: "downscale_enabled",
      type: "boolean",
      defaultValue: "false",
      inputUI: { type: "switch" },
      tooltip: "Downscale input using VapourSynth pre-filter before encoding."
    },
    {
      label: "Downscale Resolution",
      name: "downscale_resolution",
      type: "string",
      defaultValue: "1080p",
      inputUI: { type: "dropdown", options: ["720p", "1080p", "1440p"] },
      tooltip: "Target resolution for downscaling. Only used when downscale is enabled."
    },
    {
      label: "Custom SVT-AV1 Params",
      name: "custom_svt_params",
      type: "string",
      defaultValue: "",
      inputUI: { type: "text" },
      tooltip: "Extra SVT-AV1 (Tritium) params in av1an form, e.g. '--ac-bias 1.0 --variance-boost-curve 3 --tune 0'. Applied to the encode (and av1an's target-quality probes)."
    },
    {
      label: "Keep Dolby Vision RPU Sidecar",
      name: "dv_rpu_sidecar",
      type: "boolean",
      defaultValue: "true",
      inputUI: { type: "switch" },
      tooltip: "If the source has Dolby Vision, extract its RPU to a .dvrpu.bin sidecar beside the source (archival/re-injectable). Not injected into the chunked AV1 (av1an chunking misaligns per-frame metadata). Needs dovi_tool."
    },
    {
      label: "Keep HDR10+ Sidecar",
      name: "hdr10plus_sidecar",
      type: "boolean",
      defaultValue: "true",
      inputUI: { type: "switch" },
      tooltip: "If the source has HDR10+, extract it to a .hdr10plus.json sidecar beside the source. HDR10 static colour/PQ is applied per-chunk; per-frame dynamic metadata is sidecar-only here. Needs hdr10plus_tool."
    }
  ],
  outputs: [
    { number: 1, tooltip: "Encode succeeded -- output file is the encoded video+audio MKV" },
    { number: 2, tooltip: "Not processed -- compression target not met, input file passed through unchanged" }
  ]
});
var plugin = async (args) => {
  const fs = require("fs");
  const path = require("path");
  const { createProcessManager } = require_processManager();
  const { createLogger, humanSize } = require_logger();
  const { detectHdrMeta, buildAomFlags, buildSvtFlags } = require_encoderFlags();
  const { shouldDownscale, buildVsDownscaleLines, buildAv1anVmafResArgs } = require_downscale();
  const { probeAudioSize, mergeAudioVideo } = require_audioMerge();
  const { createAv1anTracker } = require_progressTracker();
  const inputs = args.inputs || {};
  const encoder = String(inputs.encoder || "svt-av1");
  const targetVmaf = Number(inputs.target_vmaf) || 93;
  const qpRange = String(inputs.qp_range || "10-50");
  const encPreset = Number(inputs.preset) || 4;
  const maxEncodedPercent = Number(inputs.max_encoded_percent) || 80;
  const downscaleEnabled = inputs.downscale_enabled === true || inputs.downscale_enabled === "true";
  const downscaleRes = String(inputs.downscale_resolution || "1080p");
  const customSvtParams = String(inputs.custom_svt_params || "").trim();
  const dvRpuSidecar = inputs.dv_rpu_sidecar === void 0 ? true : inputs.dv_rpu_sidecar === true || inputs.dv_rpu_sidecar === "true";
  const hdr10plusSidecar = inputs.hdr10plus_sidecar === void 0 ? true : inputs.hdr10plus_sidecar === true || inputs.hdr10plus_sidecar === "true";
  const findBin = (name, ...paths) => paths.find((p) => fs.existsSync(p)) || (() => {
    throw new Error(`Required binary not found: ${name} (checked ${paths.join(", ")})`);
  })();
  const BIN = {
    av1an: findBin("av1an", "/usr/local/bin/av1an", "/usr/bin/av1an"),
    ffmpeg: findBin("ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"),
    vspipe: findBin("vspipe", "/usr/local/bin/vspipe", "/usr/bin/vspipe"),
    mkvmerge: findBin("mkvmerge", "/usr/local/bin/mkvmerge", "/usr/bin/mkvmerge")
  };
  const optBin = (...paths) => paths.find((p) => fs.existsSync(p)) || null;
  const DOVI_TOOL = optBin("/usr/local/bin/dovi_tool", "/usr/bin/dovi_tool");
  const HDR10PLUS_TOOL = optBin("/usr/local/bin/hdr10plus_tool", "/usr/bin/hdr10plus_tool");
  const vmafModel = "/usr/local/share/vmaf/vmaf_v0.6.1.json";
  if (!fs.existsSync(vmafModel)) throw new Error(`VMAF model not found: ${vmafModel}`);
  const { jobLog, dbg } = createLogger(args.jobLog, args.workDir);
  const pm = createProcessManager(jobLog, dbg);
  const updateWorker = (fields) => {
    if (typeof args.updateWorker === "function") {
      try {
        args.updateWorker(fields);
      } catch (_) {
      }
    }
  };
  const file = args.inputFileObj;
  const inputPath = file._id;
  const streams = file.ffProbeData && file.ffProbeData.streams || [];
  const stream = streams.find((s) => s.codec_type === "video") || {};
  const height = stream.height || 0;
  const sourceWidth = stream.width || 0;
  const doDownscale = downscaleEnabled && shouldDownscale(sourceWidth, downscaleRes);
  if (downscaleEnabled && !doDownscale) {
    jobLog(`Downscale skipped: source ${sourceWidth}px is already at or below ${downscaleRes} target`);
  }
  const { hdrAom, hdrSvt } = detectHdrMeta(stream);
  const workBase = path.join(args.workDir, "av1an-work");
  const vsDir = path.join(workBase, "vs");
  const av1anTemp = path.join(workBase, "work");
  const outputPath = path.join(args.workDir, "av1-output.mkv");
  fs.mkdirSync(vsDir, { recursive: true });
  fs.mkdirSync(av1anTemp, { recursive: true });
  const lwiCache = path.join(vsDir, "source.lwi");
  const isHdrSvt = encoder !== "aom" && !!hdrSvt;
  const srcHasDv = (stream.side_data_list || []).some((d) => /dovi|dolby vision/i.test(d.side_data_type || ""));
  if (isHdrSvt && dvRpuSidecar && srcHasDv && DOVI_TOOL) {
    const sidecar = inputPath.replace(/\.[^./]+$/, "") + ".dvrpu.bin";
    if (fs.existsSync(sidecar) && fs.statSync(sidecar).size > 0) {
      jobLog(`[dv] DV RPU sidecar already present: ${sidecar}`);
    } else {
      jobLog("[dv] extracting Dolby Vision RPU sidecar from source...");
      const ex = await pm.spawnAsync(DOVI_TOOL, ["extract-rpu", "-i", inputPath, "-o", sidecar], { cwd: workBase, silent: true });
      if (ex === 0 && fs.existsSync(sidecar) && fs.statSync(sidecar).size > 0) jobLog(`[dv] DV RPU sidecar saved: ${sidecar}`);
      else {
        jobLog("[dv] DV RPU extraction failed");
        try {
          fs.unlinkSync(sidecar);
        } catch (_) {
        }
      }
    }
  }
  if (isHdrSvt && hdr10plusSidecar && HDR10PLUS_TOOL) {
    const sidecar = inputPath.replace(/\.[^./]+$/, "") + ".hdr10plus.json";
    if (fs.existsSync(sidecar) && fs.statSync(sidecar).size > 2) {
      jobLog(`[hdr10+] HDR10+ sidecar already present: ${sidecar}`);
    } else {
      jobLog("[hdr10+] checking source for HDR10+ metadata...");
      const ex = await pm.spawnAsync(HDR10PLUS_TOOL, ["extract", "-i", inputPath, "-o", sidecar], { cwd: workBase, silent: true });
      if (ex === 0 && fs.existsSync(sidecar) && fs.statSync(sidecar).size > 2) jobLog(`[hdr10+] HDR10+ sidecar saved: ${sidecar}`);
      else {
        dbg("[hdr10+] no HDR10+ metadata -- skipping");
        try {
          fs.unlinkSync(sidecar);
        } catch (_) {
        }
      }
    }
  }
  const encFlags = encoder === "aom" ? buildAomFlags(encPreset, hdrAom) : buildSvtFlags(encPreset, hdrSvt, customSvtParams);
  jobLog("=".repeat(64));
  jobLog(`AV1AN ENCODE  encoder=${encoder}  preset=${encPreset}`);
  jobLog(`  input      : ${inputPath}`);
  jobLog(`  resolution : ${stream.width || "?"}x${height || "?"}${doDownscale ? ` -> ${downscaleRes}` : ""}`);
  jobLog(`  target     : VMAF ${targetVmaf}  QP-range ${qpRange}`);
  jobLog(`  max size   : ${maxEncodedPercent}% of source`);
  jobLog(`  enc flags  : ${encFlags}`);
  jobLog("=".repeat(64));
  const sourceSizeGb = (() => {
    try {
      return fs.statSync(inputPath).size / 1024 ** 3;
    } catch (_) {
      return 0;
    }
  })();
  updateWorker({ percentage: 0, startTime: Date.now(), status: "Processing" });
  const audioSizeGb = await probeAudioSize(inputPath, args.workDir, dbg, dbg);
  const vpyScript = path.join(vsDir, "source.vpy");
  const escPy = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  let vpyLines = [
    "import vapoursynth as vs",
    "core = vs.core",
    `src = core.lsmas.LWLibavSource(source='${escPy(inputPath)}', cachefile='${escPy(lwiCache)}')`
  ];
  if (doDownscale) {
    vpyLines = vpyLines.concat(buildVsDownscaleLines(downscaleRes));
  }
  vpyLines.push("src.set_output()");
  fs.writeFileSync(vpyScript, vpyLines.join("\n") + "\n");
  dbg(`[vs] .vpy written${doDownscale ? ` (Lanczos3 -> ${downscaleRes})` : " (passthrough)"}`);
  if (!fs.existsSync(lwiCache)) {
    updateWorker({ status: "Indexing" });
    const lwiExit = await pm.spawnAsync(BIN.vspipe, ["--info", vpyScript], {
      cwd: vsDir,
      silent: true
    });
    dbg(lwiExit === 0 ? "[vs] .lwi index ready" : "[vs] WARNING: .lwi non-zero -- workers will retry");
  }
  const av1anArgs = [
    "-i",
    vpyScript,
    "-o",
    outputPath,
    "--temp",
    av1anTemp,
    "-c",
    "mkvmerge",
    "-e",
    encoder,
    "--sc-downscale-height",
    "540",
    "--scaler",
    "lanczos",
    "--qp-range",
    qpRange,
    "--target-quality",
    String(targetVmaf),
    "--vmaf-path",
    vmafModel,
    "--probes",
    "6",
    "--chunk-order",
    "long-to-short",
    "--keep",
    "--resume",
    "--verbose"
  ];
  if (doDownscale) {
    av1anArgs.push(...buildAv1anVmafResArgs(downscaleRes));
  }
  av1anArgs.push("-v", encFlags);
  jobLog(`av1an ${av1anArgs.map((a) => /\s/.test(a) ? `"${a}"` : a).join(" ")}`);
  let tracker;
  let sizeExceeded = false;
  pm.installCancelHandler(() => {
    if (tracker) tracker.stop();
  });
  updateWorker({ status: "Scene Detection" });
  tracker = createAv1anTracker({
    workBase,
    audioSizeGb,
    sourceSizeGb,
    maxEncodedPercent,
    updateWorker,
    jobLog,
    dbg,
    onSizeExceeded: () => {
      sizeExceeded = true;
      pm.killAll();
    }
  });
  tracker.start();
  const AV1AN_KEEP = /scenecut|error|warn|panic|crash|failed/i;
  const av1anExit = await pm.spawnAsync(BIN.av1an, av1anArgs, {
    cwd: vsDir,
    filter: (l) => AV1AN_KEEP.test(l),
    onSpawn: (pid) => pm.startPpidWatcher(pid)
  });
  tracker.stop();
  let encodeOk = false;
  if (sizeExceeded) {
    jobLog("[av1an] encode aborted: estimated output exceeds max-encoded-percent limit");
  } else if (av1anExit !== 0) {
    jobLog(`ERROR: av1an exited ${av1anExit}`);
  } else {
    encodeOk = true;
  }
  if (encodeOk) {
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      jobLog(`ERROR: encoder output not found or empty: ${outputPath}`);
      encodeOk = false;
    } else {
      const videoOnlyPath = outputPath + ".videoonly.mkv";
      fs.renameSync(outputPath, videoOnlyPath);
      updateWorker({ status: "Muxing" });
      encodeOk = await mergeAudioVideo(videoOnlyPath, inputPath, outputPath, pm, jobLog, dbg);
      try {
        fs.unlinkSync(videoOnlyPath);
      } catch (_) {
      }
    }
  }
  pm.cleanup();
  if (sizeExceeded) {
    jobLog("=".repeat(64));
    jobLog("ENCODE SKIPPED -- output would exceed max-encoded-percent limit");
    jobLog("=".repeat(64));
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables
    };
  }
  if (!encodeOk) {
    throw new Error("av1an encode failed -- check logs for details");
  }
  const inBytes = (() => {
    try {
      return fs.statSync(inputPath).size;
    } catch (_) {
      return 0;
    }
  })();
  const outBytes = (() => {
    try {
      return fs.statSync(outputPath).size;
    } catch (_) {
      return 0;
    }
  })();
  const pct = inBytes ? ((inBytes - outBytes) / inBytes * 100).toFixed(1) : "?";
  jobLog("=".repeat(64));
  jobLog("ENCODE COMPLETE");
  jobLog(`  source  : ${humanSize(inBytes)}`);
  jobLog(`  output  : ${humanSize(outBytes)}  (${pct}% reduction)`);
  jobLog("=".repeat(64));
  updateWorker({ percentage: 100 });
  return {
    outputFileObj: Object.assign({}, file, { _id: outputPath, file: outputPath }),
    outputNumber: 1,
    variables: args.variables
  };
};
module.exports.details = details;
module.exports.plugin = plugin;
