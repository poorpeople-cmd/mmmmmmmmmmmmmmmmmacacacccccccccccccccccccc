
// #!/usr/bin/env node
'use strict';

/**
 * StreamGuard: supervised FFmpeg relay for media you own or are licensed to broadcast.
 * Node.js 20+, FFmpeg with libx264 and AAC encoder.
 * INPUT: direct HTTP(S) media playlist/file or RTMP(S) endpoint, not a player webpage.
 * OUTPUT: OK.ru RTMP or your custom RTMP(S) ingest URL.
 * CAUTION: This copy embeds publishing keys. Never put it in a public repository.
 */

const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const QUALITY = Object.freeze({
  '360p':  { width: 640, height: 360, fps: 30, videoKbps: 800 },
  '480p':  { width: 854, height: 480, fps: 30, videoKbps: 1500 },
  '720p':  { width: 1280, height: 720, fps: 30, videoKbps: 3000 },
  '1080p': { width: 1920, height: 1080, fps: 30, videoKbps: 5000 },
});

// Keys copied from the user-provided legacy script. Sensitive: keep this file private.
// Rotate these keys on OK.ru because they have previously been shared in chat.
const STREAM_KEYS = Object.freeze({
  '1': '15254238731883_15281627925099_najspfkgne',
  '1.1': '15254260751979_15281671637611_2plrcfqzze',
  '1.2': '15254285524587_15281717840491_7e6qdknzsu',
  '1.3': '16983200374379_18360218880619_efmw4fchxm',
  '1.4': '16983242579563_18360288741995_t2kh2jvcym',
  '1.5': '16983247822443_18360297982571_3zs5ml7gua',
  '1.6': '16983254834795_18360310237803_xrz3pf4uea',
  '1.7': '16983259553387_18360317971051_6khoe5efge',
  '1.8': '16983264468587_18360327342699_wsn7zgr7ee',
  '1.9': '16983269514859_18360335075947_363qzjlbte',
  '1.10': '16983277641323_18360347921003_rpf6hkqpdm',
  '1.11': '16983286554219_18360360503915_lrqraxbz3y',
  '2': '15254299352683_15281743071851_7dvz3h5d7q',
  '2.1': '15254308986475_15281761618539_3xca7oij3u',
  '2.2': '15254328122987_15281795566187_zjqa6bqzoq',
  '3': '15254341885547_15281821059691_hhlpb5vicy',
  '3.1': '15254357089899_15281848322667_sxeexgvzl4',
  '3.2': '15254367510123_15281868180075_pc4jrytfgm',
  '3.3': '17485986405995_19233134873195_iw63xjblny',
  '3.4': '17485996039787_19233150929515_d3yeoweuam',
  '3.5': '17486002789995_19233161611883_mbg22slybe',
  '3.6': '17486007770731_19233169934955_teme2zt4fm',
  '4': '15255022345835_15283095800427_vwrupxzstm',
  '4.1': '15255038074475_15283122080363_ai5qqp2we4',
  '4.2': '15255045480043_15283135842923_tldl4bhmii',
  '4.3': '15255208599147_15283449629291_abltofuc7m',
  '4.4': '15255217708651_15283466603115_bojrrqtlmu',
  '4.5': '15255227670123_15283486263915_jpntt54mve',
  '5': '17135767461483_18625099401835_4gpytlxk4a',
  '5.1': '15273713933931_15317494860395_avj47smmim',
  '5.2': '15273722257003_15317510195819_6edjluvdqi',
  '5.3': '15273739624043_15317541653099_ii4bxpvabe',
  '5.4': '15273750175339_15317561707115_csel26ku5a',
  '5.5': '15273760071275_15317579467371_cnewcj54me',
  '5.6': '15273767935595_15317595851371_3q43tk7tvm',
  '5.7': '15273778683499_15317616560747_4piekvs4wu',
  's1.1': '14204232736303_14846150314543_37jq4ryehq',
  's1.2': '14204288179759_14846247373359_tnsknmapva',
  's1.3': '14204319768111_14846302489135_sr4ht4ccwq',
  's1.4': '14204331957807_14846326147631_dji2acqcze',
  's1.5': '14204346572335_14846351641135_7gvns4o5ue',
  's1.6': '14204361252399_14846376479279_cjajhf4d3y',
  's1.7': '14204370492975_14846393649711_6fduhdqite',
  's1.8': '14204395527727_14846438017583_s2jlti7lsm',
  's1.9': '14204411387439_14846464887343_f5lxgcqj5y',
  's1.10': '14204424691247_14846487562799_xmbvntt6wa',
  's2.1': '14204490948143_14846603495983_kzevn36tii',
  's2.2': '14204506742319_14846634494511_ta2rxyg2oy',
  's2.3': '14204523322927_14846661233199_foqb3q7zb4',
  's2.4': '14204540034607_14846689085999_gjejdie4uy',
  's2.5': '14204555304495_14846715497007_zdanghuxzu',
  's2.6': '14204565200431_14846734371375_ap3bqpabpu',
  's2.7': '14204577259055_14846756194863_3ecad2535u',
  's2.8': '14204592528943_14846785227311_4hjl46y62e',
  's2.9': '14204602621487_14846802594351_ilnp6lxekq',
  's2.10': '14206184136239_14849618610735_ihnbx7hkoi',
});

const OKRU_RTMP_SERVER = 'rtmp://vsu.okcdn.ru/input/';

function selectedChannel() {
  const channel = (process.env.OKRU_STREAM_ID || '1').trim();
  if (!Object.hasOwn(STREAM_KEYS, channel)) {
    throw new Error(`Unknown OKRU_STREAM_ID: ${channel}`);
  }
  return channel;
}

function resolveOutput(channel) {
  // RTMP_URL can override the selected OK.ru destination if explicitly set.
  if (process.env.RTMP_URL?.trim()) return parseOutput(process.env.RTMP_URL.trim());
  const key = STREAM_KEYS[channel];
  if (!key) throw new Error(`Missing stream key for channel ${channel}`);
  return parseOutput(OKRU_RTMP_SERVER + key);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const iso = () => new Date().toISOString();
function log(level, message, fields = {}) {
  process.stdout.write(JSON.stringify({ time: iso(), level, message, ...fields }) + '\n');
}

function asInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function parseDuration(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (['', '24/7', 'forever', 'infinite', '0'].includes(text)) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const minutes = Number(text);
    if (!(minutes > 0)) throw new Error('Duration must be positive');
    return Math.round(minutes * 60000);
  }
  const token = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)/gi;
  let total = 0;
  let count = 0;
  const rest = text.replace(token, (_, number, unit) => {
    count++;
    const factor = /^h/.test(unit) ? 3600000 : /^m/.test(unit) ? 60000 : 1000;
    total += Number(number) * factor;
    return ' ';
  });
  if (count === 0 || rest.trim() !== '' || !Number.isFinite(total) || total <= 0) {
    throw new Error(`Invalid RELAY_DURATION: ${JSON.stringify(value)}`);
  }
  if (!Number.isSafeInteger(Math.round(total))) throw new Error('Duration is too large');
  return Math.round(total);
}

function parseSources(raw) {
  if (!raw || !raw.trim()) throw new Error('SOURCE_URLS or TARGET_URLS is required (direct, authorized media URLs only)');
  let items;
  if (raw.trim().startsWith('[')) {
    items = JSON.parse(raw);
    if (!Array.isArray(items)) throw new Error('SOURCE_URLS JSON must be an array');
  } else {
    items = raw.split(/[\r\n|,]+/).filter((x) => x.trim());
  }
  if (!items.length || items.length > 20) throw new Error('Provide 1 to 20 source URLs');
  const sources = items.map((item, i) => {
    if (typeof item !== 'string') throw new Error(`Source ${i + 1} must be a string`);
    const value = item.trim().replace(/^!/, '').split('::')[0].trim();
    let url;
    try { url = new URL(value); } catch { throw new Error(`Source ${i + 1} is not a valid URL`); }
    if (!['http:', 'https:', 'rtmp:', 'rtmps:'].includes(url.protocol)) {
      throw new Error(`Source ${i + 1} must use HTTP(S) or RTMP(S)`);
    }
    return { value, protocol: url.protocol };
  });
  if (new Set(sources.map((x) => x.value)).size !== sources.length) {
    throw new Error('Duplicate source URLs are not allowed');
  }
  return sources;
}

function parseOutput(value) {
  if (!value) throw new Error('RTMP_URL is required');
  let url;
  try { url = new URL(value); } catch { throw new Error('RTMP_URL is invalid'); }
  if (!['rtmp:', 'rtmps:'].includes(url.protocol)) {
    throw new Error('RTMP_URL must use rtmp:// or rtmps://');
  }
  return value;
}

function redact(text, cfg) {
  let output = String(text);
  for (const secret of [cfg.output, ...cfg.sources.map((s) => s.value)]) {
    if (secret) output = output.replaceAll(secret, '[REDACTED_URL]');
  }
  return output;
}

function readConfig() {
  const qualityName = (process.env.STREAM_QUALITY || '720p').trim();
  const channel = selectedChannel();
  if (!Object.hasOwn(QUALITY, qualityName)) {
    throw new Error('STREAM_QUALITY must be 360p, 480p, 720p, or 1080p');
  }
  const duration = parseDuration(process.env.CUSTOM_DURATION ?? process.env.RELAY_DURATION ?? '24/7');
  const runtimeLimitMinutes = asInteger('MAX_RUN_MINUTES', 0, 0, 100000);
  const runtimeLimit = runtimeLimitMinutes ? runtimeLimitMinutes * 60000 : null;
  const effectiveDuration = duration == null ? runtimeLimit : runtimeLimit == null ? duration : Math.min(duration, runtimeLimit);
  return {
    sources: parseSources(process.env.SOURCE_URLS || process.env.TARGET_URLS),
    output: resolveOutput(channel),
    channel,
    qualityName,
    profile: QUALITY[qualityName],
    totalMs: effectiveDuration,
    requestedMs: duration,
    startupGraceMs: asInteger('STARTUP_GRACE_SECONDS', 45, 10, 300) * 1000,
    stallLimitMs: asInteger('STALL_SECONDS', 30, 8, 300) * 1000,
    ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
    healthPort: asInteger('HEALTH_PORT', 0, 0, 65535),
    vodPace: (process.env.VOD_PACE || 'OFF').toUpperCase() === 'ON',
  };
}

function ffmpegArgs(cfg, source) {
  const p = cfg.profile;
  const args = [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-stats_period', '2', '-progress', 'pipe:1',
  ];
  if (source.protocol === 'http:' || source.protocol === 'https:') {
    args.push(
      '-rw_timeout', '15000000',
      '-reconnect', '1', '-reconnect_streamed', '1',
      '-reconnect_on_network_error', '1',
      '-reconnect_on_http_error', '429,500,502,503,504',
      '-reconnect_delay_max', '5'
    );
  }
  if (cfg.vodPace) args.push('-re'); // Use ONLY for prerecorded/VOD sources.
  args.push(
    '-i', source.value,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `fps=${p.fps},scale=${p.width}:${p.height}:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-b:v', `${p.videoKbps}k`, '-minrate', `${p.videoKbps}k`,
    '-maxrate', `${p.videoKbps}k`, '-bufsize', `${p.videoKbps * 2}k`,
    '-g', String(p.fps * 2), '-keyint_min', String(p.fps * 2),
    '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-af', 'aresample=async=1:first_pts=0',
    '-f', 'flv', '-flvflags', 'no_duration_filesize',
    cfg.output
  );
  return args;
}

function runSelfTest() {
  assert.equal(parseDuration('1h 10min'), 70 * 60000);
  assert.equal(parseDuration('0h 10min'), 10 * 60000);
  assert.equal(parseDuration('2h30m15s'), 9015000);
  assert.equal(parseDuration('24/7'), null);
  assert.throws(() => parseDuration('1h garbage'));
  assert.equal(parseSources('https://example.test/master.m3u8').length, 1);
  assert.throws(() => parseSources('file:///etc/passwd'));
  assert.equal(Object.keys(STREAM_KEYS).length, 56);
  assert.equal(selectedChannel(), (process.env.OKRU_STREAM_ID || '1').trim());
  assert.equal(resolveOutput('1'), OKRU_RTMP_SERVER + STREAM_KEYS['1']);
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const testOutput = path.join(os.tmpdir(), `streamguard-selftest-${process.pid}.flv`);
  const proc = spawnSync(ffmpeg, [
    '-hide_banner', '-nostdin', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000',
    '-t', '2', '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'ultrafast',
    '-c:a', 'aac', '-f', 'flv', '-y', testOutput
  ], { encoding: 'utf8', timeout: 15000 });
  try { fs.unlinkSync(testOutput); } catch {}
  if (proc.status !== 0) {
    process.stderr.write((proc.stderr || proc.error?.message || 'Unknown FFmpeg failure') + '\n');
    process.exitCode = 1;
    return;
  }
  log('info', 'Self-test passed: parsers, FFmpeg, H.264, AAC and FLV muxer');
}

let stopping = false;
let activeChild = null;
const state = {
  state: 'initializing',
  sourceIndex: null,
  startedAt: Date.now(),
  sourceStartedAt: null,
  lastMediaAt: null,
  progressFrames: 0,
  outputBytes: 0,
  speed: null,
  failovers: 0,
  stopReason: null,
};

function requestStop(reason) {
  if (stopping) return;
  stopping = true;
  state.state = 'stopping';
  state.stopReason = reason;
  log('info', 'Shutdown requested', { reason });
  if (activeChild) terminateChild(activeChild);
}

function createHealthServer(cfg) {
  if (!cfg.healthPort) return null;
  const server = http.createServer((req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404); res.end('Not found'); return;
    }
    const mediaAgeMs = state.lastMediaAt == null ? null : Date.now() - state.lastMediaAt;
    const ok = state.state === 'streaming' && mediaAgeMs != null && mediaAgeMs < cfg.stallLimitMs;
    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      healthy: ok,
      state: state.state,
      sourceIndex: state.sourceIndex,
      mediaAgeMs,
      frames: state.progressFrames,
      bytes: state.outputBytes,
      speed: state.speed,
      failovers: state.failovers,
      upSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
    }));
  });
  server.listen(cfg.healthPort, '127.0.0.1');
  server.on('error', (err) => log('error', 'Health listener failed', { error: err.message }));
  return server;
}

const terminatingChildren = new WeakSet();
function terminateChild(child) {
  if (!child || terminatingChildren.has(child) || child.exitCode != null || child.signalCode != null) return;
  terminatingChildren.add(child);
  child.kill('SIGTERM');
  const forced = setTimeout(() => {
    if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
  }, 5000);
  forced.unref();
  child.once('close', () => clearTimeout(forced));
}

function runSource(cfg, source, sourceIndex, stopAt) {
  return new Promise((resolve) => {
    const child = spawn(cfg.ffmpeg, ffmpegArgs(cfg, source), {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    activeChild = child;
    const startedAt = Date.now();
    state.state = 'starting';
    state.sourceIndex = sourceIndex + 1;
    state.sourceStartedAt = startedAt;
    state.lastMediaAt = null;
    state.progressFrames = 0;
    state.outputBytes = 0;
    state.speed = null;
    let lastTimeUs = -1;
    let lastFrames = -1;
    let seenProgress = false;
    let lastMediaAt = startedAt;
    let lastLogAt = 0;
    let progressBuffer = '';
    let report = {};
    let stderrBuffer = '';
    let exitError = null;
    let finished = false;
    let endingReason = null;
    let interval = null;

    function parseProgressLine(line) {
      const split = line.indexOf('=');
      if (split < 1) return;
      const key = line.slice(0, split);
      report[key] = line.slice(split + 1);
      if (key !== 'progress') return;
      const pts = Number(report.out_time_us ?? report.out_time_ms);
      const frames = Number(report.frame);
      const bytes = Number(report.total_size);
      const ptsMoved = Number.isFinite(pts) && pts >= 0 && pts > lastTimeUs;
      const framesMoved = Number.isFinite(frames) && frames >= 0 && frames > lastFrames;
      if (ptsMoved || framesMoved) {
        seenProgress = true;
        lastMediaAt = Date.now();
        state.lastMediaAt = lastMediaAt;
        state.state = 'streaming';
      }
      if (Number.isFinite(pts) && pts >= 0) lastTimeUs = Math.max(lastTimeUs, pts);
      if (Number.isFinite(frames) && frames >= 0) lastFrames = Math.max(lastFrames, frames);
      if (Number.isFinite(frames) && frames >= 0) state.progressFrames = frames;
      if (Number.isFinite(bytes) && bytes >= 0) state.outputBytes = bytes;
      state.speed = report.speed || null;
      if (Date.now() - lastLogAt > 15000) {
        log('info', 'Encoder progress', {
          sourceIndex: sourceIndex + 1,
          frames: state.progressFrames,
          bytes: state.outputBytes,
          speed: state.speed,
        });
        lastLogAt = Date.now();
      }
      report = {};
    }

    child.stdout.on('data', (chunk) => {
      progressBuffer += chunk.toString('utf8');
      if (progressBuffer.length > 1024 * 1024) progressBuffer = progressBuffer.slice(-4096);
      let newline;
      while ((newline = progressBuffer.indexOf('\n')) >= 0) {
        const line = progressBuffer.slice(0, newline).trim();
        progressBuffer = progressBuffer.slice(newline + 1);
        parseProgressLine(line);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrBuffer = (stderrBuffer + chunk.toString('utf8')).slice(-16000);
    });
    child.once('error', (err) => { exitError = err.message; });
    child.once('close', (code, signal) => {
      if (finished) return;
      finished = true;
      if (interval) clearInterval(interval);
      if (activeChild === child) activeChild = null;
      state.state = stopping ? 'stopping' : 'recovering';
      const reason = endingReason || (stopping ? 'shutdown' : `ffmpeg_exit_${code ?? signal ?? 'unknown'}`);
      if (!stopping && reason !== 'duration_complete') {
        log('warn', 'Source session stopped', {
          sourceIndex: sourceIndex + 1,
          reason,
          error: exitError ? redact(exitError, cfg) : redact(stderrBuffer.split('\n').filter(Boolean).slice(-2).join(' | '), cfg).slice(0, 600),
        });
      }
      resolve({ reason, uptimeMs: Date.now() - startedAt, seenProgress });
    });

    log('info', 'Connecting source', { sourceIndex: sourceIndex + 1, quality: cfg.qualityName });
    interval = setInterval(() => {
      const now = Date.now();
      if (stopping || (stopAt != null && now >= stopAt)) {
        endingReason = stopping ? 'shutdown' : 'duration_complete';
        terminateChild(child);
        return;
      }
      if (!seenProgress && now - startedAt > cfg.startupGraceMs) {
        endingReason = 'startup_timeout';
        log('warn', 'No encoded media during startup grace', { sourceIndex: sourceIndex + 1 });
        terminateChild(child);
      } else if (seenProgress && now - lastMediaAt > cfg.stallLimitMs) {
        endingReason = 'encoder_progress_stalled';
        log('warn', 'Encoded output stopped progressing', {
          sourceIndex: sourceIndex + 1,
          idleSeconds: Math.round((now - lastMediaAt) / 1000),
        });
        terminateChild(child);
      }
    }, 1000);
  });
}

async function run(cfg) {
  const server = createHealthServer(cfg);
  const startTime = Date.now();
  const stopAt = cfg.totalMs == null ? null : startTime + cfg.totalMs;
  const strikes = new Array(cfg.sources.length).fill(0);
  const cooldowns = new Array(cfg.sources.length).fill(0);
  let nextIndex = 0;
  log('info', 'StreamGuard started', {
    sources: cfg.sources.length,
    quality: cfg.qualityName,
    requestedDuration: cfg.requestedMs == null ? '24/7' : `${cfg.requestedMs}ms`,
    effectiveDuration: cfg.totalMs == null ? 'unbounded' : `${cfg.totalMs}ms`,
  });
  try {
    while (!stopping && (stopAt == null || Date.now() < stopAt)) {
      let selected = -1;
      for (let offset = 0; offset < cfg.sources.length; offset++) {
        const candidate = (nextIndex + offset) % cfg.sources.length;
        if (Date.now() >= cooldowns[candidate]) { selected = candidate; break; }
      }
      if (selected === -1) {
        const soonest = Math.min(...cooldowns);
        await sleep(Math.max(250, Math.min(1000, soonest - Date.now())));
        continue;
      }
      const result = await runSource(cfg, cfg.sources[selected], selected, stopAt);
      if (stopping || result.reason === 'duration_complete') break;
      if (stopAt != null && Date.now() >= stopAt) break;
      strikes[selected] = result.uptimeMs > 2 * 60000 ? 1 : Math.min(strikes[selected] + 1, 8);
      cooldowns[selected] = Date.now() + Math.min(60000, 2000 * (2 ** (strikes[selected] - 1)));
      state.failovers++;
      nextIndex = (selected + 1) % cfg.sources.length;
      log('warn', 'Failover scheduled', {
        fromSource: selected + 1,
        nextCandidate: nextIndex + 1,
        sourceCooldownSeconds: Math.round((cooldowns[selected] - Date.now()) / 1000),
      });
    }
  } finally {
    state.state = 'stopped';
    if (activeChild) terminateChild(activeChild);
    if (server) await new Promise((resolve) => server.close(resolve));
    log('info', 'StreamGuard stopped', { reason: state.stopReason || 'duration_complete', failovers: state.failovers });
  }
}

async function main() {
  if (process.argv.includes('--self-test')) { runSelfTest(); return; }
  const cfg = readConfig();
  process.once('SIGINT', () => requestStop('SIGINT'));
  process.once('SIGTERM', () => requestStop('SIGTERM'));
  await run(cfg);
}

main().catch((err) => {
  log('error', 'Fatal error', { message: err.message });
  process.exitCode = 1;
});
