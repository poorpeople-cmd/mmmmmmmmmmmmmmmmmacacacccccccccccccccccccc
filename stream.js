
'use strict';

/**
 * Browser streaming of authorized, unprotected webpages.
 * Regular webpage URLs only; no DRM or access-control bypass.
 * Legacy OK.ru publishing keys are embedded below at user's request.
 * IMPORTANT: rotate these exposed credentials and keep source private.
 */

const puppeteer = require('puppeteer');
const { spawn } = require('node:child_process');

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
  '3.6': '17486007770731_18360310237803_teme2zt4fm',
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

const SERVER = 'rtmp://vsu.okcdn.ru/input/';

const PROFILES = Object.freeze({
  '360p': [640, 360, 800],
  '480p': [854, 480, 1500],
  '720p': [1280, 720, 3000],
  '1080p': [1920, 1080, 5000],
});

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const log = (level, message, details = {}) =>
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...details,
  }));

function parseDuration(text) {
  const raw = String(text || '60m').trim().toLowerCase();

  if (['24/7', 'forever', 'infinite'].includes(raw)) {
    return null;
  }

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return Number(raw) * 60000;
  }

  let total = 0;
  let count = 0;

  const unmatched = raw.replace(
    /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|min|m|seconds?|secs?|s)/g,
    (_, quantity, unit) => {
      count++;
      total += Number(quantity) *
        (/^h/.test(unit) ? 3600000 :
          /^m/.test(unit) ? 60000 : 1000);
      return ' ';
    }
  );

  if (
    unmatched.trim() ||
    !count ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    throw new Error(
      'CUSTOM_DURATION invalid; use 30m, 1h 10m, 24/7'
    );
  }

  return Math.round(total);
}

function config() {
  const urls = String(
    process.env.TARGET_URLS || process.env.TARGET_URL || ''
  )
    .split(/[|,\r\n]+/)
    .map(x => x.trim().split('::')[0].trim())
    .filter(Boolean);

  if (!urls.length || urls.length > 10) {
    throw new Error('Provide 1–10 normal webpage URLs');
  }

  const hosts = urls.map((item, i) => {
    let u;

    try {
      u = new URL(item);
    } catch {
      throw new Error(`Webpage URL ${i + 1} is invalid`);
    }

    if (!['http:', 'https:'].includes(u.protocol)) {
      throw new Error(
        `Webpage URL ${i + 1} must use http(s)`
      );
    }

    return u.hostname;
  });

  const channel = String(
    process.env.OKRU_STREAM_ID || '1'
  ).trim();

  if (!Object.hasOwn(STREAM_KEYS, channel)) {
    throw new Error(`Unknown OKRU_STREAM_ID: ${channel}`);
  }

  const quality = String(
    process.env.STREAM_QUALITY || '720p'
  ).trim();

  if (!Object.hasOwn(PROFILES, quality)) {
    throw new Error(`Unknown STREAM_QUALITY: ${quality}`);
  }

  const audio = String(
    process.env.ENABLE_STREAM_AUDIO || 'ON'
  ).toUpperCase();

  if (!['ON', 'OFF'].includes(audio)) {
    throw new Error('ENABLE_STREAM_AUDIO must be ON or OFF');
  }

  const proxyEngine = String(
    process.env.PROXY_ENGINE || 'None'
  );

  if (!['None', 'Custom proxy'].includes(proxyEngine)) {
    throw new Error('Unsupported PROXY_ENGINE');
  }

  let proxy = null;

  if (proxyEngine === 'Custom proxy') {
    const raw = (
      process.env.BROWSER_PROXY_URL || ''
    ).trim();

    if (!raw) {
      throw new Error(
        'Custom proxy requires BROWSER_PROXY_URL repository secret'
      );
    }

    try {
      proxy = new URL(raw);
    } catch {
      throw new Error(
        'BROWSER_PROXY_URL must be a valid proxy URL'
      );
    }

    if (
      !['http:', 'https:', 'socks5:'].includes(proxy.protocol)
    ) {
      throw new Error(
        'Proxy must be HTTP(S) or SOCKS5'
      );
    }

    if (proxy.username || proxy.password) {
      throw new Error(
        'This version supports unauthenticated proxies only'
      );
    }
  }

  const wanted = parseDuration(
    process.env.CUSTOM_DURATION || '60m'
  );

  const durationMs = Math.min(
    wanted === null ? 330 * 60000 : wanted,
    330 * 60000
  );

  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    throw new Error('Duration must be positive');
  }

  return {
    urls,
    hosts,
    channel,
    quality,
    audio,
    proxy,

    serverSelection: String(
      process.env.SERVER_SELECTION || 'None'
    ).trim(),

    durationMs,

    output: SERVER + STREAM_KEYS[channel],
  };
}

function displayName(value) {
  return value.includes('.')
    ? `${value}+0,0`
    : `${value}.0+0,0`;
}

function encoderArgs(cfg) {
  const [w, h, rate] = PROFILES[cfg.quality];

  const args = [
    '-hide_banner',
    '-nostdin',
    '-loglevel', 'warning',
    '-stats_period', '4',
    '-progress', 'pipe:3',

    '-thread_queue_size', '512',
    '-f', 'x11grab',
    '-framerate', '30',
    '-video_size', `${w}x${h}`,
    '-i', displayName(process.env.DISPLAY),
  ];

  if (cfg.audio === 'ON') {
    args.push(
      '-thread_queue_size', '512',
      '-f', 'pulse',
      '-i', 'stream_sink.monitor'
    );
  } else {
    args.push(
      '-f', 'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000'
    );
  }

  args.push(
    '-map', '0:v:0',
    '-map', '1:a:0',

    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',

    '-pix_fmt', 'yuv420p',
    '-b:v', `${rate}k`,
    '-maxrate', `${rate}k`,
    '-bufsize', `${rate * 2}k`,

    '-g', '60',
    '-keyint_min', '60',
    '-sc_threshold', '0',

    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '48000',
    '-ac', '2',

    '-f', 'flv',
    cfg.output
  );

  return args;
}

function startEncoder(cfg, signal) {
  const child = spawn('ffmpeg', encoderArgs(cfg), {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
  });

  let lastAdvance = Date.now();
  let lastFrames = -1;
  let lastPts = -1;
  let progressText = '';
  let progress = {};
  let stderr = '';
  let stopped = false;
  let resultResolved = false;
  let resolveExit;

  const exited = new Promise(resolve => {
    resolveExit = resolve;
  });

  const finish = (detail) => {
    if (resultResolved) return;

    resultResolved = true;
    clearInterval(watcher);
    signal.removeEventListener('abort', stop);
    resolveExit(detail);
  };

  function stop() {
    if (stopped) return;

    stopped = true;
    child.kill('SIGTERM');

    const force = setTimeout(
      () => child.kill('SIGKILL'),
      5000
    );

    force.unref();
  }

  child.once('error', e =>
    finish({ error: e.code || e.message })
  );

  child.once('close', (code, sig) => {
    finish({
      code,
      signal: sig,

      cause:
        /Connection refused|broken pipe|Input\/output error/i
          .test(stderr)
          ? 'RTMP connection error'
          : 'Encoder ended'
    });
  });

  signal.addEventListener('abort', stop, {
    once: true
  });

  child.stdio[3].on('data', bytes => {
    progressText += bytes.toString('utf8');

    if (progressText.length > 100000) {
      progressText = progressText.slice(-10000);
    }

    let idx;

    while (
      (idx = progressText.indexOf('\n')) >= 0
    ) {
      const line = progressText
        .slice(0, idx)
        .trim();

      progressText = progressText.slice(idx + 1);

      const sep = line.indexOf('=');

      if (sep < 1) continue;

      progress[line.slice(0, sep)] =
        line.slice(sep + 1);

      if (!line.startsWith('progress=')) {
        continue;
      }

      const f = Number(progress.frame);

      const pts = Number(
        progress.out_time_us ??
        progress.out_time_ms
      );

      if (
        (Number.isFinite(f) && f > lastFrames) ||
        (Number.isFinite(pts) && pts > lastPts)
      ) {
        lastAdvance = Date.now();
      }

      if (Number.isFinite(f)) {
        lastFrames = Math.max(f, lastFrames);
      }

      if (Number.isFinite(pts)) {
        lastPts = Math.max(pts, lastPts);
      }

      progress = {};
    }
  });

  child.stderr.on('data', bytes => {
    stderr = (
      stderr + bytes.toString('utf8')
    ).slice(-5000);
  });

  const watcher = setInterval(() => {
    if (
      !stopped &&
      Date.now() - lastAdvance > 45000
    ) {
      log(
        'warn',
        'FFmpeg output not advancing; restarting'
      );

      stop();
    }
  }, 5000);

  return { exited, stop };
}

async function mediaSample(page, unmute) {
  const readings = await Promise.all(
    page.frames().map(
      frame => frame.evaluate((hasAudio) => {
        const videos = [
          ...document.querySelectorAll('video')
        ];

        if (!videos.length) return null;

        videos.sort(
          (a, b) =>
            (b.clientWidth * b.clientHeight) -
            (a.clientWidth * a.clientHeight)
        );

        const v = videos[0];

        v.muted = !hasAudio;

        if (hasAudio) {
          v.volume = 1;
        }

        if (v.paused) {
          v.play().catch(() => {});
        }

        const n =
          v.getVideoPlaybackQuality?.().totalVideoFrames;

        return {
          time: Number(v.currentTime),

          frames: Number.isFinite(n)
            ? n
            : null,

          paused: v.paused,
          ready: v.readyState,
          width: v.videoWidth,
          height: v.videoHeight
        };
      }, unmute).catch(() => null)
    )
  );

  return readings.find(
    x => x && x.width > 0 && x.height > 0
  ) || readings.find(Boolean) || null;
}

async function chooseServer(page, label) {
  if (
    !label ||
    label.toLowerCase() === 'none'
  ) {
    return;
  }

  for (const frame of page.frames()) {
    try {
      const clicked = await frame.evaluate(
        (name) => {
          const elems = [
            ...document.querySelectorAll(
              'button,a,[role="button"],input[type="button"]'
            )
          ];

          const normalized = (s) =>
            String(s || '')
              .trim()
              .toLowerCase();

          const match = elems.find(
            el => normalized(
              el.innerText ||
              el.value ||
              el.getAttribute('aria-label')
            ) === normalized(name)
          );

          if (!match) return false;

          match.click();

          return true;
        },
        label
      );

      if (clicked) {
        log(
          'info',
          'Requested server button clicked',
          { button: label }
        );

        await sleep(2000);
        return;
      }
    } catch {
      // Frame may have detached.
    }
  }

  log(
    'warn',
    'No matching server button found; leaving the webpage unchanged'
  );
}

async function maximizeVideo(page) {
  for (const frame of page.frames()) {
    try {
      await frame.evaluate(() => {
        const v = [
          ...document.querySelectorAll('video')
        ].sort(
          (a, b) =>
            (b.clientWidth * b.clientHeight) -
            (a.clientWidth * a.clientHeight)
        )[0];

        if (!v) return;

        const style =
          document.getElementById('relay-css') ||
          document.createElement('style');

        style.id = 'relay-css';

        style.textContent =
          'html,body{margin:0!important;background:#000!important;overflow:hidden!important;}';

        (
          document.head ||
          document.documentElement
        ).appendChild(style);

        v.style.cssText =
          'position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;object-fit:contain!important;z-index:2147483000!important;';
      });
    } catch {
      // Iframe may be navigating.
    }
  }

  await page.evaluate(() => {
    const items = [
      ...document.querySelectorAll('iframe')
    ].filter(
      x =>
        x.clientWidth > 100 &&
        x.clientHeight > 70
    );

    if (items.length === 1) {
      items[0].style.cssText =
        'position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;border:0!important;z-index:2147482999!important;';
    }
  }).catch(() => {});
}

async function openSource(
  page,
  cfg,
  preferredIndex,
  signal
) {
  for (
    let attempt = 0;
    attempt < cfg.urls.length;
    attempt++
  ) {
    if (signal.aborted) return -1;

    const index =
      (preferredIndex + attempt) %
      cfg.urls.length;

    log('info', 'Opening authorized webpage', {
      sourceIndex: index + 1,
      host: cfg.hosts[index]
    });

    try {
      await page.goto(cfg.urls[index], {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });

      await chooseServer(
        page,
        cfg.serverSelection
      );

      const deadline =
        Date.now() + 25000;

      while (
        Date.now() < deadline &&
        !signal.aborted
      ) {
        const sample = await mediaSample(
          page,
          cfg.audio === 'ON'
        );

        if (
          sample &&
          sample.width > 0 &&
          sample.height > 0
        ) {
          await maximizeVideo(page);
          return index;
        }

        await sleep(1500);
      }

      log(
        'warn',
        'No usable HTML5 video found',
        { sourceIndex: index + 1 }
      );
    } catch (err) {
      log(
        'warn',
        'Page navigation failed',
        {
          sourceIndex: index + 1,
          error: err.message.slice(0, 120)
        }
      );
    }
  }

  return -1;
}

async function monitorPage(
  page,
  cfg,
  signal,
  requestStop,
  initialIndex
) {
  let sourceIndex = initialIndex;

  let frames = null;
  let time = null;

  let lastMovementAt = Date.now();
  let recovering = 0;

  while (!signal.aborted) {
    await sleep(4000);

    if (signal.aborted) break;

    if (!page.browser().isConnected()) {
      throw new Error('Chrome disconnected');
    }

    const sample = await mediaSample(
      page,
      cfg.audio === 'ON'
    );

    const moved = sample && (
      (
        sample.frames != null &&
        (
          frames == null ||
          sample.frames > frames
        )
      ) ||
      (
        Number.isFinite(sample.time) &&
        (
          time == null ||
          sample.time > time + 0.1
        )
      )
    );

    if (moved) {
      lastMovementAt = Date.now();
    }

    if (sample) {
      if (sample.frames != null) {
        frames = sample.frames;
      }

      if (Number.isFinite(sample.time)) {
        time = sample.time;
      }
    }

    if (
      Date.now() - lastMovementAt < 25000
    ) {
      continue;
    }

    recovering++;

    log(
      'warn',
      'Video playback not advancing; attempting failover/reload',
      {
        recoveries: recovering,
        sourceIndex: sourceIndex + 1
      }
    );

    if (recovering > 6) {
      throw new Error(
        'Playback remained unavailable after six recoveries'
      );
    }

    sourceIndex = await openSource(
      page,
      cfg,
      (
        sourceIndex +
        (cfg.urls.length > 1 ? 1 : 0)
      ) % cfg.urls.length,
      signal
    );

    if (sourceIndex < 0) {
      throw new Error(
        'Could not reopen any playable HTML5 source'
      );
    }

    frames = null;
    time = null;
    lastMovementAt = Date.now();
  }

  requestStop();
}

async function main() {
  if (
    process.argv.includes('--check')
  ) {
    const cfg = config();

    log(
      'info',
      'Configuration valid',
      {
        channels: Object.keys(STREAM_KEYS).length,
        sourceCount: cfg.urls.length,
        quality: cfg.quality,
        audio: cfg.audio,
        durationMinutes:
          cfg.durationMs / 60000,

        proxyEngine: cfg.proxy
          ? 'Custom proxy'
          : 'None'
      }
    );

    return;
  }

  const cfg = config();

  if (!process.env.DISPLAY) {
    throw new Error(
      'DISPLAY missing: run via xvfb-run'
    );
  }

  const [width, height] =
    PROFILES[cfg.quality];

  const controller =
    new AbortController();

  const stop = () =>
    controller.abort();

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const durationTimer = setTimeout(
    stop,
    cfg.durationMs
  );

  let browser;
  let encoder;

  try {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',

      `--window-size=${width},${height}`,

      '--window-position=0,0',
      '--kiosk',
      '--hide-scrollbars'
    ];

    if (cfg.proxy) {
      args.push(
        `--proxy-server=${cfg.proxy.href}`
      );
    }

    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args
    });

    const page =
      (await browser.pages())[0] ||
      await browser.newPage();

    await page.setViewport({
      width,
      height,
      deviceScaleFactor: 1
    });

    log(
      'info',
      'Started browser capture',
      {
        sources: cfg.urls.length,
        channel: cfg.channel,
        quality: cfg.quality
      }
    );

    const initialIndex = await openSource(
      page,
      cfg,
      0,
      controller.signal
    );

    if (initialIndex < 0) {
      throw new Error(
        'No accessible HTML5 video found in supplied webpages'
      );
    }

    const monitoring = monitorPage(
      page,
      cfg,
      controller.signal,
      stop,
      initialIndex
    );

    let done = false;

    monitoring.then(
      () => {
        done = true;
        stop();
      }
    ).catch(
      err => {
        done = true;

        log(
          'error',
          'Playback monitor failed',
          { error: err.message }
        );

        stop();
      }
    );

    let restarts = 0;

    while (
      !controller.signal.aborted &&
      !done
    ) {
      encoder = startEncoder(
        cfg,
        controller.signal
      );

      const outcome =
        await encoder.exited;

      if (controller.signal.aborted) {
        break;
      }

      restarts++;

      log(
        'warn',
        'Encoder exited; restarting',
        {
          attempts: restarts,
          detail: outcome
        }
      );

      if (restarts >= 5) {
        throw new Error(
          'FFmpeg could not maintain an output after five attempts'
        );
      }

      await sleep(
        Math.min(
          15000,
          restarts * 3000
        )
      );
    }

    await monitoring;
  } finally {
    clearTimeout(durationTimer);

    stop();

    if (encoder) {
      encoder.stop();
    }

    if (browser) {
      await browser.close()
        .catch(() => {});
    }

    log(
      'info',
      'Browser relay stopped'
    );
  }
}

main().catch(err => {
  log(
    'error',
    'Fatal failure',
    { error: err.message }
  );

  process.exitCode = 1;
});
