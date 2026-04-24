/**
 * Google Cast Card for Home Assistant
 * Smart multi-entity media player card for Google Cast / Nest Audio.
 * Automatically selects the active speaker(s) in the room.
 * https://github.com/your-username/google-cast-card
 */

const CARD_VERSION = '1.1.0';

// ── Helpers ────────────────────────────────────────────────────────────────

function secondsToTime(sec) {
  if (!sec || isNaN(sec)) return '—:——';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

/**
 * Resolve the full list of entity IDs from config.
 * Supports:
 *   entity: media_player.foo              (single)
 *   entities: [media_player.a, ...]       (explicit list)
 *   group: media_player.my_group          (HA group → expand members)
 *
 * All three can be combined; duplicates are removed.
 */
function resolveEntities(config, hass) {
  const ids = new Set();

  if (config.entity) ids.add(config.entity);

  if (Array.isArray(config.entities)) {
    config.entities.forEach(e => ids.add(e));
  }

  if (config.group) {
    const grp = hass.states[config.group];
    if (grp?.attributes?.entity_id) {
      grp.attributes.entity_id.forEach(e => ids.add(e));
    } else if (grp) {
      ids.add(config.group);
    }
  }

  return [...ids];
}

/**
 * Smart active-entity selection:
 *
 * Priority:
 *  1. All 'playing' entities
 *  2. All 'paused' entities  (if none playing)
 *  3. First available entity (idle fallback)
 *
 * controlTarget — entity_id to send service calls to:
 *   · 1 active  → that entity directly
 *   · 2+ active → config.group if defined & available, else first active
 */
function selectActive(entityIds, hass, groupEntity) {
  const stateOf = id => hass.states[id];

  const playing = entityIds.filter(id => stateOf(id)?.state === 'playing');
  const paused  = entityIds.filter(id => stateOf(id)?.state === 'paused');

  let active, derivedState;

  if (playing.length > 0) {
    active = playing;
    derivedState = 'playing';
  } else if (paused.length > 0) {
    active = paused;
    derivedState = 'paused';
  } else {
    const first = entityIds.find(id => stateOf(id)) ?? entityIds[0];
    return {
      activeEntities: first ? [first] : [],
      controlTarget: first ?? null,
      state: stateOf(first)?.state ?? 'idle',
      isMulti: false,
    };
  }

  let controlTarget;
  if (active.length === 1) {
    controlTarget = active[0];
  } else {
    controlTarget = (groupEntity && hass.states[groupEntity])
      ? groupEntity
      : active[0];
  }

  return { activeEntities: active, controlTarget, state: derivedState, isMulti: active.length > 1 };
}

// ── Styles ─────────────────────────────────────────────────────────────────

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&family=Lora:wght@400;600&display=swap');

  :host {
    display: block;
    --gcc-bg: #f7f8f6;
    --gcc-surface: #eef0ec;
    --gcc-border: rgba(0,0,0,0.06);
    --gcc-accent: #7ab88b;
    --gcc-accent2: #5a9a6a;
    --gcc-text: #1a1a1a;
    --gcc-muted: #757575;
    --gcc-playing: #7ab88b;
    --gcc-danger: #ef4444;
    font-family: 'Quicksand', sans-serif;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .card {
    background: var(--gcc-bg);
    border-radius: 24px;
    overflow: hidden;
    box-shadow: 0 4px 20px rgba(0,0,0,0.06);
    border: 1px solid rgba(0,0,0,0.03);
    color: var(--gcc-text);
    font-family: 'Quicksand', sans-serif;
    position: relative;
  }
  .card::before {
    content: ''; position: absolute; top: -60px; right: -60px;
    width: 200px; height: 200px;
    background: radial-gradient(circle, rgba(122,184,139,.08) 0%, transparent 70%);
    pointer-events: none; z-index: 0;
  }

  /* ── Art Banner ── */
  .art-banner {
    position: relative; height: 200px; overflow: hidden;
    background: linear-gradient(160deg, #e8ebe5 0%, #d8dcd4 100%);
  }
  .art-banner img {
    width: 100%; height: 100%; object-fit: cover; display: block;
    transition: transform 10s ease, opacity 0.4s ease;
  }
  .card.playing .art-banner img { transform: scale(1.06); }
  .art-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(to bottom, rgba(232,235,229,0) 30%, rgba(232,235,229,0.92) 100%);
  }
  .art-placeholder {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(160deg, #e8ebe5, #d4d8d0);
  }
  .art-placeholder svg { opacity: 0.18; stroke: #7ab88b; }

  /* ── Device badge ── */
  .device-badge {
    position: absolute; top: 12px; left: 14px;
    display: flex; align-items: center; gap: 6px;
    background: rgba(247,248,246,0.82); backdrop-filter: blur(8px);
    border: 1px solid rgba(0,0,0,0.08); border-radius: 20px;
    padding: 5px 11px 5px 7px;
    font-size: 11px; font-weight: 600; color: #1a1a1a;
    letter-spacing: 0.02em;
    max-width: calc(100% - 90px);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font-family: 'Quicksand', sans-serif;
  }
  .device-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: rgba(0,0,0,0.2); flex-shrink: 0;
  }
  .device-dot.active {
    background: var(--gcc-playing);
    box-shadow: 0 0 6px rgba(122,184,139,0.6);
    animation: pulse 2s infinite;
  }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }

  /* ── Speaker pills ── */
  .speakers-row {
    position: absolute; top: 42px; left: 14px;
    display: flex; flex-wrap: wrap; gap: 5px;
    max-width: calc(100% - 28px);
  }
  .speaker-pill {
    display: flex; align-items: center; gap: 4px;
    background: rgba(247,248,246,0.75); backdrop-filter: blur(6px);
    border: 1px solid rgba(0,0,0,0.08); border-radius: 12px;
    padding: 3px 8px 3px 6px;
    font-size: 10px; color: #555; white-space: nowrap;
    font-family: 'Quicksand', sans-serif; font-weight: 600;
  }
  .speaker-pill-dot {
    width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0;
  }
  .speaker-pill-dot.on  { background: var(--gcc-playing); box-shadow: 0 0 4px rgba(122,184,139,.5); }
  .speaker-pill-dot.off { background: rgba(0,0,0,0.2); }

  /* ── Vol badge ── */
  .vol-badge {
    position: absolute; top: 12px; right: 14px;
    display: flex; align-items: center; gap: 5px;
    background: rgba(247,248,246,0.82); backdrop-filter: blur(8px);
    border: 1px solid rgba(0,0,0,0.08); border-radius: 20px;
    padding: 5px 10px; font-size: 11px;
    font-family: 'Quicksand', sans-serif; font-weight: 600; color: #555;
  }

  /* ── Song overlay ── */
  .song-overlay {
    position: absolute; bottom: 0; left: 0; right: 0;
    padding: 12px 16px 14px;
  }
  .song-title-wrap { overflow: hidden; }
  .song-title {
    font-size: 15px; font-weight: 600; color: #1a1a1a;
    white-space: nowrap; line-height: 1.2; display: inline-block;
    font-family: 'Lora', serif;
  }
  .song-title.overflow { animation: marquee 9s ease-in-out infinite; }
  @keyframes marquee {
    0%,20%  { transform: translateX(0); }
    70%,80% { transform: translateX(var(--scroll-dist, -60px)); }
    100%    { transform: translateX(0); }
  }
  .song-artist {
    font-size: 12px; font-weight: 600; color: #757575;
    margin-top: 2px; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
    font-family: 'Quicksand', sans-serif;
    text-transform: uppercase; letter-spacing: 0.4px;
  }
  .no-media-label { font-size: 13px; color: var(--gcc-muted); font-style: italic; font-family: 'Lora', serif; }

  /* ── Card body ── */
  .card-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; position: relative; z-index: 1; }

  /* ── Progress ── */
  .progress-wrap { display: flex; flex-direction: column; gap: 5px; }
  .progress-track {
    height: 3px; background: rgba(0,0,0,0.08);
    border-radius: 3px; cursor: pointer; position: relative; overflow: visible;
    transition: height 0.15s;
  }
  .progress-track:hover { height: 5px; }
  .progress-fill {
    height: 100%; border-radius: 3px; width: 0%; position: relative;
    pointer-events: none; transition: width 0.8s linear;
    background: var(--gcc-accent);
  }
  .progress-fill::after {
    content: ''; position: absolute; right: -5px; top: 50%;
    transform: translateY(-50%); width: 10px; height: 10px;
    background: #fff; border-radius: 50%;
    box-shadow: 0 0 6px rgba(122,184,139,0.5);
    border: 2px solid var(--gcc-accent);
  }
  .progress-times {
    display: flex; justify-content: space-between;
    font-size: 10px; font-family: 'Quicksand', sans-serif;
    font-weight: 600; color: var(--gcc-muted);
    font-variant-numeric: tabular-nums;
  }

  /* ── Controls ── */
  .controls { display: flex; align-items: center; justify-content: center; gap: 8px; }
  .ctrl-btn {
    border: 1px solid rgba(0,0,0,0.08); background: rgba(0,0,0,0.04); cursor: pointer;
    color: rgba(0,0,0,0.55);
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%; padding: 7px; position: relative;
    transition: color 0.2s, background 0.2s, transform 0.15s, border-color 0.2s;
  }
  .ctrl-btn:hover:not(:disabled) { color: #1a1a1a; background: rgba(0,0,0,0.09); border-color: rgba(0,0,0,0.15); transform: scale(1.06); }
  .ctrl-btn:disabled { opacity: 0.25; cursor: default; }
  .ctrl-btn.primary {
    width: 54px; height: 54px;
    background: var(--gcc-accent); border-color: transparent;
    color: #fff; box-shadow: 0 4px 16px rgba(122,184,139,0.35);
  }
  .ctrl-btn.primary:hover:not(:disabled) { background: var(--gcc-accent2); box-shadow: 0 4px 20px rgba(122,184,139,0.5); transform: scale(1.06); }

  /* ── Volume ── */
  .volume-row { display: flex; align-items: center; gap: 8px; }
  .vol-icon { color: rgba(0,0,0,0.35); flex-shrink: 0; }
  .vol-slider-wrap {
    flex: 1; height: 16px; display: flex; align-items: center; cursor: pointer;
  }
  .vol-slider {
    width: 100%; height: 3px; background: rgba(0,0,0,0.08);
    border-radius: 3px; position: relative; transition: height 0.15s;
  }
  .vol-slider-wrap:hover .vol-slider { height: 5px; }
  .vol-fill {
    height: 100%; background: var(--gcc-accent);
    border-radius: 3px; position: relative;
  }
  .vol-fill::after {
    content: ''; position: absolute; right: -5px; top: 50%;
    transform: translateY(-50%); width: 10px; height: 10px;
    background: #fff; border-radius: 50%;
    box-shadow: 0 0 4px rgba(122,184,139,0.4);
    border: 2px solid var(--gcc-accent);
  }
  .vol-label {
    font-size: 11px; font-family: 'Quicksand', sans-serif; font-weight: 600;
    color: var(--gcc-muted); width: 28px; text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .mute-btn {
    border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.07); color: #ef4444;
    border-radius: 8px; padding: 4px 10px;
    font-size: 11px; font-family: 'Quicksand', sans-serif; font-weight: 600;
    cursor: pointer; display: flex; align-items: center; gap: 4px;
    transition: background 0.2s, border-color 0.2s; flex-shrink: 0;
  }
  .mute-btn:hover { background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.5); }
  .mute-btn.muted { background: rgba(239,68,68,0.14); border-color: rgba(239,68,68,0.5); color: #ef4444; }

  /* ── Divider / source ── */
  .divider { height: 1px; background: rgba(0,0,0,0.05); margin: 0 -16px; }
  .source-row { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--gcc-muted); font-weight: 600; }
  .source-row span { flex: 1; }
  .source-chip {
    background: rgba(0,0,0,0.05); border: 1px solid rgba(0,0,0,0.08);
    border-radius: 6px; padding: 3px 8px; font-size: 11px; color: #999; font-weight: 600;
  }

  /* ── Auto-switch notice ── */
  .switch-notice {
    font-size: 10px; color: var(--gcc-accent2); letter-spacing: 0.03em;
    display: flex; align-items: center; gap: 4px; font-weight: 700;
    animation: fadeIn 0.4s ease;
  }
  @keyframes fadeIn { from { opacity:0; transform:translateY(2px); } to { opacity:1; transform:none; } }

  /* ── Error ── */
  .error-msg { padding: 20px; text-align: center; color: var(--gcc-danger); font-size: 13px; }
`;

// ── SVG Icons ──────────────────────────────────────────────────────────────

const ICONS = {
  prev: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>`,
  next: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6l8.5 6-8.5 6V6zm10 0h2v12h-2z"/></svg>`,
  play: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  pause:`<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,

  volOff:`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/></svg>`,
  volOn: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
  muteOn: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  muteOff:`<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`,
  cast:`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3H19a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M3 8a12 12 0 0 1 12 12"/><path d="M3 13a7 7 0 0 1 7 7"/><circle cx="3" cy="20" r="1" fill="currentColor"/></svg>`,
  note:`<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1"><circle cx="9" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><polyline points="12 18 12 2 21 5 21 11" stroke-linejoin="round" stroke-linecap="round"/></svg>`,
  arrow:`<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/><path d="m15 7 5 5-5 5"/></svg>`,
};

// ── Card class ─────────────────────────────────────────────────────────────

class GoogleCastCard extends HTMLElement {

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._progressInterval = null;
    this._localPosition = 0;
    this._lastPositionUpdate = 0;
    this._lastHaPosition = null;
    this._lastControlTarget = null;
  }

  static getConfigElement() { return document.createElement('google-cast-card-editor'); }

  static getStubConfig() {
    return { entities: ['media_player.speaker_1', 'media_player.speaker_2'] };
  }

  setConfig(config) {
    const hasEntities = config.entity || config.group ||
      (Array.isArray(config.entities) && config.entities.length > 0);
    if (!hasEntities) throw new Error('Define at least one of: entity, entities[], or group');
    this._config = { show_seek: false, seek_seconds: 10, ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
    const ids = resolveEntities(this._config, hass);
    const { state } = selectActive(ids, hass, this._config.group);
    this._manageProgressTimer(state);
  }

  getCardSize() { return 4; }

  // ── Progress timer ──────────────────────────────────────────────────────

  _manageProgressTimer(state) {
    if (state === 'playing') {
      if (!this._progressInterval)
        this._progressInterval = setInterval(() => this._tickProgress(), 1000);
    } else {
      clearInterval(this._progressInterval);
      this._progressInterval = null;
    }
  }

  _tickProgress() {
    const { controlTarget, state } = this._getActive();
    if (!controlTarget || state !== 'playing') return;
    const stateObj = this._hass.states[controlTarget];
    if (!stateObj) return;
    const elapsed = Date.now() / 1000 - this._lastPositionUpdate;
    this._localPosition = (stateObj.attributes.media_position ?? 0) + elapsed;
    this._updateProgressUI();
  }

  _updateProgressUI() {
    const { controlTarget } = this._getActive();
    const stateObj = this._hass?.states[controlTarget];
    if (!stateObj) return;
    const duration = stateObj.attributes.media_duration ?? 0;
    const pos = clamp(this._localPosition, 0, duration);
    const pct = duration > 0 ? (pos / duration) * 100 : 0;
    const fill    = this.shadowRoot.querySelector('.progress-fill');
    const elapsed = this.shadowRoot.querySelector('.time-elapsed');
    if (fill)    fill.style.width = `${pct}%`;
    if (elapsed) elapsed.textContent = secondsToTime(pos);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  _getActive() {
    if (!this._hass) return { activeEntities:[], controlTarget:null, state:'idle', isMulti:false };
    return selectActive(resolveEntities(this._config, this._hass), this._hass, this._config.group);
  }

  _callService(service, data = {}) {
    const { controlTarget } = this._getActive();
    if (!controlTarget) return;
    this._hass.callService('media_player', service, { entity_id: controlTarget, ...data });
  }

  _onProgressClick(e) {
    const { controlTarget } = this._getActive();
    const duration = this._hass?.states[controlTarget]?.attributes?.media_duration ?? 0;
    if (!duration) return;
    const rect = this.shadowRoot.querySelector('.progress-track').getBoundingClientRect();
    const seekTo = clamp((e.clientX - rect.left) / rect.width, 0, 1) * duration;
    this._localPosition = seekTo;
    this._lastPositionUpdate = Date.now() / 1000;
    this._callService('media_seek', { seek_position: seekTo });
    this._updateProgressUI();
  }

  _onVolumeClick(e) {
    const rect  = this.shadowRoot.querySelector('.vol-slider-wrap').getBoundingClientRect();
    const level = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    this._callService('volume_set', { volume_level: parseFloat(level.toFixed(2)) });
    const volPct = Math.round(level * 100);
    const fill  = this.shadowRoot.querySelector('.vol-fill');
    const label = this.shadowRoot.querySelector('.vol-label');
    const badge = this.shadowRoot.querySelector('.vol-badge-text');
    if (fill)  fill.style.width  = `${volPct}%`;
    if (label) label.textContent = volPct;
    if (badge) badge.textContent = `${volPct}%`;
  }

  // ── Render ───────────────────────────────────────────────────────────────

  _render() {
    if (!this._hass) return;

    const shadow    = this.shadowRoot;
    const entityIds = resolveEntities(this._config, this._hass);

    if (entityIds.length === 0) {
      shadow.innerHTML = `<style>${STYLES}</style><div class="card"><div class="error-msg">No valid entities found.</div></div>`;
      return;
    }

    const { activeEntities, controlTarget, state, isMulti } = this._getActive();

    const switched = controlTarget
      && this._lastControlTarget !== null
      && controlTarget !== this._lastControlTarget;
    this._lastControlTarget = controlTarget;

    const stateObj  = controlTarget ? this._hass.states[controlTarget] : null;
    const attr      = stateObj?.attributes ?? {};
    const isPlaying = state === 'playing';
    const isActive  = ['playing','paused'].includes(state);

    const title  = attr.media_title ?? '';
    const artist = attr.media_artist ?? attr.app_name ?? '';
    const album  = attr.media_album_name ?? '';
    const imgUrl = attr.entity_picture
      ? (attr.entity_picture.startsWith('http')
          ? attr.entity_picture
          : `${this._hass.hassUrl ?? ''}${attr.entity_picture}`)
      : null;

    const duration = attr.media_duration ?? 0;
    const volume   = attr.volume_level   ?? 0;
    const isMuted  = attr.is_volume_muted ?? false;
    const volPct   = Math.round(volume * 100);
    const source   = attr.app_name ?? attr.source ?? 'Google Cast';
    const roomLabel= this._config.name ?? attr.friendly_name ?? 'Speaker';

    // Sync position from HA
    const haPos = attr.media_position ?? 0;
    const haUpdated = attr.media_position_updated_at
      ? new Date(attr.media_position_updated_at).getTime() / 1000
      : Date.now() / 1000;
    if (haPos !== this._lastHaPosition) {
      this._localPosition = haPos;
      this._lastPositionUpdate = haUpdated;
      this._lastHaPosition = haPos;
    }
    const pos = isPlaying
      ? clamp(this._localPosition, 0, duration)
      : (attr.media_position ?? 0);
    const progressPct = duration > 0 ? (pos / duration) * 100 : 0;

    // Speaker pills — only when multiple entities configured
    const showPills = entityIds.length > 1;
    const pillsHTML = showPills ? `
      <div class="speakers-row">
        ${entityIds.map(id => {
          const s = this._hass.states[id];
          const on = ['playing','paused'].includes(s?.state);
          const fname = s?.attributes?.friendly_name ?? id.split('.')[1];
          return `<div class="speaker-pill">
            <div class="speaker-pill-dot ${on ? 'on' : 'off'}"></div>${fname}
          </div>`;
        }).join('')}
      </div>` : '';

    shadow.innerHTML = `
      <style>${STYLES}</style>
      <div class="card ${isPlaying ? 'playing' : ''}">

        <div class="art-banner">
          ${imgUrl
            ? `<img src="${imgUrl}" alt="Album art" draggable="false">`
            : `<div class="art-placeholder">${ICONS.note}</div>`}
          <div class="art-overlay"></div>

          <div class="device-badge">
            <div class="device-dot ${isActive ? 'active' : ''}"></div>
            ${isMulti ? `${activeEntities.length}× ` : ''}${roomLabel}
          </div>

          ${pillsHTML}

          <div class="vol-badge">
            ${isMuted ? ICONS.volOff : ICONS.volOn}
            <span class="vol-badge-text">${isMuted ? 'Muted' : volPct + '%'}</span>
          </div>

          <div class="song-overlay">
            ${isActive && title
              ? `<div class="song-title-wrap"><div class="song-title">${title}</div></div>
                 <div class="song-artist">${[artist, album].filter(Boolean).join(' · ')}</div>`
              : `<div class="no-media-label">${
                  state === 'off'         ? 'Oprit' :
                  state === 'unavailable' ? 'Indisponibil' : 'Nicio melodie'
                }</div>`}
          </div>
        </div>

        <div class="card-body">

          ${switched ? `<div class="switch-notice">${ICONS.arrow} Auto-switched to active speaker</div>` : ''}

          <div class="progress-wrap">
            <div class="progress-track">
              <div class="progress-fill" style="width:${progressPct}%"></div>
            </div>
            <div class="progress-times">
              <span class="time-elapsed">${secondsToTime(pos)}</span>
              <span>${secondsToTime(duration)}</span>
            </div>
          </div>

          <div class="controls">
            <button class="ctrl-btn" data-action="prev" ${!isActive ? 'disabled' : ''}>${ICONS.prev}</button>
            <button class="ctrl-btn primary" data-action="play_pause">
              ${isPlaying ? ICONS.pause : ICONS.play}
            </button>
            <button class="ctrl-btn" data-action="next" ${!isActive ? 'disabled' : ''}>${ICONS.next}</button>
          </div>

          <div class="volume-row">
            <span class="vol-icon">${ICONS.volOff}</span>
            <div class="vol-slider-wrap">
              <div class="vol-slider">
                <div class="vol-fill" style="width:${isMuted ? 0 : volPct}%"></div>
              </div>
            </div>
            <span class="vol-label">${isMuted ? '—' : volPct}</span>
            <button class="mute-btn ${isMuted ? 'muted' : ''}" data-action="mute">
              ${isMuted ? ICONS.muteOff : ICONS.muteOn}
              ${isMuted ? 'Unmute' : 'Mute'}
            </button>
          </div>

          <div class="divider"></div>

          <div class="source-row">
            ${ICONS.cast}
            <span>${source}${isMulti ? ` · ${activeEntities.length} speakers` : ''}</span>
            <div class="source-chip">Google Cast</div>
          </div>

        </div>
      </div>`;

    // Marquee title if overflowing
    const titleEl = shadow.querySelector('.song-title');
    const wrapEl  = shadow.querySelector('.song-title-wrap');
    if (titleEl && wrapEl) {
      requestAnimationFrame(() => {
        const overflow = titleEl.scrollWidth - wrapEl.offsetWidth;
        if (overflow > 10) {
          titleEl.classList.add('overflow');
          titleEl.style.setProperty('--scroll-dist', `-${overflow + 8}px`);
        }
      });
    }

    this._attachEvents();
  }

  _attachEvents() {
    const s = this.shadowRoot;
    s.querySelectorAll('[data-action]').forEach(btn =>
      btn.addEventListener('click', e => { e.stopPropagation(); this._handleAction(btn.dataset.action); })
    );
    s.querySelector('.progress-track')?.addEventListener('click', e => this._onProgressClick(e));
    s.querySelector('.vol-slider-wrap')?.addEventListener('click', e => this._onVolumeClick(e));
  }

  _handleAction(action) {
    const { controlTarget } = this._getActive();

    switch (action) {
      case 'play_pause': this._callService('media_play_pause'); break;
      case 'prev':       this._callService('media_previous_track'); break;
      case 'next':       this._callService('media_next_track'); break;
      case 'mute':
        this._callService('volume_mute', {
          is_volume_muted: !(this._hass?.states[controlTarget]?.attributes?.is_volume_muted ?? false),
        });
        break;
    }
  }

  disconnectedCallback() {
    clearInterval(this._progressInterval);
    this._progressInterval = null;
  }
}

// ── Editor ─────────────────────────────────────────────────────────────────

class GoogleCastCardEditor extends HTMLElement {
  setConfig(config) { this._config = config; }

  set hass(hass) {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `
        <style>
          .editor { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
          label { font-size: 13px; color: var(--primary-text-color); display: flex; flex-direction: column; gap: 4px; }
          input, select {
            background: var(--card-background-color); border: 1px solid var(--divider-color);
            border-radius: 6px; padding: 8px; color: var(--primary-text-color); font-size: 13px;
          }
          small { color: var(--secondary-text-color); font-size: 11px; }
        </style>
        <div class="editor">
          <label>Entities (comma-separated)
            <input type="text" id="entities" placeholder="media_player.speaker_1, media_player.speaker_2">
            <small>List all speakers in the room</small>
          </label>
          <label>Group entity (optional)
            <input type="text" id="group" placeholder="media_player.living_room_group">
            <small>Used as control target when 2+ speakers are active simultaneously</small>
          </label>
          <label>Room name (optional)
            <input type="text" id="name" placeholder="Living Room">
          </label>
          <label>Seek seconds
            <input type="number" id="seek_seconds" min="5" max="60" step="5" value="10">
          </label>
          <label>Show seek buttons
            <select id="show_seek">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
        </div>`;

      ['entities','group','name','seek_seconds','show_seek'].forEach(id =>
        this.shadowRoot.getElementById(id).addEventListener('change', () => this._fireChange())
      );
    }
    if (this._config) {
      const el = id => this.shadowRoot.getElementById(id);
      el('entities').value     = (this._config.entities ?? []).join(', ');
      el('group').value        = this._config.group ?? '';
      el('name').value         = this._config.name  ?? '';
      el('seek_seconds').value = this._config.seek_seconds ?? 10;
      el('show_seek').value    = this._config.show_seek !== false ? 'true' : 'false';
    }
  }

  _fireChange() {
    const el  = id => this.shadowRoot.getElementById(id).value.trim();
    const entities = el('entities').split(',').map(s => s.trim()).filter(Boolean);
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: {
      ...this._config,
      entities: entities.length ? entities : undefined,
      group:    el('group')  || undefined,
      name:     el('name')   || undefined,
      seek_seconds: parseInt(el('seek_seconds'), 10),
      show_seek: this.shadowRoot.getElementById('show_seek').value === 'true',
    }}}));
  }
}

// ── Register ───────────────────────────────────────────────────────────────

customElements.define('google-cast-card', GoogleCastCard);
customElements.define('google-cast-card-editor', GoogleCastCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'google-cast-card',
  name: 'Google Cast Card',
  description: 'Smart multi-speaker media player card for Google Cast / Nest Audio.',
  preview: true,
  documentationURL: 'https://github.com/your-username/google-cast-card',
});

console.info(
  `%c GOOGLE-CAST-CARD %c v${CARD_VERSION} `,
  'background:#7ab88b;color:#fff;font-weight:700;padding:2px 6px;border-radius:4px 0 0 4px',
  'background:#f7f8f6;color:#5a9a6a;font-weight:600;padding:2px 6px;border-radius:0 4px 4px 0',
);
