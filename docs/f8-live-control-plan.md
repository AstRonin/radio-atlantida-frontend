# Phase F8 Plan — Live Control (radio-atlantida-frontend)

Status: Done
Based on: `docs/base.md` (Remote Live Broadcasting), `docs/tech-design.md` (§6.4 v7-12 and v7-15, §6.5, §8.4, §8.5, §8.6, §10, §12), `docs/frontend-init-plan.md` §8 item 8, backend `docs/phase-9-plan.md` (playout, done) and `docs/phase-12-plan.md` (live voice, done)
Last updated: 2026-10-15

## 1. Goal

The manager goes on air from the panel. The browser captures the microphone, shows its level, and
sends it over WebRTC to the backend, which relays it into Liquidsoap; the music ducks under the
voice. The same page shows what is on air (now playing with progress, the items waiting in
Liquidsoap, the control link, and the Icecast output) and sets the music gain (normal, under voice,
off). The panel shows the backend's state; it never decides what plays.

The backend side is complete: `POST/DELETE /api/live/session`, `GET /api/live/status`,
`GET /api/playout/status`, `PUT /api/playout/music-gain`, and the events `live.state`,
`playout.now_playing`, `liquidsoap.state`, and `icecast.state` are in `api/openapi.json`.

## 2. Decisions

1. **One page, "Live"** (`/live`, `features/live`, help `help.live`), first in the navigation: the
   on-air console. A new help page ID `help.live` and its file `assets/help/en/live.json` are added
   (design §6.1: every admin page has help).
2. **The live session lives in `core/live`, not in the page.** Leaving the page must not cut the
   voice, so `LiveVoiceService` (root) owns the microphone stream, the level meter, and the
   `RTCPeerConnection`. The shell shows an "On air" indicator with a Stop button while a session
   of this panel is active, and the browser asks before a reload or a closed tab ends it.
3. **Browser APIs behind injection tokens** (`LIVE_MEDIA`: `getUserMedia`, `enumerateDevices`;
   `LIVE_PEER_FACTORY`: `RTCPeerConnection`; `LIVE_AUDIO_CONTEXT_FACTORY`: the meter's
   `AudioContext`), as `PREVIEW_AUDIO_FACTORY` in F4, so unit tests use fakes and never open a
   device or a connection.
4. **Microphone first, then air.** "Test microphone" opens the chosen input (echo cancellation,
   noise suppression, and auto gain on) and shows the level, without sending anything. "Go on
   air" uses that stream. The input list (`enumerateDevices`) has labels only after the first
   permission, so it is read again after the microphone opens. The level is the RMS of an
   `AnalyserNode`, read per animation frame, shown as a meter (`role="meter"`) with a clipping
   mark.
5. **Signalling as the backend expects**: one offer with every candidate gathered (wait for ICE
   gathering `complete`, at most 2 s, then send what is there), `POST /api/live/session`,
   `setRemoteDescription(answer)`. No STUN or TURN (private network, design §10).
6. **Takeover is asked, never automatic.** A 409 `live_session_active` (another panel, or this
   one before a reload) opens a confirm dialog; on confirm the offer is sent again with
   `takeover: true`.
7. **The backend state is the truth.** The state shown is `live.state` (`off`, `connecting`,
   `on_air`, `reconnecting`), read from `GET /api/live/status` whenever the event connection opens.
   When the backend ends this panel's session (`no_audio`, `dropout`, `replaced`, `shutdown`), the
   service closes its peer connection, keeps the microphone open for a new attempt, and shows the
   reason. A session started from another panel is shown as on air, and Stop ends it too
   (`DELETE /api/live/session` ends any session).
8. **Stop** sends `DELETE /api/live/session`, then closes the peer connection; the microphone
   stays open until "Close microphone", so going on air again is one click.
9. **Secure context.** Browsers give the microphone only on `localhost` or HTTPS. Without
   `window.isSecureContext` or `navigator.mediaDevices`, the live section explains this and offers
   no controls (backend phase-12 plan §5).
10. **Music gain** is the live value (`PUT /api/playout/music-gain`, 0 to 1): a slider with steps
    of 0.05 that sends on release, and presets Normal (1), Under voice (0.2), Off (0). It is not
    saved; a backend restart applies the setting `liquidsoap.music_gain`. The page says that
    ducking under the voice is automatic (`liquidsoap.duck_gain` in the settings). A 503
    `liquidsoap_unavailable` is shown next to the control.
11. **Playout status** is read on load and when the event connection opens, then kept current by
    `playout.now_playing` (and the queue read again after it, since a start triggers a push),
    `liquidsoap.state`, and `icecast.state`. Progress is computed in the panel from `started_at`
    and `out_ms` with a one-second timer that stops when the page closes (no progress events,
    backend phase-9 plan §2 item 7).
12. **Permissions-Policy** `microphone=(self)` (and nothing else allowed) is added to
    `docker/nginx.conf`, so the panel's own pages may use the microphone and nothing framed may.

## 3. Tasks

1. **`core/live`**: tokens for the browser APIs; `LiveVoiceService` (states, microphone, inputs,
   level, session start with takeover, stop, backend state from events and `GET /api/live/status`,
   cleanup on the end of a session, `beforeunload`); `LiveIndicatorComponent` for the shell.
2. **Live page** (`features/live`): live voice section (secure-context note, input select, test /
   close microphone, meter, go on air / stop, state, end reason, errors), music gain section,
   on-air section (now playing with progress, control link, Icecast output, queued items with
   play buttons).
3. **Help and navigation**: `help.live` in `HELP_PAGE_IDS`, `assets/help/en/live.json`; route
   `live` with `nav.live`, first in the navigation.
4. **nginx**: `Permissions-Policy`.
5. **Translations** in `en.json` (`nav.live`, `live`).
6. **Tests** next to the code: the service with fake media and peer (test microphone and level,
   offer after gathering, answer applied, 409 → confirm → takeover, stop sends DELETE, backend
   `dropout` closes the peer and keeps the microphone, state read on connect, insecure context);
   the page (status rendering and progress, gain presets and slider body, 503 message, queue
   reload on `playout.now_playing`, link and output states from events).

## 4. Out of scope

Live session history (the backend keeps none); a recorder; audio processing beyond the browser's
built-in echo cancellation, noise suppression, and auto gain; HTTPS for the panel (deploy).

## 5. Done when

On `localhost`, the manager can test the microphone and see its level, go on air and see the state
change to on air, take over a running session after confirming, stop, and see why a session ended;
the voice continues while other pages are open, and the header shows it; the music gain can be set
with the slider and presets; now playing, its progress, the queue, the control link, and the
Icecast output follow the events. `npm run lint`, `npm run format:check`, `npm test`, and
`npm run build` pass.
