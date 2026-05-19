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

// src/arrRename/index.js
var details = () => ({
  name: "Arr Rename",
  description: [
    "Triggers Radarr/Sonarr to rename files according to their naming schemes.",
    "Place after the Replace Original node. Automatically detects which service",
    "owns the file by querying both APIs."
  ].join(" "),
  style: { borderColor: "green" },
  tags: "radarr,sonarr,rename,arr",
  isStartPlugin: false,
  pType: "",
  requiresVersion: "2.00.01",
  sidebarPosition: -1,
  icon: "faFileSignature",
  inputs: [
    {
      label: "Radarr URL",
      name: "radarr_url",
      type: "string",
      defaultValue: "",
      inputUI: { type: "text" },
      tooltip: "Radarr base URL, e.g. http://radarr:7878. Leave empty to skip Radarr."
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
      tooltip: "Sonarr base URL, e.g. http://sonarr:8989. Leave empty to skip Sonarr."
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
      tooltip: 'JSON array of "tdarrPath:arrPath" mappings, e.g. ["/media:/mnt/media"]. Leave empty if paths are the same.'
    },
    {
      label: "Poll Timeout (s)",
      name: "poll_timeout",
      type: "number",
      defaultValue: "120",
      inputUI: { type: "text" },
      tooltip: "Max seconds to wait for Arr rescan/rename commands to complete."
    }
  ],
  outputs: [
    { number: 1, tooltip: "File renamed successfully by Radarr or Sonarr" },
    { number: 2, tooltip: "No match found or no rename needed" }
  ]
});
var plugin = async (args) => {
  const { createPathMapper } = require_pathMapper();
  const {
    findRadarrMatch,
    findSonarrMatch,
    radarrRename,
    sonarrRename
  } = require_arrApi();
  const inputs = args.inputs || {};
  const radarrUrl = (inputs.radarr_url || "").trim().replace(/\/+$/, "");
  const radarrKey = (inputs.radarr_api_key || "").trim();
  const sonarrUrl = (inputs.sonarr_url || "").trim().replace(/\/+$/, "");
  const sonarrKey = (inputs.sonarr_api_key || "").trim();
  const timeoutMs = (Number(inputs.poll_timeout) || 120) * 1e3;
  const log = (msg) => {
    if (typeof args.jobLog === "function") args.jobLog(msg);
    else console.log(`[ArrRename] ${msg}`);
  };
  const noChange = () => ({
    outputFileObj: args.inputFileObj,
    outputNumber: 2,
    variables: args.variables
  });
  const hasRadarr = radarrUrl && radarrKey;
  const hasSonarr = sonarrUrl && sonarrKey;
  if (!hasRadarr && !hasSonarr) {
    log("No Radarr or Sonarr configured \u2014 skipping");
    return noChange();
  }
  const filePath = args.inputFileObj._id;
  log(`==== Arr Rename ====`);
  log(`Input file: ${filePath}`);
  let mapper;
  try {
    mapper = createPathMapper(inputs.path_mappings || "");
  } catch (err) {
    log(`Path mapping error: ${err.message}`);
    return noChange();
  }
  const arrPath = mapper.toArr(filePath);
  log(`Arr-side path: ${arrPath}${arrPath === filePath ? " (no mapping applied)" : ""}`);
  if (hasRadarr) {
    try {
      log("Searching Radarr...");
      const match = await findRadarrMatch(radarrUrl, radarrKey, arrPath);
      if (match) {
        log(`Matched movie: ${match.movie.title} (file id: ${match.movieFile.id})`);
        const newArrPath = await radarrRename(
          radarrUrl,
          radarrKey,
          match.movie,
          match.movieFile,
          timeoutMs,
          log
        );
        const newPath = mapper.fromArr(newArrPath);
        log(`Renamed: ${newPath}`);
        args.inputFileObj._id = newPath;
        return {
          outputFileObj: args.inputFileObj,
          outputNumber: 1,
          variables: args.variables
        };
      }
      log("No Radarr match");
    } catch (err) {
      log(`Radarr error: ${err.message}`);
    }
  }
  if (hasSonarr) {
    try {
      log("Searching Sonarr...");
      const match = await findSonarrMatch(sonarrUrl, sonarrKey, arrPath, log);
      if (match) {
        log(`Matched series: ${match.series.title} (file id: ${match.episodeFile.id})`);
        const newArrPath = await sonarrRename(
          sonarrUrl,
          sonarrKey,
          match.series,
          match.episodeFile,
          timeoutMs,
          log
        );
        const newPath = mapper.fromArr(newArrPath);
        log(`Renamed: ${newPath}`);
        args.inputFileObj._id = newPath;
        return {
          outputFileObj: args.inputFileObj,
          outputNumber: 1,
          variables: args.variables
        };
      }
      log("No Sonarr match");
    } catch (err) {
      log(`Sonarr error: ${err.message}`);
    }
  }
  log("No Arr service matched this file");
  return noChange();
};
module.exports = { details, plugin };
