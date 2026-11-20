
const puppeteer = require('puppeteer');

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const { OBSWebSocket } = require('obs-websocket-js');

// ============================================================
// GLOBAL CRASH SHIELD
// ============================================================
process.on('uncaughtException', (err) =>
    console.error('[CRASH] UNCAUGHT EXCEPTION:', err.message)
);
process.on('unhandledRejection', (reason) =>
    console.error('[CRASH] UNHANDLED REJECTION:', reason)
);

const obs = new OBSWebSocket();

// ============================================================
// CONFIGURATION
// ============================================================
const selectedQuality = process.env.STREAM_QUALITY || '720p';
const SERVER_SELECTION = (process.env.SERVER_SELECTION || 'None').trim();
const PROXY_ENGINE = process.env.PROXY_ENGINE || 'Disabled';
const ENABLE_STREAM_AUDIO = process.env.ENABLE_STREAM_AUDIO !== 'OFF';
const SELECTED_CHANNEL = (process.env.OKRU_STREAM_ID || '1').trim();

const FORCE_REFRESH_MS = 900000000 * 60 * 1000;

const NO_REFRESH_DOMAINS = (
    process.env.NO_REFRESH_DOMAINS || ''
).split(',').map(x => x.trim()).filter(Boolean);

let RES_W = 1280;
let RES_H = 720;
let BITRATE = 3000;

if (selectedQuality === '360p') {
    RES_W = 640; RES_H = 360; BITRATE = 800;
} else if (selectedQuality === '480p') {
    RES_W = 854; RES_H = 480; BITRATE = 1500;
} else if (selectedQuality === '720p') {
    RES_W = 1280; RES_H = 720; BITRATE = 3000;
} else if (selectedQuality.includes('1080p')) {
    RES_W = 1920; RES_H = 1080; BITRATE = 4500;
}

// ============================================================
// STREAM KEYS — INSERT YOUR OWN KEYS
// ============================================================
// Never commit real keys to a public repository.
// Alternatively, supply OKRU_STREAM_KEY as an environment secret.

const STREAM_KEYS = {
    '1'    : '',
    '1.1'  : '',
    '1.2'  : '',
    '1.3'  : '',
    '1.4'  : '',
    '1.5'  : '',
    '1.6'  : '',
    '1.7'  : '',
    '1.8'  : '',
    '1.9'  : '',
    '1.10' : '',
    '1.11' : '',
    '2'    : '',
    '2.1'  : '',
    '2.2'  : '',
    '3'    : '',
    '3.1'  : '',
    '3.2'  : '',
    '3.3'  : '',
    '3.4'  : '',
    '3.5'  : '',
    '3.6'  : '',
    '4'    : '',
    '4.1'  : '',
    '4.2'  : '',
    '4.3'  : '',
    '4.4'  : '',
    '4.5'  : '',
    '5'    : '17135767461483_18625099401835_4gpytlxk4a',
    '5.1'  : '15273713933931_15317494860395_avj47smmim',
    '5.2'  : '',
    '5.3'  : '',
    '5.4'  : '',
    '5.5'  : '',
    '5.6'  : '',
    '5.7'  : '',
    's1.1' : '',
    's1.2' : '',
    's1.3' : '',
    's1.4' : '',
    's1.5' : '',
    's1.6' : '',
    's1.7' : '',
    's1.8' : '',
    's1.9' : '',
    's1.10': '',
    's2.1' : '',
    's2.2' : '',
    's2.3' : '',
    's2.4' : '',
    's2.5' : '',
    's2.6' : '',
    's2.7' : '',
    's2.8' : '',
    's2.9' : '',
    's2.10': ''
};

const ACTIVE_STREAM_KEY = String(
    process.env.OKRU_STREAM_KEY ||
    STREAM_KEYS[SELECTED_CHANNEL] ||
    ''
).trim();

// ============================================================
// MULTI-URL PARSER
// ============================================================
const rawUrls = (process.env.TARGET_URLS || '').trim();

const urlList = rawUrls
    .split(/[,|]/)
    .map(u => {
        let clean = u.split('::')[0].trim().replace(/^!/, '');
        if (clean && !clean.startsWith('http')) {
            clean = 'https://' + clean;
        }
        return clean;
    })
    .filter(u => u.length > 8);

if (!urlList.length || !ACTIVE_STREAM_KEY) {
    console.error(
        '[CONFIG] Set TARGET_URLS (authorized player URL) ' +
        'and OKRU_STREAM_KEY (your own destination key).'
    );
    process.exit(1);
}

let currentUrlIndex = 0;
let browser = null;
let page = null;
let obsProcess = null;

// ============================================================
// MONITORING STATE
// ============================================================
let netStats = {
    lastSegmentOkTime: Date.now(),
    segmentErrorCount: 0,
    lastHttpStatus: 200,
    lastMediaSeq: null,
    lastSeqAdvanceTime: Date.now(),
    staleManifestCount: 0,
    programDateTimeLagSec: 0,
    seenManifest: false,
    hlsPlaylists: new Map()
};

let visualStats = {
    lastCheckTime: 0,
    lastHash: null,
    sameHashSince: Date.now(),
    recentHashes: []
};

function resetMonitorStats() {
    netStats = {
        lastSegmentOkTime: Date.now(),
        segmentErrorCount: 0,
        lastHttpStatus: 200,
        lastMediaSeq: null,
        lastSeqAdvanceTime: Date.now(),
        staleManifestCount: 0,
        programDateTimeLagSec: 0,
        seenManifest: false,
        hlsPlaylists: new Map()
    };

    visualStats = {
        lastCheckTime: 0,
        lastHash: null,
        sameHashSince: Date.now(),
        recentHashes: []
    };
}

console.log(
    `[ENGINE] ${RES_W}x${RES_H} @ ${BITRATE}kbps | ` +
    `Channel: ${SELECTED_CHANNEL}`
);

console.log(
    `[URLS] Loaded ${urlList.length} authorized player URL(s).`
);

// ============================================================
// OBS CONFIGURATION
// ============================================================
function setupOBSConfig() {
    const obsDir = path.join(os.homedir(), '.config', 'obs-studio');
    const profilesDir = path.join(
        obsDir, 'basic', 'profiles', 'Untitled'
    );
    const scenesDir = path.join(obsDir, 'basic', 'scenes');
    const wsPluginDir = path.join(
        obsDir, 'plugin_config', 'obs-websocket'
    );

    fs.mkdirSync(profilesDir, { recursive: true });
    fs.mkdirSync(scenesDir, { recursive: true });
    fs.mkdirSync(wsPluginDir, { recursive: true });

    fs.writeFileSync(
        path.join(obsDir, 'global.ini'),
        `[General]\nLicenseAccepted=true\nFirstRun=true\n` +
        `[BasicWindow]\nShowAutoConfig=false\nWarned=true\n` +
        `[OBSWebSocket]\nServerEnabled=true\nServerPort=4455\nServerPassword=secret\n`
    );

    fs.writeFileSync(
        path.join(wsPluginDir, 'config.json'),
        JSON.stringify({
            alerts_enabled: false,
            auth_required: true,
            first_load: false,
            server_enabled: true,
            server_password: 'secret',
            server_port: 4455
        }, null, 2)
    );

    fs.writeFileSync(
        path.join(profilesDir, 'basic.ini'),
        `[General]\nName=Untitled\n` +
        `[Video]\nBaseCX=${RES_W}\nBaseCY=${RES_H}\n` +
        `OutputCX=${RES_W}\nOutputCY=${RES_H}\nFPSCommon=30\n` +
        `[Output]\nMode=Advanced\n` +
        `[AdvOut]\nTrackIndex=1\nRecType=Standard\nEncoder=obs_x264\n` +
        `[obs_x264]\nbitrate=${BITRATE}\nkeyint_sec=2\n` +
        `preset=ultrafast\nprofile=main\ntune=zerolatency\n`
    );

    const serviceJson = {
        settings: {
            server: 'rtmp://vsu.okcdn.ru/input/',
            key: ACTIVE_STREAM_KEY.trim()
        },
        type: 'rtmp_custom'
    };

    fs.writeFileSync(
        path.join(profilesDir, 'service.json'),
        JSON.stringify(serviceJson, null, 2)
    );

    const sceneJson = {
        current_scene: 'MainScene',
        current_program_scene: 'MainScene',
        name: 'Untitled',
        scene_order: [
            { name: 'WaitingScene' },
            { name: 'MainScene' }
        ],
        sources: [
            {
                id: 'xshm_input',
                name: 'Screen',
                settings: { show_cursor: false }
            },
            {
                id: 'pulse_output_capture',
                name: 'Audio',
                settings: {}
            },
            {
                id: 'scene',
                name: 'MainScene',
                settings: {
                    items: [
                        { name: 'Screen', id: 1, visible: true },
                        { name: 'Audio', id: 2, visible: true }
                    ]
                }
            },
            {
                id: 'scene',
                name: 'WaitingScene',
                settings: {
                    items: [
                        { name: 'Screen', id: 1, visible: true }
                    ]
                }
            }
        ]
    };

    fs.writeFileSync(
        path.join(scenesDir, 'Untitled.json'),
        JSON.stringify(sceneJson, null, 2)
    );
}

// ============================================================
// X11 WINDOW MANAGEMENT
// ============================================================
function keepChromeOnTopAndHideOBS() {
    try {
        execSync(
            'xdotool search --name "OBS" windowmove 5000 5000 windowminimize || true',
            { stdio: 'ignore' }
        );
        execSync(
            `xdotool search --onlyvisible --class "chrome" ` +
            `windowmove 0 0 windowsize ${RES_W} ${RES_H} ` +
            `windowactivate || true`,
            { stdio: 'ignore' }
        );
        execSync(
            'wmctrl -a "Chrome" || true',
            { stdio: 'ignore' }
        );
    } catch (e) {}
}

// ============================================================
// HLS PER-PLAYLIST MEDIA SEQUENCE MONITOR
// ============================================================
// Advisory only: manifests do not identify the rendition
// actually being decoded by the player.

function recordHlsManifest(
    rawUrl,
    body,
    stats = netStats,
    now = Date.now()
) {
    if (typeof body !== 'string') return;

    const lines = body
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map(x => x.trim());

    if (lines[0] !== '#EXTM3U') return;

    // Master playlists do not have EXT-X-TARGETDURATION.
    const targetLine = lines.find(x =>
        /^#EXT-X-TARGETDURATION:\d+\s*$/.test(x)
    );

    if (!targetLine) return;

    let playlistUrl;

    try {
        const u = new URL(rawUrl);
        u.hash = '';

        // Remove LL-HLS delivery directives but keep rendition
        // and other playlist-identifying query parameters.
        for (const p of [
            '_HLS_msn',
            '_HLS_part',
            '_HLS_skip'
        ]) {
            u.searchParams.delete(p);
        }

        u.searchParams.sort();
        playlistUrl = u.toString();
    } catch {
        return;
    }

    // Finished playlists do not need to advance.
    if (
        lines.includes('#EXT-X-ENDLIST') ||
        lines.includes('#EXT-X-PLAYLIST-TYPE:VOD')
    ) {
        stats.hlsPlaylists.delete(playlistUrl);
        return;
    }

    const sequenceLine = lines.find(x =>
        /^#EXT-X-MEDIA-SEQUENCE:\d+\s*$/.test(x)
    );

    const sequence = sequenceLine
        ? Number(sequenceLine.split(':')[1])
        : 0;

    const targetDurationSec = Number(
        targetLine.split(':')[1]
    );

    if (
        !Number.isSafeInteger(sequence) ||
        !Number.isFinite(targetDurationSec) ||
        targetDurationSec < 1
    ) {
        return;
    }

    let completedSegments = 0;
    let trailingParts = 0;
    let skippedSegments = 0;

    for (const line of lines) {
        if (line.startsWith('#EXTINF:')) {
            completedSegments++;
            trailingParts = 0;
        } else if (line.startsWith('#EXT-X-PART:')) {
            trailingParts++;
        } else if (line.startsWith('#EXT-X-SKIP:')) {
            const m = line.match(/SKIPPED-SEGMENTS=(\d+)/);

            if (m) {
                skippedSegments = Number(m[1]);
            }
        }
    }

    if (
        completedSegments === 0 &&
        trailingParts === 0
    ) {
        return;
    }

    // Next segment sequence at the end of the playlist.
    // This recognizes EVENT and LL-HLS updates even when
    // MEDIA-SEQUENCE itself remains unchanged.
    const edge =
        sequence + skippedSegments + completedSegments;

    if (!Number.isSafeInteger(edge)) return;

    const previous = stats.hlsPlaylists.get(playlistUrl);

    const progressed =
        !previous ||
        edge > previous.edge ||
        (
            edge === previous.edge &&
            trailingParts > previous.trailingParts
        ) ||
        edge < previous.edge;

    stats.hlsPlaylists.delete(playlistUrl);

    stats.hlsPlaylists.set(playlistUrl, {
        edge,
        trailingParts,
        targetMs: targetDurationSec * 1000,
        lastSeenAt: now,
        lastProgressAt: progressed
            ? now
            : previous.lastProgressAt,
        samples:
            previous && edge >= previous.edge
                ? previous.samples + 1
                : 1
    });

    // Bound memory use for long-running sessions.
    while (stats.hlsPlaylists.size > 48) {
        stats.hlsPlaylists.delete(
            stats.hlsPlaylists.keys().next().value
        );
    }

    stats.seenManifest = true;

    // Informational only. Never compare global sequence
    // values belonging to different playlists.
    stats.lastMediaSeq = sequence;

    if (progressed) {
        stats.lastSeqAdvanceTime = now;
    }

    // Preserve Program-Date-Time telemetry.
    const pdtLine = lines
        .filter(x =>
            x.startsWith('#EXT-X-PROGRAM-DATE-TIME:')
        )
        .at(-1);

    if (pdtLine) {
        const pdt = Date.parse(
            pdtLine.slice(
                '#EXT-X-PROGRAM-DATE-TIME:'.length
            )
        );

        if (Number.isFinite(pdt)) {
            stats.programDateTimeLagSec = Math.round(
                (now - pdt) / 1000
            );
        }
    }
}

function getHlsManifestState(now = Date.now()) {
    const recentlyPolled = [
        ...netStats.hlsPlaylists.values()
    ].filter(item =>
        item.samples >= 2 &&
        now - item.lastSeenAt <=
            Math.max(30000, 3 * item.targetMs)
    );

    if (!recentlyPolled.length) {
        return 'HLS_UNKNOWN';
    }

    // If ANY recently polled live rendition advanced,
    // avoid reporting a global stale-manifest failure.
    const hasRecentProgress = recentlyPolled.some(item =>
        now - item.lastProgressAt <=
            Math.max(25000, 4 * item.targetMs)
    );

    return hasRecentProgress
        ? 'OK'
        : 'STALE_MANIFEST_SUSPECT';
}

// ============================================================
// PAGE NETWORK RESPONSE MONITORING
// ============================================================
async function setupPageProtections(p) {
    try {
        p.on('response', async (res) => {
            try {
                const url = res.url().toLowerCase();
                const status = res.status();

                const isManifest =
                    url.includes('.m3u8') ||
                    url.includes('.mpd');

                const isSegment =
                    url.includes('.ts') ||
                    url.includes('.m4s') ||
                    url.includes('.aac') ||
                    url.includes('.mp4');

                if (isManifest || isSegment) {
                    netStats.lastHttpStatus = status;

                    if (status >= 200 && status < 400) {
                        netStats.lastSegmentOkTime =
                            Date.now();
                        netStats.segmentErrorCount = 0;
                    } else if (status >= 400) {
                        netStats.segmentErrorCount++;
                    }
                }

                // 304 responses have no body to parse.
                if (
                    url.includes('.m3u8') &&
                    status === 200
                ) {
                    const sessionStats = netStats;

                    const body = await res.text()
                        .catch(() => '');

                    // Ignore responses belonging to a previous
                    // monitoring session after URL failover.
                    if (
                        sessionStats === netStats &&
                        body
                    ) {
                        recordHlsManifest(
                            res.url(),
                            body,
                            sessionStats
                        );
                    }
                }
            } catch (e) {}
        });

        p.on('requestfailed', (req) => {
            const url = req.url().toLowerCase();

            if (
                url.includes('.m3u8') ||
                url.includes('.ts') ||
                url.includes('.m4s')
            ) {
                netStats.segmentErrorCount++;
            }
        });

        await p.evaluateOnNewDocument(() => {
            const style = document.createElement('style');

            style.textContent =
                'html, body {' +
                'background-color:#000 !important;' +
                'overflow:hidden !important;' +
                'margin:0 !important;' +
                '}';

            if (document.documentElement) {
                document.documentElement.appendChild(style);
            }
        });
    } catch (e) {}
}

// ============================================================
// LOADING OVERLAY
// ============================================================
async function showLoadingOverlay(p, title, subtitle) {
    try {
        await p.evaluate((t, s) => {
            if (window.self !== window.top) return;

            let el = document.getElementById(
                'bot-loading-ui'
            );

            if (!el) {
                el = document.createElement('div');
                el.id = 'bot-loading-ui';

                el.style.cssText =
                    'position:fixed;' +
                    'inset:0;' +
                    'width:100vw;' +
                    'height:100vh;' +
                    'background:#000;' +
                    'z-index:2147483647;' +
                    'display:flex;' +
                    'flex-direction:column;' +
                    'justify-content:center;' +
                    'align-items:center;' +
                    'color:#fff;' +
                    'font-family:sans-serif;';

                document.documentElement.appendChild(el);
            }

            el.innerHTML =
                `<h1 style="font-size:38px;margin-bottom:10px;color:#e50914;">${t}</h1>` +
                `<p style="font-size:20px;color:#aaa;">${s}</p>`;
        }, title, subtitle);
    } catch (e) {}
}

async function hideLoadingOverlay(p) {
    try {
        await p.evaluate(() => {
            const el = document.getElementById(
                'bot-loading-ui'
            );
            if (el) el.remove();
        });
    } catch (e) {}
}

// ============================================================
// VIDEO PLAYER AUTO-PLAY AND FULLSCREEN
// ============================================================
async function lockAndPlayVideo(p) {
    if (!p) return;

    try {
        if (SERVER_SELECTION !== 'None') {
            await p.evaluate((srv) => {
                const btn = Array.from(
                    document.querySelectorAll('button, a, div')
                ).find(b =>
                    b.innerText &&
                    b.innerText.trim().includes(srv)
                );

                if (btn) btn.click();
            }, SERVER_SELECTION).catch(() => {});

            await new Promise(r =>
                setTimeout(r, 2000)
            );
        }

        for (let attempt = 0; attempt < 8; attempt++) {
            let playing = false;

            for (const frame of p.frames()) {
                if (frame.isDetached()) continue;

                try {
                    const status = await frame.evaluate(
                        (audioEnabled) => {
                            const selectors =
                                '.jw-icon-display, ' +
                                '.jw-icon-playback, ' +
                                '.jw-icon-live, ' +
                                'button[data-plyr="play"], ' +
                                '.vjs-big-play-button, ' +
                                '.vjs-play-control, ' +
                                '.vjs-live-control, ' +
                                '[class*="unmute"], ' +
                                '.fp-play, ' +
                                '.clappr-player, video';

                            document.querySelectorAll(
                                selectors
                            ).forEach(el => {
                                try { el.click(); }
                                catch (e) {}
                            });

                            let isPlaying = false;

                            document.querySelectorAll(
                                'video'
                            ).forEach(v => {
                                if (v.paused) {
                                    v.play().catch(() => {});
                                }

                                v.muted = !audioEnabled;
                                v.volume = audioEnabled
                                    ? 1.0 : 0.0;

                                if (
                                    !v.paused &&
                                    v.readyState >= 2
                                ) {
                                    isPlaying = true;
                                }
                            });

                            return isPlaying;
                        },
                        ENABLE_STREAM_AUDIO
                    );

                    if (status) {
                        playing = true;
                        break;
                    }
                } catch (e) {}
            }

            if (playing) break;

            await new Promise(r =>
                setTimeout(r, 1500)
            );
        }

        for (const frame of p.frames()) {
            if (frame.isDetached()) continue;

            await frame.evaluate((audioEnabled) => {
                if (window.__frameLockActive) return;

                window.__frameLockActive = true;

                setInterval(() => {
                    document.documentElement.style
                        .setProperty(
                            'background',
                            '#000',
                            'important'
                        );

                    if (document.body) {
                        document.body.style.setProperty(
                            'background',
                            '#000',
                            'important'
                        );
                    }

                    const v =
                        document.querySelector('video');

                    if (v) {
                        if (v.paused) {
                            v.play().catch(() => {});

                            const resumeSelectors =
                                '.jw-icon-display, ' +
                                '.jw-icon-playback, ' +
                                'button[data-plyr="play"], ' +
                                '.vjs-play-control, ' +
                                '.vjs-big-play-button, ' +
                                '.fp-play';

                            document.querySelectorAll(
                                resumeSelectors
                            ).forEach(btn => {
                                try { btn.click(); }
                                catch (e) {}
                            });
                        }

                        const liveBtns =
                            document.querySelectorAll(
                                '.jw-icon-live, ' +
                                '.vjs-live-control, ' +
                                '[class*="live-button"], ' +
                                '[aria-label*="Live"]'
                            );

                        liveBtns.forEach(btn => {
                            const cls = (
                                btn.className || ''
                            ).toString().toLowerCase();

                            if (
                                cls.includes('not-live') ||
                                cls.includes('behind') ||
                                cls.includes('dvr')
                            ) {
                                try { btn.click(); }
                                catch (e) {}
                            }
                        });

                        if (
                            v.clientWidth > 50 ||
                            !v.paused
                        ) {
                            v.muted = !audioEnabled;
                            v.volume = audioEnabled
                                ? 1.0 : 0.0;

                            const wrap = v.closest(
                                '.jwplayer, #player, ' +
                                '.plyr, .vjs-player, ' +
                                '[data-player], .player-poster'
                            ) || v;

                            wrap.style.cssText =
                                'position:fixed !important;' +
                                'top:0 !important;' +
                                'left:0 !important;' +
                                'width:100vw !important;' +
                                'height:100vh !important;' +
                                'z-index:2147483646 !important;' +
                                'background:#000 !important;';

                            v.style.cssText =
                                'width:100% !important;' +
                                'height:100% !important;' +
                                'object-fit:contain !important;';

                            document.querySelectorAll(
                                '.jw-controls, ' +
                                '.plyr__controls, ' +
                                '.vjs-control-bar'
                            ).forEach(c =>
                                c.style.setProperty(
                                    'display',
                                    'none',
                                    'important'
                                )
                            );

                            return;
                        }
                    }

                    const iframes = Array.from(
                        document.querySelectorAll('iframe')
                    );

                    let best = null;
                    let maxArea = 5000;

                    iframes.forEach(f => {
                        const area =
                            f.clientWidth * f.clientHeight;

                        if (
                            area > maxArea &&
                            f.clientWidth >= f.clientHeight
                        ) {
                            maxArea = area;
                            best = f;
                        }
                    });

                    if (best) {
                        iframes.forEach(f => {
                            if (f !== best) {
                                f.style.setProperty(
                                    'display',
                                    'none',
                                    'important'
                                );
                            }
                        });

                        best.style.cssText =
                            'position:fixed !important;' +
                            'top:0 !important;' +
                            'left:0 !important;' +
                            'width:100vw !important;' +
                            'height:100vh !important;' +
                            'z-index:2147483645 !important;' +
                            'border:none !important;' +
                            'background:#000 !important;' +
                            'display:block !important;' +
                            'visibility:visible !important;';
                    }
                }, 1000);
            }, ENABLE_STREAM_AUDIO).catch(() => {});
        }
    } catch (e) {}
}

// ============================================================
// VISUAL FRAME FRESHNESS
// ============================================================
async function checkVisualFreshness(p) {
    const now = Date.now();

    if (
        now - visualStats.lastCheckTime < 6000
    ) {
        return { visualStatus: 'OK' };
    }

    visualStats.lastCheckTime = now;

    try {
        const buf = await p.screenshot({
            type: 'jpeg',
            quality: 25,
            clip: {
                x: Math.floor(RES_W * 0.15),
                y: Math.floor(RES_H * 0.15),
                width: Math.floor(RES_W * 0.7),
                height: Math.floor(RES_H * 0.7)
            }
        });

        const frameHash = crypto
            .createHash('md5')
            .update(buf)
            .digest('hex')
            .slice(0, 12);

        if (visualStats.lastHash === frameHash) {
            const frozenMs =
                now - visualStats.sameHashSince;

            if (frozenMs > 18000) {
                return {
                    visualStatus: 'VISUAL_FROZEN',
                    frozenSec: Math.round(
                        frozenMs / 1000
                    ),
                    hash: frameHash
                };
            }
        } else {
            visualStats.lastHash = frameHash;
            visualStats.sameHashSince = now;

            visualStats.recentHashes.push(frameHash);

            if (visualStats.recentHashes.length > 18) {
                visualStats.recentHashes.shift();
            }

            const occurrences =
                visualStats.recentHashes.filter(
                    h => h === frameHash
                ).length;

            if (occurrences >= 5) {
                return {
                    visualStatus: 'CONTENT_LOOP',
                    hash: frameHash
                };
            }
        }

        return {
            visualStatus: 'OK',
            hash: frameHash
        };
    } catch (e) {
        return { visualStatus: 'OK' };
    }
}

// ============================================================
// PLAYBACK HEALTH
// ============================================================
async function checkStreamHealth(p) {
    if (!p) return { status: 'DEAD' };

    try {
        const checks = p.frames().map(async (frame) => {
            if (frame.isDetached()) return null;

            try {
                return await Promise.race([
                    frame.evaluate(() => {
                        const v =
                            document.querySelector('video');

                        if (!v) return null;

                        const frames =
                            v.getVideoPlaybackQuality
                                ? v.getVideoPlaybackQuality()
                                    .totalVideoFrames
                                : (v.webkitDecodedFrameCount || 0);

                        if (v.paused) {
                            v.play().catch(() => {});

                            const btns =
                                document.querySelectorAll(
                                    '.jw-icon-display, ' +
                                    '.jw-icon-live, ' +
                                    '.vjs-play-control, ' +
                                    '.vjs-live-control, ' +
                                    'button[data-plyr="play"]'
                                );

                            btns.forEach(b => {
                                try { b.click(); }
                                catch (e) {}
                            });

                            return {
                                status: 'PAUSED_RESUMING',
                                paused: true,
                                readyState: v.readyState,
                                currentTime: v.currentTime,
                                frames
                            };
                        }

                        if (
                            v.readyState >= 2 ||
                            frames > 0
                        ) {
                            return {
                                status: 'HEALTHY',
                                paused: false,
                                readyState: v.readyState,
                                currentTime: v.currentTime,
                                frames
                            };
                        }

                        return null;
                    }),
                    new Promise(r =>
                        setTimeout(() => r(null), 1500)
                    )
                ]);
            } catch (e) {
                return null;
            }
        });

        const results = await Promise.all(checks);

        const healthy = results.find(
            r => r && r.status === 'HEALTHY'
        );

        if (healthy) return healthy;

        const pausedStream = results.find(
            r => r && r.status === 'PAUSED_RESUMING'
        );

        if (pausedStream) return pausedStream;

        return { status: 'LOADING_OR_DEAD' };
    } catch (e) {
        return { status: 'DEAD' };
    }
}

// ============================================================
// LOAD CURRENT URL
// ============================================================
async function loadCurrentUrl(reason) {
    const targetUrl = urlList[currentUrlIndex];

    console.log(
        `\n[RELOAD] ${reason} -> URL ` +
        `[${currentUrlIndex + 1}/${urlList.length}]`
    );

    resetMonitorStats();

    try {
        await obs.call('SetCurrentProgramScene', {
            sceneName: 'WaitingScene'
        });
    } catch (e) {}

    try {
        await page.goto('about:blank');
        await page.bringToFront();

        keepChromeOnTopAndHideOBS();

        await showLoadingOverlay(
            page,
            'CONNECTING STREAM',
            `Server ${currentUrlIndex + 1} of ${urlList.length}`
        );

        await page.goto(targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 45000
        });

        await showLoadingOverlay(
            page,
            'OPTIMIZING PLAYER',
            'Locking fullscreen video...'
        );

        await lockAndPlayVideo(page);
        await hideLoadingOverlay(page);

        keepChromeOnTopAndHideOBS();
    } catch (e) {
        console.log(
            `[WARNING] Page navigation: ${e.message}`
        );
    }

    try {
        await obs.call('SetCurrentProgramScene', {
            sceneName: 'MainScene'
        });
    } catch (e) {}
}

// ============================================================
// COMBINED WATCHDOG
// ============================================================
async function startWatchdog() {
    let lastTime = -1;
    let lastFrames = -1;
    let lastWallClock = Date.now();

    let freezeStart = Date.now();
    let urlStart = Date.now();

    let deadStrikes = 0;
    let ticks = 0;

    while (true) {
        if (!browser || !browser.isConnected()) {
            throw new Error('Browser disconnected');
        }

        keepChromeOnTopAndHideOBS();

        const currentUrl = urlList[currentUrlIndex];
        const health = await checkStreamHealth(page);

        // Per-playlist monitoring is diagnostic.
        // A stale manifest alone MUST NOT trigger failover.
        let networkState = getHlsManifestState();

        if (netStats.segmentErrorCount >= 6) {
            networkState =
                `NET_ERROR_${netStats.lastHttpStatus}`;
        }

        if (
            health.status === 'HEALTHY' ||
            health.status === 'PAUSED_RESUMING'
        ) {
            deadStrikes = 0;

            if (health.status === 'PAUSED_RESUMING') {
                console.log(
                    '[PLAYBACK] Paused -> requesting resume'
                );

                await lockAndPlayVideo(page);
            }

            const now = Date.now();

            const wallElapsed =
                (now - lastWallClock) / 1000;

            const timeDelta = lastTime !== -1
                ? Math.abs(
                    health.currentTime - lastTime
                )
                : wallElapsed;

            const speedRatio = wallElapsed > 0
                ? (timeDelta / wallElapsed).toFixed(2)
                : '1.00';

            lastWallClock = now;

            const framesMoved =
                lastFrames === -1 ||
                health.frames !== lastFrames;

            const timeMoved =
                lastTime === -1 ||
                health.currentTime !== lastTime;

            const isMoving =
                framesMoved || timeMoved;

            const visualCheck =
                await checkVisualFreshness(page);

            if (!isMoving) {
                if (
                    Date.now() - freezeStart > 18000
                ) {
                    currentUrlIndex =
                        (currentUrlIndex + 1) %
                        urlList.length;

                    await loadCurrentUrl(
                        'PLAYBACK FROZEN (18s)'
                    );

                    freezeStart = Date.now();
                    urlStart = Date.now();
                    lastTime = -1;
                    lastFrames = -1;

                    continue;
                }
            } else if (
                visualCheck.visualStatus ===
                'VISUAL_FROZEN'
            ) {
                currentUrlIndex =
                    (currentUrlIndex + 1) %
                    urlList.length;

                await loadCurrentUrl(
                    `VISUAL SCREEN FROZEN ` +
                    `(${visualCheck.frozenSec}s)`
                );

                freezeStart = Date.now();
                urlStart = Date.now();
                lastTime = -1;
                lastFrames = -1;

                continue;
            } else if (
                visualCheck.visualStatus ===
                'CONTENT_LOOP'
            ) {
                currentUrlIndex =
                    (currentUrlIndex + 1) %
                    urlList.length;

                await loadCurrentUrl(
                    'REPEATING VISUAL LOOP DETECTED'
                );

                freezeStart = Date.now();
                urlStart = Date.now();
                lastTime = -1;
                lastFrames = -1;

                continue;
            } else {
                // Playback is progressing.
                // Network warnings are advisory.
                lastTime = health.currentTime;
                lastFrames = health.frames;
                freezeStart = Date.now();

                await hideLoadingOverlay(page);
            }

            const isExempt =
                NO_REFRESH_DOMAINS.some(
                    d => currentUrl.includes(d)
                );

            if (
                !isExempt &&
                Date.now() - urlStart > FORCE_REFRESH_MS
            ) {
                await loadCurrentUrl(
                    'SCHEDULED REFRESH'
                );

                freezeStart = Date.now();
                urlStart = Date.now();
                lastTime = -1;
                lastFrames = -1;
            }

            ticks++;

            if (
                ticks === 1 ||
                ticks % 10 === 0
            ) {
                console.log(
                    `[HEALTH] Net:${networkState} ` +
                    `(HTTP:${netStats.lastHttpStatus}, ` +
                    `Playlists:${netStats.hlsPlaylists.size}) | ` +
                    `Playback:${health.status} ` +
                    `(Speed:${speedRatio}x, ` +
                    `Time:${
                        health.currentTime !== undefined
                            ? health.currentTime.toFixed(1) + 's'
                            : 'N/A'
                    }, Frames:${health.frames ?? 'N/A'}) | ` +
                    `Visual:${visualCheck.visualStatus} | ` +
                    `URL [${currentUrlIndex + 1}/${urlList.length}]`
                );
            }
        } else {
            deadStrikes++;

            console.log(
                `[WARNING] Stream Unhealthy ` +
                `(${health.status} | Net:${networkState}) ` +
                `Strike ${deadStrikes}/5`
            );

            if (deadStrikes >= 5) {
                deadStrikes = 0;

                currentUrlIndex =
                    (currentUrlIndex + 1) %
                    urlList.length;

                await loadCurrentUrl(
                    '5 STRIKES -> FAILOVER'
                );

                freezeStart = Date.now();
                urlStart = Date.now();
                lastTime = -1;
                lastFrames = -1;
            }
        }

        await new Promise(r =>
            setTimeout(r, 2000)
        );
    }
}

// ============================================================
// ENGINE STARTUP
// ============================================================
async function startEngine() {
    console.log(
        '[ENGINE] Configuring and starting OBS...'
    );

    setupOBSConfig();

    obsProcess = spawn('obs', [
        '--startstreaming',
        '--minimize-to-tray',
        '--disable-updater'
    ]);

    obsProcess.stdout.on('data', data => {
        const line = data.toString().trim();

        if (
            line.includes('rtmp') ||
            line.includes('stream') ||
            line.includes('Websocket') ||
            line.includes('output')
        ) {
            console.log(`[OBS] ${line}`);
        }
    });

    obsProcess.stderr.on('data', data => {
        const msg = data.toString().trim();

        if (
            msg.toLowerCase().includes('error') ||
            msg.toLowerCase().includes('fail')
        ) {
            console.log(`[OBS ERROR] ${msg}`);
        }
    });

    await new Promise(r =>
        setTimeout(r, 6000)
    );

    let obsConnected = false;

    for (let i = 0; i < 12; i++) {
        try {
            await obs.connect(
                'ws://127.0.0.1:4455',
                'secret'
            );

            obsConnected = true;

            console.log(
                '[OBS] WebSocket connected'
            );

            break;
        } catch (e) {
            await new Promise(r =>
                setTimeout(r, 2000)
            );
        }
    }

    if (obsConnected) {
        try {
            await obs.call('StartStream');
        } catch (e) {}
    }

    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--window-size=${RES_W},${RES_H}`,
        '--window-position=0,0',
        '--kiosk',
        '--start-fullscreen',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-dev-shm-usage',
        '--use-gl=egl'
    ];

    const ublockPath = path.join(
        process.cwd(),
        'ublock-lite'
    );

    if (
        fs.existsSync(
            path.join(ublockPath, 'manifest.json')
        )
    ) {
        args.push(
            `--disable-extensions-except=${ublockPath}`
        );
        args.push(
            `--load-extension=${ublockPath}`
        );

        console.log(
            '[BROWSER] Optional extension loaded'
        );
    }

    browser = await puppeteer.launch({
        headless: false,
        defaultViewport: {
            width: RES_W,
            height: RES_H
        },
        args
    });

    page = (await browser.pages())[0];

    browser.on('targetcreated', async target => {
        if (target.type() === 'page') {
            const newPage = await target.page()
                .catch(() => null);

            if (
                newPage &&
                newPage !== page
            ) {
                setTimeout(
                    () => newPage.close()
                        .catch(() => {}),
                    300
                );
            }
        }
    });

    keepChromeOnTopAndHideOBS();

    await setupPageProtections(page);
    await loadCurrentUrl('INITIAL BOOT');
    await startWatchdog();
}

// ============================================================
// CLEANUP
// ============================================================
async function cleanup() {
    try {
        await obs.disconnect();
    } catch (e) {}

    if (browser) {
        try {
            await browser.close();
        } catch (e) {}

        browser = null;
    }

    if (obsProcess) {
        try {
            obsProcess.kill('SIGKILL');
        } catch (e) {}

        obsProcess = null;
    }

    try {
        execSync(
            'pkill -9 obs chrome ffplay || true',
            { stdio: 'ignore' }
        );
    } catch (e) {}
}

// ============================================================
// DURATION AND GITHUB ACTIONS RELAY
// ============================================================
const RAW_DURATION = (
    process.env.CUSTOM_DURATION || '24/7'
).trim();

const MAX_SINGLE_RUN_MS = 21000000;

// Parses 24/7, 10h, 1h 10min, 45m, 30s, etc.
function parseFlexibleDuration(input) {
    if (!input) return null;

    const str = input.toLowerCase().trim();

    if (
        str === '24/7' ||
        str === 'infinite' ||
        str === 'forever' ||
        str === '0'
    ) {
        return null;
    }

    let totalMs = 0;
    let matched = false;

    const regex =
        /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/g;

    let match;

    while (
        (match = regex.exec(str)) !== null
    ) {
        matched = true;

        const val = parseFloat(match[1]);
        const unit = match[2];

        if (unit.startsWith('h')) {
            totalMs += val * 3600 * 1000;
        } else if (unit.startsWith('m')) {
            totalMs += val * 60 * 1000;
        } else if (unit.startsWith('s')) {
            totalMs += val * 1000;
        }
    }

    if (
        !matched &&
        /^\d+(\.\d+)?$/.test(str)
    ) {
        totalMs = parseFloat(str) * 60 * 1000;
        matched = true;
    }

    return matched && totalMs > 0
        ? Math.round(totalMs)
        : null;
}

function formatMsToDurationString(ms) {
    const totalSeconds = Math.max(
        1,
        Math.round(ms / 1000)
    );

    const hours = Math.floor(
        totalSeconds / 3600
    );

    const minutes = Math.floor(
        (totalSeconds % 3600) / 60
    );

    const seconds = totalSeconds % 60;

    const parts = [];

    if (hours > 0) {
        parts.push(`${hours}h`);
    }

    if (minutes > 0) {
        parts.push(`${minutes}m`);
    }

    if (
        hours === 0 &&
        minutes === 0 &&
        seconds > 0
    ) {
        parts.push(`${seconds}s`);
    }

    return parts.join(' ') || '1m';
}

// ============================================================
// WORKFLOW HANDOVER
// ============================================================
function triggerNextWorkflow(nextDurationValue) {
    try {
        console.log(
            `[HANDOVER] Starting next workflow: ` +
            `${nextDurationValue}`
        );

        const args = [
            'workflow',
            'run',
            'main.yml',
            '-f',
            `target_urls=${process.env.TARGET_URLS || ''}`,
            '-f',
            `okru_stream_channel=${SELECTED_CHANNEL}`,
            '-f',
            `server_selection=${SERVER_SELECTION}`,
            '-f',
            `stream_quality=${selectedQuality}`,
            '-f',
            `proxy_engine=${PROXY_ENGINE}`,
            '-f',
            `enable_stream_audio=${process.env.ENABLE_STREAM_AUDIO || 'ON'}`,
            '-f',
            `custom_duration=${nextDurationValue}`
        ];

        const res = spawn('gh', args, {
            stdio: 'inherit'
        });

        res.on('close', code => {
            console.log(
                `[HANDOVER] Workflow command exited ` +
                `with code ${code}`
            );

            setTimeout(async () => {
                try {
                    await obs.call('StopStream');
                } catch (e) {}

                await cleanup();
                process.exit(0);
            }, 60000);
        });
    } catch (e) {
        console.error(
            '[HANDOVER ERROR]',
            e.message
        );
    }
}

// ============================================================
// DURATION CONTROLLER
// ============================================================
const totalRequestedMs =
    parseFlexibleDuration(RAW_DURATION);

if (totalRequestedMs === null) {
    console.log(
        '[DURATION] 24/7 mode; runner handover enabled'
    );

    setTimeout(() => {
        triggerNextWorkflow('24/7');
    }, MAX_SINGLE_RUN_MS);

} else if (
    totalRequestedMs <= MAX_SINGLE_RUN_MS
) {
    console.log(
        `[DURATION] Fixed: ${RAW_DURATION}`
    );

    setTimeout(async () => {
        console.log(
            '[DURATION] Target reached. Stopping stream.'
        );

        try {
            await obs.call('StopStream');
        } catch (e) {}

        await cleanup();
        process.exit(0);

    }, totalRequestedMs);

} else {
    const remainingMs =
        totalRequestedMs - MAX_SINGLE_RUN_MS;

    const nextDurationStr =
        formatMsToDurationString(remainingMs);

    console.log(
        `[DURATION] Long relay: ${RAW_DURATION}, ` +
        `remaining after handover: ${nextDurationStr}`
    );

    setTimeout(() => {
        triggerNextWorkflow(nextDurationStr);
    }, MAX_SINGLE_RUN_MS);
}

// ============================================================
// MAIN ENGINE AUTO-RESTART
// ============================================================
(async () => {
    while (true) {
        try {
            await startEngine();
        } catch (err) {
            console.error(
                '[ENGINE ERROR] Restarting in 3 seconds:',
                err.message
            );

            await cleanup();

            await new Promise(r =>
                setTimeout(r, 3000)
            );
        }
    }
})();
