"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/shared/pathMapper.js
var require_pathMapper = __commonJS({
  "src/shared/pathMapper.js"(exports2, module2) {
    "use strict";
    function createPathMapper(mappingsJson) {
      const mappings = [];
      if (mappingsJson && mappingsJson.trim()) {
        let parsed;
        try {
          parsed = JSON.parse(mappingsJson);
        } catch (err) {
          throw new Error(`Invalid path_mappings JSON: ${err.message}`);
        }
        if (!Array.isArray(parsed)) {
          throw new Error('path_mappings must be a JSON array of "from:to" strings');
        }
        for (const entry of parsed) {
          const parts = String(entry).split(":");
          if (parts.length !== 2 || !parts[0] || !parts[1]) {
            throw new Error(`Invalid path mapping "${entry}" \u2014 expected "from:to" format`);
          }
          mappings.push({ from: parts[0], to: parts[1] });
        }
      }
      function toArr(p) {
        for (const m of mappings) {
          if (p.startsWith(m.from)) {
            return m.to + p.slice(m.from.length);
          }
        }
        return p;
      }
      function fromArr(p) {
        for (const m of mappings) {
          if (p.startsWith(m.to)) {
            return m.from + p.slice(m.to.length);
          }
        }
        return p;
      }
      return { toArr, fromArr };
    }
    module2.exports = { createPathMapper };
  }
});

// src/shared/arrApi.js
var require_arrApi = __commonJS({
  "src/shared/arrApi.js"(exports2, module2) {
    "use strict";
    async function arrFetch(url, apiKey, options = {}) {
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["X-Api-Key"] = apiKey;
      const res = await fetch(url, { ...options, headers });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Arr API ${res.status} at ${url}: ${body.slice(0, 200)}`);
      }
      return res.json();
    }
    async function pollCommand(baseUrl, apiKey, commandId, label, timeoutMs, log) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 3e3));
        const cmd = await arrFetch(`${baseUrl}/api/v3/command/${commandId}`, apiKey);
        log(`${label}: ${cmd.status}`);
        if (cmd.status === "completed") return;
        if (cmd.status === "failed") throw new Error(`${label} command failed`);
      }
      log(`${label}: timed out after ${timeoutMs / 1e3}s, proceeding`);
    }
    async function findRadarrMatch(baseUrl, apiKey, arrPath) {
      const folder = arrPath.substring(0, arrPath.lastIndexOf("/"));
      const movies = await arrFetch(`${baseUrl}/api/v3/movie`, apiKey);
      const movie = movies.find((m) => {
        const mp = m.path.replace(/\/$/, "");
        return folder === mp || folder.startsWith(mp + "/");
      });
      if (!movie) return null;
      const files = await arrFetch(
        `${baseUrl}/api/v3/moviefile?movieId=${movie.id}`,
        apiKey
      );
      const movieFile = files.find((f) => f.path === arrPath);
      if (!movieFile) return null;
      return { movie, movieFile };
    }
    async function findSonarrMatch(baseUrl, apiKey, arrPath, log) {
      const parts = arrPath.split("/");
      parts.pop();
      parts.pop();
      const seriesFolder = parts.join("/");
      const seriesList = await arrFetch(`${baseUrl}/api/v3/series`, apiKey);
      if (log) log(`Sonarr: comparing folder "${seriesFolder}" against ${seriesList.length} series`);
      const series = seriesList.find((s) => {
        const sp = s.path.replace(/\/$/, "");
        return seriesFolder === sp || seriesFolder.startsWith(sp + "/");
      });
      if (!series) return null;
      const files = await arrFetch(
        `${baseUrl}/api/v3/episodefile?seriesId=${series.id}`,
        apiKey
      );
      const episodeFile = files.find((f) => f.path === arrPath);
      if (!episodeFile) return null;
      return { series, episodeFile };
    }
    async function radarrRename(baseUrl, apiKey, movie, movieFile, timeoutMs, log) {
      log(`Calling RescanMovie for "${movie.title}" (id: ${movie.id})...`);
      const rescanCmd = await arrFetch(`${baseUrl}/api/v3/command`, apiKey, {
        method: "POST",
        body: JSON.stringify({ name: "RescanMovie", movieId: movie.id })
      });
      await pollCommand(baseUrl, apiKey, rescanCmd.id, "RescanMovie", timeoutMs, log);
      log(`Calling RenameMovie...`);
      const renameCmd = await arrFetch(`${baseUrl}/api/v3/command`, apiKey, {
        method: "POST",
        body: JSON.stringify({ name: "RenameMovie", movieIds: [movie.id] })
      });
      await pollCommand(baseUrl, apiKey, renameCmd.id, "RenameMovie", timeoutMs, log);
      const updated = await arrFetch(
        `${baseUrl}/api/v3/moviefile/${movieFile.id}`,
        apiKey
      );
      return updated.path;
    }
    async function sonarrRename(baseUrl, apiKey, series, episodeFile, timeoutMs, log) {
      log(`Calling RefreshSeries for "${series.title}" (id: ${series.id})...`);
      const refreshCmd = await arrFetch(`${baseUrl}/api/v3/command`, apiKey, {
        method: "POST",
        body: JSON.stringify({ name: "RefreshSeries", seriesId: series.id })
      });
      await pollCommand(baseUrl, apiKey, refreshCmd.id, "RefreshSeries", timeoutMs, log);
      log(`Calling RenameFiles for episode file id: ${episodeFile.id}...`);
      const renameCmd = await arrFetch(`${baseUrl}/api/v3/command`, apiKey, {
        method: "POST",
        body: JSON.stringify({
          name: "RenameFiles",
          seriesId: series.id,
          files: [episodeFile.id]
        })
      });
      await pollCommand(baseUrl, apiKey, renameCmd.id, "RenameFiles", timeoutMs, log);
      const updated = await arrFetch(
        `${baseUrl}/api/v3/episodefile/${episodeFile.id}`,
        apiKey
      );
      return updated.path;
    }
    var ARR_LANG_TO_ISO = {
      afrikaans: "afr",
      albanian: "sqi",
      arabic: "ara",
      bengali: "ben",
      bosnian: "bos",
      bulgarian: "bul",
      catalan: "cat",
      chinese: "chi",
      croatian: "hrv",
      czech: "ces",
      danish: "dan",
      dutch: "dut",
      english: "eng",
      estonian: "est",
      finnish: "fin",
      flemish: "dut",
      french: "fre",
      georgian: "kat",
      german: "ger",
      greek: "gre",
      hebrew: "heb",
      hindi: "hin",
      hungarian: "hun",
      icelandic: "ice",
      indonesian: "ind",
      italian: "ita",
      japanese: "jpn",
      kannada: "kan",
      korean: "kor",
      latvian: "lav",
      lithuanian: "lit",
      macedonian: "mac",
      malayalam: "mal",
      marathi: "mar",
      mongolian: "mon",
      norwegian: "nor",
      persian: "per",
      polish: "pol",
      portuguese: "por",
      "portuguese (brazil)": "por",
      romanian: "rum",
      romansh: "roh",
      russian: "rus",
      serbian: "srp",
      slovak: "slo",
      slovenian: "slv",
      spanish: "spa",
      "spanish (latino)": "spa",
      swedish: "swe",
      tagalog: "tgl",
      tamil: "tam",
      telugu: "tel",
      thai: "tha",
      turkish: "tur",
      ukrainian: "ukr",
      urdu: "urd",
      vietnamese: "vie"
    };
    async function getOriginalLanguage(opts) {
      const { radarrUrl, radarrKey, sonarrUrl, sonarrKey, arrPath, log } = opts;
      if (radarrUrl && radarrKey) {
        try {
          log("Searching Radarr for original language...");
          const match = await findRadarrMatch(radarrUrl, radarrKey, arrPath);
          if (match && match.movie.originalLanguage) {
            const name = match.movie.originalLanguage.name;
            const iso = ARR_LANG_TO_ISO[(name || "").toLowerCase()];
            log(`Radarr: original language = ${name} (${iso || "unknown"})`);
            return iso || null;
          }
          log("No Radarr match or no originalLanguage field");
        } catch (err) {
          log(`Radarr error: ${err.message}`);
        }
      }
      if (sonarrUrl && sonarrKey) {
        try {
          log("Searching Sonarr for original language...");
          const match = await findSonarrMatch(sonarrUrl, sonarrKey, arrPath, log);
          if (match && match.series.originalLanguage) {
            const name = match.series.originalLanguage.name;
            const iso = ARR_LANG_TO_ISO[(name || "").toLowerCase()];
            log(`Sonarr: original language = ${name} (${iso || "unknown"})`);
            return iso || null;
          }
          log("No Sonarr match or no originalLanguage field");
        } catch (err) {
          log(`Sonarr error: ${err.message}`);
        }
      }
      return null;
    }
    module2.exports = {
      arrFetch,
      pollCommand,
      findRadarrMatch,
      findSonarrMatch,
      radarrRename,
      sonarrRename,
      getOriginalLanguage
    };
  }
});

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

// src/sanitizeFile/index.js
var IMAGE_CODECS = /* @__PURE__ */ new Set(["mjpeg", "png", "bmp", "gif"]);
var CODEC_RANK = {
  truehd: 1,
  "dts-hd ma": 2,
  dts_hd_ma: 2,
  flac: 3,
  dts: 4,
  eac3: 5,
  ac3: 6,
  aac: 7
};
var WORST_RANK = 99;
function codecRank(codecName, profile) {
  const name = (codecName || "").toLowerCase();
  if (name === "truehd") return CODEC_RANK.truehd;
  if (name === "dts" && profile && /\bma\b/i.test(profile)) return CODEC_RANK["dts-hd ma"];
  return CODEC_RANK[name] || WORST_RANK;
}
function isCommentary(stream) {
  if (stream && stream.disposition && stream.disposition.comment === 1) return true;
  const title = stream && stream.tags && stream.tags.title;
  return /commentary/i.test(title || "");
}
function categorizeStreams(streams) {
  const video = [];
  const audio = [];
  const subtitle = [];
  const image = [];
  for (let i = 0; i < streams.length; i++) {
    const s = streams[i];
    const idx = i;
    const codec = (s.codec_name || "").toLowerCase();
    if (s.codec_type === "video") {
      if (IMAGE_CODECS.has(codec) || s.disposition && s.disposition.attached_pic === 1) {
        image.push({ idx, stream: s });
      } else {
        video.push({ idx, stream: s });
      }
    } else if (s.codec_type === "audio") {
      audio.push({
        idx,
        stream: s,
        lang: (s.tags && s.tags.language || "").toLowerCase(),
        channels: s.channels || 0,
        rank: codecRank(s.codec_name, s.profile),
        commentary: isCommentary(s)
      });
    } else if (s.codec_type === "subtitle") {
      subtitle.push({
        idx,
        stream: s,
        lang: (s.tags && s.tags.language || "").toLowerCase(),
        commentary: isCommentary(s)
      });
    }
  }
  return { video, audio, subtitle, image };
}
function selectAudio(audioTracks, originalLang, additionalLangs, keepCommentary) {
  if (audioTracks.length <= 1) return audioTracks;
  const mainWanted = [originalLang, ...additionalLangs.filter((l) => l !== originalLang)];
  function bestForLang(lang) {
    const matches = audioTracks.filter((t) => !t.commentary && t.lang === lang);
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.channels - a.channels || a.rank - b.rank);
    return matches[0];
  }
  const selected = [];
  const seenIdx = /* @__PURE__ */ new Set();
  for (const lang of mainWanted) {
    const best = bestForLang(lang);
    if (best && !seenIdx.has(best.idx)) {
      selected.push(best);
      seenIdx.add(best.idx);
    }
  }
  if (keepCommentary) {
    const commentaryLangs = new Set(additionalLangs);
    for (const t of audioTracks) {
      if (t.commentary && commentaryLangs.has(t.lang) && !seenIdx.has(t.idx)) {
        selected.push(t);
        seenIdx.add(t.idx);
      }
    }
  }
  if (selected.length === 0) return audioTracks;
  return selected;
}
function selectSubtitles(subTracks, originalLang, subLangs, keepCommentary) {
  const mainWanted = /* @__PURE__ */ new Set([originalLang, ...subLangs]);
  const commentaryLangs = new Set(subLangs);
  const byLang = /* @__PURE__ */ new Map();
  for (const t of subTracks) {
    const keep = t.commentary ? keepCommentary && commentaryLangs.has(t.lang) : mainWanted.has(t.lang);
    if (keep) {
      if (!byLang.has(t.lang)) byLang.set(t.lang, []);
      byLang.get(t.lang).push(t);
    }
  }
  const ordered = [];
  const langOrder = [originalLang, ...subLangs.filter((l) => l !== originalLang)];
  for (const lang of langOrder) {
    if (byLang.has(lang)) ordered.push(...byLang.get(lang));
  }
  return ordered;
}
var details = () => ({
  name: "Sanitize File",
  description: [
    "All-in-one pre-encode sanitizer. Determines the original language via",
    "Radarr/Sonarr (falls back to first audio track), keeps the best audio",
    "track per wanted language, filters subtitles, removes image streams",
    "(cover art/thumbnails), reorders streams, and remuxes to MKV.",
    "All in a single ffmpeg call."
  ].join(" "),
  style: { borderColor: "green" },
  tags: "sanitize,audio,subtitle,remux,mkv,radarr,sonarr",
  isStartPlugin: false,
  pType: "",
  requiresVersion: "2.00.01",
  sidebarPosition: -1,
  icon: "faBroom",
  inputs: [
    {
      label: "Radarr URL",
      name: "radarr_url",
      type: "string",
      defaultValue: "",
      inputUI: { type: "text" },
      tooltip: "Radarr base URL, e.g. http://radarr:7878. Leave empty to skip."
    },
    {
      label: "Radarr API Key",
      name: "radarr_api_key",
      type: "string",
      defaultValue: "",
      inputUI: { type: "text" },
      tooltip: "Radarr API key. Required if Radarr URL is set."
    },
    {
      label: "Sonarr URL",
      name: "sonarr_url",
      type: "string",
      defaultValue: "",
      inputUI: { type: "text" },
      tooltip: "Sonarr base URL, e.g. http://sonarr:8989. Leave empty to skip."
    },
    {
      label: "Sonarr API Key",
      name: "sonarr_api_key",
      type: "string",
      defaultValue: "",
      inputUI: { type: "text" },
      tooltip: "Sonarr API key. Required if Sonarr URL is set."
    },
    {
      label: "Path Mappings",
      name: "path_mappings",
      type: "string",
      defaultValue: "",
      inputUI: { type: "text" },
      tooltip: 'JSON array of "tdarrPath:arrPath" mappings, e.g. ["/media:/mnt/media"]. Leave empty if paths match.'
    },
    {
      label: "Additional Audio Languages",
      name: "additional_audio_languages",
      type: "string",
      defaultValue: "",
      inputUI: { type: "text" },
      tooltip: "Comma-separated ISO 639-2 codes for extra audio languages to keep (e.g. eng,swe). The original language from Radarr/Sonarr is always kept."
    },
    {
      label: "Subtitle Languages",
      name: "subtitle_languages",
      type: "string",
      defaultValue: "",
      inputUI: { type: "text" },
      tooltip: "Comma-separated ISO 639-2 codes for extra subtitle languages to keep (e.g. eng,swe). The original language subtitles are always kept."
    },
    {
      label: "Keep Commentary Tracks",
      name: "keep_commentary_tracks",
      type: "boolean",
      defaultValue: "false",
      inputUI: { type: "switch" },
      tooltip: 'Keep commentary audio/subtitle tracks (detected via the comment disposition or a "commentary" title; SDH/forced are not commentary). When off, commentaries are removed even if they are the only track in a wanted language. Commentary tracks follow the additional-language lists only \u2014 the original language is not auto-kept for commentaries.'
    }
  ],
  outputs: [
    { number: 1, tooltip: "File was sanitized (streams filtered, reordered, remuxed to MKV)" },
    { number: 2, tooltip: "File already clean \u2014 no changes needed" }
  ]
});
var plugin = async (args) => {
  const { createPathMapper } = require_pathMapper();
  const { getOriginalLanguage } = require_arrApi();
  const { createProcessManager } = require_processManager();
  const path = require("path");
  const fs = require("fs");
  const inputs = args.inputs || {};
  const radarrUrl = (inputs.radarr_url || "").trim().replace(/\/+$/, "");
  const radarrKey = (inputs.radarr_api_key || "").trim();
  const sonarrUrl = (inputs.sonarr_url || "").trim().replace(/\/+$/, "");
  const sonarrKey = (inputs.sonarr_api_key || "").trim();
  const additionalAudioLangs = (inputs.additional_audio_languages || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const subtitleLangs = (inputs.subtitle_languages || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const keepCommentary = inputs.keep_commentary_tracks === true || inputs.keep_commentary_tracks === "true";
  const log = (msg) => {
    if (typeof args.jobLog === "function") args.jobLog(msg);
    else console.log(`[Sanitize] ${msg}`);
  };
  const filePath = args.inputFileObj._id;
  const streams = args.inputFileObj.ffProbeData.streams || [];
  log("==== Sanitize File ====");
  log(`Input: ${filePath}`);
  let originalLang = null;
  const hasArr = radarrUrl && radarrKey || sonarrUrl && sonarrKey;
  if (hasArr) {
    let mapper;
    try {
      mapper = createPathMapper(inputs.path_mappings || "");
    } catch (err) {
      log(`Path mapping error: ${err.message} \u2014 Arr lookup skipped, falling back to first audio track language`);
    }
    if (mapper) {
      const arrPath = mapper.toArr(filePath);
      originalLang = await getOriginalLanguage({
        radarrUrl,
        radarrKey,
        sonarrUrl,
        sonarrKey,
        arrPath,
        log
      });
    }
  }
  if (!originalLang) {
    const firstAudio = streams.find((s) => s.codec_type === "audio");
    if (firstAudio && firstAudio.tags && firstAudio.tags.language) {
      originalLang = firstAudio.tags.language.toLowerCase();
      log(`Arr unavailable \u2014 using track 0 language: ${originalLang}`);
    }
  }
  if (!originalLang) {
    log("WARNING: No original language detected \u2014 keeping all audio tracks");
  }
  const { video, audio, subtitle, image } = categorizeStreams(streams);
  log(`Streams: ${video.length} video, ${audio.length} audio, ${subtitle.length} sub, ${image.length} image`);
  const selectedAudio = originalLang ? selectAudio(audio, originalLang, additionalAudioLangs, keepCommentary) : audio;
  const selectedSubs = originalLang ? selectSubtitles(subtitle, originalLang, subtitleLangs, keepCommentary) : subtitle;
  log(`Keeping: ${selectedAudio.length} audio, ${selectedSubs.length} subtitle`);
  for (const a of selectedAudio) {
    log(`  audio: [${a.lang}] ${a.stream.codec_name} ${a.channels}ch (stream ${a.idx})`);
  }
  for (const s of selectedSubs) {
    log(`  sub: [${s.lang}] ${s.stream.codec_name} (stream ${s.idx})`);
  }
  const ext = path.extname(filePath).toLowerCase();
  const isMkv = ext === ".mkv";
  const noImages = image.length === 0;
  const audioMatch = selectedAudio.length === audio.length && selectedAudio.every((a, i) => audio[i] && a.idx === audio[i].idx);
  const subMatch = selectedSubs.length === subtitle.length && selectedSubs.every((s, i) => subtitle[i] && s.idx === subtitle[i].idx);
  const lastVideoIdx = video.length > 0 ? Math.max(...video.map((v) => v.idx)) : -1;
  const firstAudioIdx = selectedAudio.length > 0 ? Math.min(...selectedAudio.map((a) => a.idx)) : Infinity;
  const lastAudioIdx = selectedAudio.length > 0 ? Math.max(...selectedAudio.map((a) => a.idx)) : -1;
  const firstSubIdx = selectedSubs.length > 0 ? Math.min(...selectedSubs.map((s) => s.idx)) : Infinity;
  const orderCorrect = lastVideoIdx < firstAudioIdx && lastAudioIdx < firstSubIdx;
  if (isMkv && noImages && audioMatch && subMatch && orderCorrect) {
    log("File already clean \u2014 no changes needed");
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables
    };
  }
  const videoIds = video.map((v) => v.idx).join(",");
  const audioIds = selectedAudio.map((a) => a.idx).join(",");
  const subIds = selectedSubs.map((s) => s.idx).join(",");
  const trackOrder = [
    ...video.map((v) => `0:${v.idx}`),
    ...selectedAudio.map((a) => `0:${a.idx}`),
    ...selectedSubs.map((s) => `0:${s.idx}`)
  ].join(",");
  const outputName = `${path.parse(filePath).name}.sanitized.mkv`;
  const outputPath = path.join(args.workDir, outputName);
  const mkvmergeArgs = [
    "-q",
    "-o",
    outputPath,
    "--no-attachments",
    "-d",
    videoIds,
    "-a",
    audioIds,
    ...selectedSubs.length > 0 ? ["-s", subIds] : ["-S"],
    "--track-order",
    trackOrder,
    filePath
  ];
  const totalStreams = video.length + selectedAudio.length + selectedSubs.length;
  log(`Running mkvmerge with ${totalStreams} tracks...`);
  const updateWorker = (fields) => {
    if (typeof args.updateWorker === "function") {
      try {
        args.updateWorker(fields);
      } catch (_) {
      }
    }
  };
  updateWorker({ status: "Sanitizing" });
  const mkvmergeBin = (() => {
    for (const p of ["/usr/local/bin/mkvmerge", "/usr/bin/mkvmerge"]) {
      if (fs.existsSync(p)) return p;
    }
    return "mkvmerge";
  })();
  const pm = createProcessManager(log, () => {
  });
  const exitCode = await pm.spawnAsync(mkvmergeBin, mkvmergeArgs, {
    silent: true
  });
  pm.cleanup();
  updateWorker({ percentage: 100 });
  if (exitCode >= 2 || !fs.existsSync(outputPath)) {
    throw new Error(`mkvmerge failed (exit ${exitCode}) \u2014 output not created`);
  }
  if (exitCode === 1) {
    log("mkvmerge warnings (exit 1) \u2014 treating as success");
  }
  log(`Output: ${outputPath}`);
  return {
    outputFileObj: Object.assign({}, args.inputFileObj, { _id: outputPath, file: outputPath }),
    outputNumber: 1,
    variables: args.variables
  };
};
module.exports = {
  details,
  plugin,
  // exported for unit tests
  categorizeStreams,
  selectAudio,
  selectSubtitles,
  isCommentary
};
