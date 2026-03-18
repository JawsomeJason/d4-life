/**
 * D4 Helltide Tracker - Accessible JavaScript
 *
 * Data source: diablo4.life/api/trackers/list (fetched every 5 min via GitHub Actions)
 * Shows: Helltide, World Boss, Zone Event (Legion), Chest Respawn
 */

(function () {
  'use strict';

  const CONFIG = {
    apiUrl: 'data/helltide.json',
    refreshInterval: 60,
    helltideDuration:  60 * 60 * 1000, // 60 min
    worldBossDuration: 15 * 60 * 1000, // ~15 min window
    zoneEventDuration: 30 * 60 * 1000, // ~30 min window
  };

  const el = {
    announcer:    document.getElementById('live-announcer'),
    lastUpdated:  document.getElementById('last-updated-time'),
    countdown:    document.getElementById('countdown'),
    refreshBtn:   document.getElementById('refresh-btn'),
    retryBtn:     document.getElementById('retry-btn'),
    loadingState: document.getElementById('loading-state'),
    errorState:   document.getElementById('error-state'),
    errorMessage: document.getElementById('error-message'),
    emptyState:   document.getElementById('empty-state'),
    helltideList: document.getElementById('helltide-list'),
  };

  let countdownTimer = null;
  let countdownValue = CONFIG.refreshInterval;
  let isLoading = false;

  // ── Screen reader ─────────────────────────────────────────────────────────

  function announce(msg) {
    el.announcer.textContent = '';
    setTimeout(() => { el.announcer.textContent = msg; }, 100);
  }

  // ── Time helpers ──────────────────────────────────────────────────────────

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  }

  function formatDateTime(ts) {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  }

  function diffParts(ms) {
    const total = Math.abs(ms);
    const h = Math.floor(total / 3_600_000);
    const m = Math.floor((total % 3_600_000) / 60_000);
    return { h, m };
  }

  function humanRemaining(endTs, now) {
    const ms = endTs - now;
    if (ms <= 0) return 'ending soon';
    const { h, m } = diffParts(ms);
    if (h > 0) return `${h}h ${m}m remaining`;
    return `${m} minute${m !== 1 ? 's' : ''} remaining`;
  }

  function humanUntil(spawnTs, now) {
    const ms = spawnTs - now;
    if (ms <= 0) return 'now';
    const { h, m } = diffParts(ms);
    if (h > 0) return `in ${h}h ${m}m`;
    return `in ${m} minute${m !== 1 ? 's' : ''}`;
  }

  // ── Icon helpers (Phosphor Icons) ────────────────────────────────────────

  const EVENT_ICONS = {
    'Helltide':     'ph-fire-simple',
    'World Boss':   'ph-skull',
    'Legion Event': 'ph-sword',
    'Chest Respawn':'ph-treasure-chest',
  };

  const STATUS_ICONS = {
    active:   { icon: 'ph-pulse',     label: '● Active' },
    upcoming: { icon: 'ph-clock',     label: '◆ Upcoming' },
    ended:    { icon: 'ph-x-circle',  label: '○ Ended' },
  };

  function eventIcon(title) {
    const key = Object.keys(EVENT_ICONS).find(k => title.startsWith(k));
    const cls = key ? EVENT_ICONS[key] : 'ph-calendar-dots';
    return `<i class="ph-bold ${cls}" aria-hidden="true"></i>`;
  }

  function statusIcon(statusData) {
    const s = STATUS_ICONS[statusData] || STATUS_ICONS.ended;
    return `<i class="ph-bold ${s.icon}" aria-hidden="true"></i> ${s.label}`;
  }

  // ── Card builder ──────────────────────────────────────────────────────────

  function buildCard({ title, statusLabel, statusData, detail1Label, detail1Value, detail1Ts, detail2Label, detail2Value, detail2Ts }) {
    const li = document.createElement('li');
    const article = document.createElement('article');
    article.className = 'helltide-card';
    article.setAttribute('data-status', statusData);
    article.setAttribute('aria-label',
      `${title}: ${statusLabel}. ${detail1Label}: ${detail1Value}${detail2Label ? '. ' + detail2Label + ': ' + detail2Value : ''}.`
    );

    const timeEl = (ts, label) => ts
      ? `<time class="detail-value" datetime="${new Date(ts).toISOString()}">${label}</time>`
      : `<span class="detail-value">${label}</span>`;

    article.innerHTML = `
      <header class="card-header">
        <h3 class="location-name">${eventIcon(title)} ${title}</h3>
        <span class="status-badge" data-status="${statusData}" aria-hidden="true">${statusIcon(statusData)}</span>
      </header>
      <div class="card-details">
        <div class="detail-item">
          <span class="detail-label">${detail1Label}</span>
          ${timeEl(detail1Ts, detail1Value)}
        </div>
        ${detail2Label ? `<div class="detail-item">
          <span class="detail-label">${detail2Label}</span>
          ${timeEl(detail2Ts, detail2Value)}
        </div>` : ''}
      </div>
    `;

    li.appendChild(article);
    return li;
  }

  // ── Render all trackers ───────────────────────────────────────────────────

  function renderAll(data) {
    const now = Date.now();
    el.helltideList.innerHTML = '';
    const summaries = [];

    // ── Helltide ──
    const htTime = data.helltide?.time;
    if (htTime) {
      const endTime  = htTime + CONFIG.helltideDuration;
      const isActive = now >= htTime && now < endTime;
      const upcoming = htTime > now;

      let statusLabel, statusData, d1Label, d1Value, d1Ts, d2Label, d2Value, d2Ts;

      if (isActive) {
        statusLabel = 'ACTIVE NOW';
        statusData  = 'active';
        d1Label = 'Status';   d1Value = humanRemaining(endTime, now);
        d2Label = 'Ends at';  d2Value = formatDateTime(endTime);  d2Ts = endTime;
        summaries.push(`Helltide active — ${humanRemaining(endTime, now)}`);
      } else if (upcoming) {
        statusLabel = 'UPCOMING';
        statusData  = 'upcoming';
        d1Label = 'Starts';   d1Value = humanUntil(htTime, now);
        d2Label = 'At';       d2Value = formatDateTime(htTime);   d2Ts = htTime;
        summaries.push(`Helltide ${humanUntil(htTime, now)}`);
      } else {
        statusLabel = 'ENDED';
        statusData  = 'ended';
        d1Label = 'Last spawn'; d1Value = formatDateTime(htTime); d1Ts = htTime;
        d2Label = 'Next';       d2Value = 'Waiting for update…';
        summaries.push('Helltide ended — awaiting next spawn');
      }

      el.helltideList.appendChild(buildCard({
        title: 'Helltide',
        statusLabel, statusData,
        detail1Label: d1Label, detail1Value: d1Value, detail1Ts: d1Ts,
        detail2Label: d2Label, detail2Value: d2Value, detail2Ts: d2Ts,
      }));
    }

    // ── World Boss ──
    const wbTime = data.worldBoss?.time ?? data.nextWorldBoss?.time;
    const wbName = data.worldBoss?.name ?? data.nextWorldBoss?.name ?? 'World Boss';
    if (wbTime) {
      const endTime  = wbTime + CONFIG.worldBossDuration;
      const isActive = now >= wbTime && now < endTime;
      const upcoming = wbTime > now;

      let statusLabel, statusData, d1Label, d1Value, d1Ts, d2Label, d2Value, d2Ts;

      if (isActive) {
        statusLabel = 'ACTIVE NOW';
        statusData  = 'active';
        d1Label = 'Status';   d1Value = humanRemaining(endTime, now);
        d2Label = 'Ends at';  d2Value = formatDateTime(endTime); d2Ts = endTime;
        summaries.push(`World Boss active — ${humanRemaining(endTime, now)}`);
      } else if (upcoming) {
        statusLabel = 'UPCOMING';
        statusData  = 'upcoming';
        d1Label = 'Starts'; d1Value = humanUntil(wbTime, now);
        d2Label = 'At';     d2Value = formatDateTime(wbTime); d2Ts = wbTime;
        summaries.push(`World Boss ${humanUntil(wbTime, now)}`);
      } else {
        statusLabel = 'ENDED';
        statusData  = 'ended';
        d1Label = 'Last seen'; d1Value = formatDateTime(wbTime); d1Ts = wbTime;
        d2Label = 'Next';      d2Value = 'Waiting for update…';
        summaries.push('World Boss ended');
      }

      el.helltideList.appendChild(buildCard({
        title: `World Boss — ${wbName}`,
        statusLabel, statusData,
        detail1Label: d1Label, detail1Value: d1Value, detail1Ts: d1Ts,
        detail2Label: d2Label, detail2Value: d2Value, detail2Ts: d2Ts,
      }));
    }

    // ── Zone Event (Legion) ──
    const zeTime = data.zoneEvent?.time;
    if (zeTime) {
      const endTime  = zeTime + CONFIG.zoneEventDuration;
      const isActive = now >= zeTime && now < endTime;
      const upcoming = zeTime > now;

      let statusLabel, statusData, d1Label, d1Value, d1Ts, d2Label, d2Value, d2Ts;

      if (isActive) {
        statusLabel = 'ACTIVE NOW';
        statusData  = 'active';
        d1Label = 'Status';  d1Value = humanRemaining(endTime, now);
        d2Label = 'Ends at'; d2Value = formatDateTime(endTime); d2Ts = endTime;
        summaries.push(`Legion Event active — ${humanRemaining(endTime, now)}`);
      } else if (upcoming) {
        statusLabel = 'UPCOMING';
        statusData  = 'upcoming';
        d1Label = 'Starts'; d1Value = humanUntil(zeTime, now);
        d2Label = 'At';     d2Value = formatDateTime(zeTime); d2Ts = zeTime;
        summaries.push(`Legion Event ${humanUntil(zeTime, now)}`);
      } else {
        statusLabel = 'ENDED';
        statusData  = 'ended';
        d1Label = 'Last seen'; d1Value = formatDateTime(zeTime); d1Ts = zeTime;
        d2Label = 'Next';      d2Value = 'Waiting for update…';
        summaries.push('Legion Event ended');
      }

      el.helltideList.appendChild(buildCard({
        title: 'Legion Event',
        statusLabel, statusData,
        detail1Label: d1Label, detail1Value: d1Value, detail1Ts: d1Ts,
        detail2Label: d2Label, detail2Value: d2Value, detail2Ts: d2Ts,
      }));
    }

    // ── Chest Respawn ──
    const crTime = data.chestRespawn;
    if (crTime) {
      const upcoming = crTime > now;
      const statusLabel = upcoming ? 'UPCOMING' : 'READY';
      const statusData  = upcoming ? 'upcoming' : 'active';
      const d1Value = upcoming ? `${humanUntil(crTime, now)} — ${formatDateTime(crTime)}` : 'Chests have respawned';
      summaries.push(upcoming ? `Chest respawn ${humanUntil(crTime, now)}` : 'Chests respawned');

      el.helltideList.appendChild(buildCard({
        title: 'Chest Respawn',
        statusLabel, statusData,
        detail1Label: upcoming ? 'Respawns' : 'Status',
        detail1Value: d1Value,
        detail1Ts: upcoming ? crTime : null,
      }));
    }

    if (el.helltideList.children.length === 0) {
      showState('empty');
      return;
    }

    showState('list');
    announce('Data updated. ' + summaries.join('. ') + '.');
  }

  // ── UI state ──────────────────────────────────────────────────────────────

  function showState(state) {
    el.loadingState.hidden = state !== 'loading';
    el.errorState.hidden   = state !== 'error';
    el.emptyState.hidden   = state !== 'empty';
    el.helltideList.hidden = state !== 'list';
  }

  function updateLastUpdated() {
    const now = new Date();
    el.lastUpdated.textContent = formatTime(now.getTime());
    el.lastUpdated.setAttribute('datetime', now.toISOString());
  }

  // ── Countdown ─────────────────────────────────────────────────────────────

  function startCountdown() {
    countdownValue = CONFIG.refreshInterval;
    el.countdown.textContent = countdownValue;
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      countdownValue--;
      el.countdown.textContent = countdownValue;
      if (countdownValue <= 0) fetchData();
    }, 1000);
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────

  async function fetchData() {
    if (isLoading) return;
    isLoading = true;
    el.refreshBtn.disabled = true;
    if (el.helltideList.children.length === 0) showState('loading');

    try {
      const res = await fetch(CONFIG.apiUrl + '?_=' + Date.now());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderAll(data);
      updateLastUpdated();
      startCountdown();
    } catch (err) {
      console.error(err);
      el.errorMessage.textContent = `Unable to load data. ${err.message}`;
      showState('error');
      announce('Error loading data. Use the retry button to try again.');
      startCountdown();
    } finally {
      isLoading = false;
      el.refreshBtn.disabled = false;
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    el.refreshBtn.addEventListener('click', () => { announce('Refreshing...'); fetchData(); });
    el.retryBtn.addEventListener('click',   () => { announce('Retrying...');   fetchData(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && countdownValue <= 0) fetchData();
    });
    fetchData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
