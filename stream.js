
'use strict';

/**
 * BrowserRelay for webpages you are authorized to rebroadcast.
 * Starts a headful Chrome page in Xvfb; captures its pixels/audio via FFmpeg.
 * No DRM, login, anti-bot or media-access bypass is attempted.
 * Requires: puppeteer, ffmpeg, Xvfb, PulseAudio, openbox.
 * CAUTION: rotate and protect the embedded publishing credentials below.
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

const SERVER = 'rtmp://vsu.okcdn.ru/input/';
const CHANNEL = (process.env.OKRU_STREAM_ID || '1').trim();
const QUALITY = (process.env.STREAM_QUALITY || '720p').trim();

const PROFILES = {
  '360p': [640, 360, 800],
  '480p': [854, 480, 1500],
  '720p': [1280, 720, 3000],
  '1080p': [1920, 1080, 5000]
};

const durationMinutes = Number(process.env.DURATION_MINUTES || 60);
const browserUrl = (process.env.TARGET_URL || '').trim();

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const log = (level, message, context = {}) =>
  console.log(JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...context
  }));

function validate() {
  if (!Object.hasOwn(STREAM_KEYS, CHANNEL)) {
    throw new Error(`Unknown channel ID: ${CHANNEL}`);
  }

  if (!Object.hasOwn(PROFILES, QUALITY)) {
    throw new Error(`Unsupported quality: ${QUALITY}`);
  }

  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1 ||
    durationMinutes > 330
  ) {
    throw new Error('DURATION_MINUTES must be an integer from 1 to 330');
  }

  let parsed;
  try {
    parsed = new URL(browserUrl);
  } catch {
    throw new Error('TARGET_URL must be a full webpage URL');
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP(S) webpages are supported');
  }

  if (!process.env.DISPLAY) {
    throw new Error('DISPLAY is missing; launch via xvfb-run');
  }

  return parsed;
}

function formatDisplay(display) {
  return display.includes('.')
    ? `${display}+0,0`
    : `${display}.0+0,0`;
}

async function waitForPlayer(page) {
  const limit = Date.now() + 35000;

  while (Date.now() < limit) {
    const results = await Promise.all(
      page.frames().map(async (frame) => {
        try {
          return await frame.evaluate(() => {
            const videos = [
              ...document.querySelectorAll('video')
            ];

            for (const v of videos) {
              v.muted = false;
              v.volume = 1;

              if (v.paused) {
                v.play().catch(() => {});
              }
            }

            return videos.length;
          });
        } catch {
          return 0;
        }
      })
    );

    if (results.some(n => n > 0)) return true;

    await sleep(1500);
  }

  return false;
}

async function maximizeVideo(page) {
  for (const frame of page.frames()) {
    try {
      await frame.evaluate(() => {
        const videos = [
          ...document.querySelectorAll('video')
        ];

        if (!videos.length) return;

        const video = videos.sort((a, b) =>
          (b.clientWidth * b.clientHeight) -
          (a.clientWidth * a.clientHeight)
        )[0];

        const style =
          document.getElementById('relay-style') ||
          document.createElement('style');

        style.id = 'relay-style';
        style.textContent =
          `html,body{margin:0!important;background:#000!important;overflow:hidden!important}`;

        document.head.appendChild(style);

        video.style.setProperty(
          'position', 'fixed', 'important'
        );
        video.style.setProperty(
          'inset', '0', 'important'
        );
        video.style.setProperty(
          'width', '100vw', 'important'
        );
        video.style.setProperty(
          'height', '100vh', 'important'
        );
        video.style.setProperty(
          'object-fit', 'contain', 'important'
        );
        video.style.setProperty(
          'z-index', '2147483000', 'important'
        );

        if (video.paused) {
          video.play().catch(() => {});
        }
      });
    } catch {
      // Detached or inaccessible frames can fail.
    }
  }
}

function ffmpegArgs(width, height, videoBitrate, output) {
  const fps = 30;

  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel', 'warning',
    '-stats_period', '5',
    '-progress', 'pipe:3',

    '-thread_queue_size', '512',
    '-f', 'x11grab',
    '-framerate', String(fps),
    '-video_size', `${width}x${height}`,
    '-i', formatDisplay(process.env.DISPLAY),

    '-thread_queue_size', '512',
    '-f', 'pulse',
    '-i', 'stream_sink.monitor',

    '-map', '0:v:0',
    '-map', '1:a:0',

    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',

    '-b:v', `${videoBitrate}k`,
    '-maxrate', `${videoBitrate}k`,
    '-bufsize', `${videoBitrate * 2}k`,

    '-g', String(fps * 2),
    '-keyint_min', String(fps * 2),
    '-sc_threshold', '0',

    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '48000',
    '-ac', '2',

    '-f', 'flv',
    output
  ];
}

function createEncoder(profile, output, abortSignal) {
  const [width, height, bitrate] = profile;

  const child = spawn(
    'ffmpeg',
    ffmpegArgs(width, height, bitrate, output),
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] }
  );

  let lastProgressAt = Date.now();
  let progressText = '';
  let stderrTail = '';
  let terminated = false;

  const watch = setInterval(() => {
    if (
      Date.now() - lastProgressAt > 45000 &&
      !terminated
    ) {
      log('error', 'FFmpeg encoder made no progress in 45 seconds');
      child.kill('SIGTERM');
    }
  }, 5000);

  const stop = () => {
    if (terminated) return;

    terminated = true;
    child.kill('SIGTERM');

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5000);

    timer.unref();
  };

  abortSignal.addEventListener('abort', stop, {
    once: true
  });

  child.stdio[3].on('data', chunk => {
    progressText += chunk.toString('utf8');

    const lines = progressText.split('\n');
    progressText = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('progress=')) {
        lastProgressAt = Date.now();
      }
    }
  });

  child.stderr.on('data', chunk => {
    // Never print raw stderr; it can contain RTMP keys.
    stderrTail = (
      stderrTail + chunk.toString('utf8')
    ).slice(-6000);
  });

  const exited = new Promise(resolve => {
    child.once('error', e =>
      resolve({ error: e.message })
    );

    child.once('close', (code, signal) => {
      clearInterval(watch);

      abortSignal.removeEventListener(
        'abort', stop
      );

      resolve({
        code,
        signal,
        error:
          /Connection refused|broken pipe|Input\/output error/i
            .test(stderrTail)
            ? 'RTMP network failure'
            : undefined
      });
    });
  });

  return { child, stop, exited };
}

async function main() {
  if (process.argv.includes('--check')) {
    console.log(
      'Syntax and module load passed; configured channels:',
      Object.keys(STREAM_KEYS).length
    );
    return;
  }

  const url = validate();

  const [width, height] = PROFILES[QUALITY];
  const output = SERVER + STREAM_KEYS[CHANNEL];

  log('info', 'Starting authorized webpage relay', {
    domain: url.hostname,
    channel: CHANNEL,
    quality: QUALITY,
    durationMinutes
  });

  const controller = new AbortController();

  const shutdown = () => controller.abort();

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  const deadline = setTimeout(
    shutdown,
    durationMinutes * 60000
  );

  let browser;
  let encoder;

  try {
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,

      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',

        '--autoplay-policy=no-user-gesture-required',

        `--window-size=${width},${height}`,
        '--window-position=0,0',
        '--kiosk',
        '--hide-scrollbars'
      ]
    });

    const page =
      (await browser.pages())[0] ||
      await browser.newPage();

    await page.setViewport({
      width,
      height,
      deviceScaleFactor: 1
    });

    await page.goto(browserUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    const found = await waitForPlayer(page);

    if (!found) {
      throw new Error(
        'No HTML5 video found on webpage after 35s. ' +
        'This browser relay does not extract protected media ' +
        'or handle players requiring manual login/interactions.'
      );
    }

    await maximizeVideo(page);

    let lastVideoFrames = -1;
    let lastMediaTime = -1;
    let lastMovement = Date.now();
    let lastReloadAt = 0;
    let reloads = 0;

    const playerMonitor = setInterval(async () => {
      if (controller.signal.aborted) return;

      try {
        let sample = null;

        for (const frame of page.frames()) {
          const value = await frame.evaluate(() => {
            const v = document.querySelector('video');

            if (!v) return null;

            if (v.paused) {
              v.play().catch(() => {});
            }

            return {
              frames:
                v.getVideoPlaybackQuality?.().totalVideoFrames ??
                null,

              time: v.currentTime,
              paused: v.paused
            };
          }).catch(() => null);

          if (value) {
            sample = value;
            break;
          }
        }

        if (!sample) return;

        const moved =
          (
            sample.frames != null &&
            sample.frames > lastVideoFrames
          ) ||
          sample.time > lastMediaTime + 0.1;

        if (moved) {
          lastMovement = Date.now();
        }

        if (sample.frames != null) {
          lastVideoFrames = sample.frames;
        }

        lastMediaTime = sample.time;

        if (
          !moved &&
          Date.now() - lastMovement > 25000 &&
          Date.now() - lastReloadAt > 25000
        ) {
          if (reloads >= 5) {
            log(
              'error',
              'Exceeded webpage reload limit'
            );

            controller.abort();
            return;
          }

          reloads++;
          lastReloadAt = Date.now();

          log(
            'warn',
            'Playback not advancing; reloading page',
            { reloads }
          );

          await page.reload({
            waitUntil: 'domcontentloaded',
            timeout: 45000
          });

          await waitForPlayer(page);
          await maximizeVideo(page);

          lastVideoFrames = -1;
          lastMediaTime = -1;
          lastMovement = Date.now();
        }
      } catch (err) {
        log('warn', 'Player monitor warning', {
          error: err.message
        });
      }
    }, 5000);

    try {
      let consecutiveFailures = 0;

      while (!controller.signal.aborted) {
        encoder = createEncoder(
          PROFILES[QUALITY],
          output,
          controller.signal
        );

        const result = await encoder.exited;

        if (controller.signal.aborted) break;

        consecutiveFailures++;

        log('warn', 'Encoder exited; attempting restart', {
          ...result,
          attempts: consecutiveFailures
        });

        if (consecutiveFailures >= 5) {
          throw new Error(
            'FFmpeg repeatedly failed; check source, ' +
            'PulseAudio, video capture and destination account'
          );
        }

        await sleep(
          Math.min(
            20000,
            consecutiveFailures * 4000
          )
        );
      }
    } finally {
      clearInterval(playerMonitor);
    }
  } finally {
    clearTimeout(deadline);

    if (encoder) encoder.stop();

    if (browser) {
      await browser.close().catch(() => {});
    }

    log('info', 'Relay stopped');
  }
}

main().catch(error => {
  log('error', 'Relay failure', {
    error: error.message
  });

  process.exitCode = 1;
});
