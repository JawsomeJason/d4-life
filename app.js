/**
 * D4 Helltide Tracker - Accessible JavaScript
 *
 * Features:
 * - Fetches Helltide data from diablo4.life API
 * - Auto-refreshes every 60 seconds with screen reader announcements
 * - Full keyboard accessibility
 * - ARIA live regions for dynamic content updates
 */

(function() {
  'use strict';

  // ==========================================================================
  // Configuration
  // ==========================================================================

  const CONFIG = {
    apiUrl: 'https://diablo4.life/api/trackers/helltide/reportHistory',
    refreshInterval: 60, // seconds
    helltideDuration: 60 * 60 * 1000, // 60 minutes in milliseconds
  };

  // ==========================================================================
  // DOM References
  // ==========================================================================

  const elements = {
    liveAnnouncer: document.getElementById('live-announcer'),
    lastUpdatedTime: document.getElementById('last-updated-time'),
    countdown: document.getElementById('countdown'),
    refreshBtn: document.getElementById('refresh-btn'),
    retryBtn: document.getElementById('retry-btn'),
    loadingState: document.getElementById('loading-state'),
    errorState: document.getElementById('error-state'),
    errorMessage: document.getElementById('error-message'),
    emptyState: document.getElementById('empty-state'),
    helltideList: document.getElementById('helltide-list'),
  };

  // ==========================================================================
  // State
  // ==========================================================================

  let countdownValue = CONFIG.refreshInterval;
  let countdownTimer = null;
  let isLoading = false;

  // ==========================================================================
  // Screen Reader Announcements
  // ==========================================================================

  /**
   * Announce a message to screen readers via live region
   * @param {string} message - The message to announce
   */
  function announce(message) {
    // Clear first to ensure re-announcement of same content
    elements.liveAnnouncer.textContent = '';

    // Use setTimeout to ensure the clear takes effect
    setTimeout(() => {
      elements.liveAnnouncer.textContent = message;
    }, 100);
  }

  // ==========================================================================
  // Time Formatting
  // ==========================================================================

  /**
   * Format a timestamp as an ISO datetime string
   * @param {number} timestamp - Unix timestamp in milliseconds
   * @returns {string} ISO datetime string
   */
  function toISOString(timestamp) {
    return new Date(timestamp).toISOString();
  }

  /**
   * Format a timestamp as a human-readable local time
   * @param {number} timestamp - Unix timestamp in milliseconds
   * @returns {string} Human-readable time (e.g., "3:45 PM")
   */
  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  /**
   * Format a timestamp as a human-readable date and time
   * @param {number} timestamp - Unix timestamp in milliseconds
   * @returns {string} Human-readable date and time
   */
  function formatDateTime(timestamp) {
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  /**
   * Get a human-readable relative time string
   * @param {number} timestamp - Unix timestamp in milliseconds
   * @param {number} now - Current timestamp
   * @returns {string} Relative time string (e.g., "Spawns in 23 minutes")
   */
  function getRelativeTime(timestamp, now) {
    const diff = timestamp - now;
    const absDiff = Math.abs(diff);

    const minutes = Math.floor(absDiff / (1000 * 60));
    const hours = Math.floor(absDiff / (1000 * 60 * 60));
    const remainingMinutes = minutes % 60;

    if (diff > 0) {
      // Future
      if (hours >= 1) {
        return `Spawns in ${hours} hour${hours > 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
      } else if (minutes > 1) {
        return `Spawns in ${minutes} minutes`;
      } else if (minutes === 1) {
        return 'Spawns in 1 minute';
      } else {
        return 'Spawns in less than a minute';
      }
    } else {
      // Past
      if (hours >= 1) {
        return `Spawned ${hours} hour${hours > 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''} ago`;
      } else if (minutes > 1) {
        return `Spawned ${minutes} minutes ago`;
      } else if (minutes === 1) {
        return 'Spawned 1 minute ago';
      } else {
        return 'Spawned just now';
      }
    }
  }

  /**
   * Determine the status of a Helltide
   * @param {number} spawnTime - Spawn timestamp
   * @param {number} now - Current timestamp
   * @returns {string} Status: 'active', 'upcoming', or 'ended'
   */
  function getHelltideStatus(spawnTime, now) {
    const endTime = spawnTime + CONFIG.helltideDuration;

    if (now < spawnTime) {
      return 'upcoming';
    } else if (now >= spawnTime && now < endTime) {
      return 'active';
    } else {
      return 'ended';
    }
  }

  /**
   * Get a human-readable status label
   * @param {string} status - Status code
   * @returns {string} Human-readable label
   */
  function getStatusLabel(status) {
    switch (status) {
      case 'active': return 'Active Now';
      case 'upcoming': return 'Upcoming';
      case 'ended': return 'Ended';
      default: return status;
    }
  }

  // ==========================================================================
  // UI State Management
  // ==========================================================================

  /**
   * Show a specific state and hide others
   * @param {string} state - 'loading', 'error', 'empty', or 'list'
   */
  function showState(state) {
    elements.loadingState.hidden = state !== 'loading';
    elements.errorState.hidden = state !== 'error';
    elements.emptyState.hidden = state !== 'empty';
    elements.helltideList.hidden = state !== 'list';
  }

  /**
   * Update the last updated timestamp
   */
  function updateLastUpdated() {
    const now = new Date();
    elements.lastUpdatedTime.textContent = formatTime(now.getTime());
    elements.lastUpdatedTime.setAttribute('datetime', now.toISOString());
  }

  // ==========================================================================
  // Countdown Timer
  // ==========================================================================

  /**
   * Start the countdown timer
   */
  function startCountdown() {
    countdownValue = CONFIG.refreshInterval;
    elements.countdown.textContent = countdownValue;

    if (countdownTimer) {
      clearInterval(countdownTimer);
    }

    countdownTimer = setInterval(() => {
      countdownValue--;
      elements.countdown.textContent = countdownValue;

      if (countdownValue <= 0) {
        fetchHelltideData();
      }
    }, 1000);
  }

  // ==========================================================================
  // Rendering
  // ==========================================================================

  /**
   * Create a Helltide card element
   * @param {Object} report - Helltide report data
   * @param {number} now - Current timestamp
   * @returns {HTMLLIElement} List item containing the card
   */
  function createHelltideCard(report, now) {
    const status = getHelltideStatus(report.spawnTime, now);
    const statusLabel = getStatusLabel(status);
    const relativeTime = getRelativeTime(report.spawnTime, now);
    const exactTime = formatDateTime(report.spawnTime);
    const reporterName = report.user?.displayName || 'Anonymous';

    const li = document.createElement('li');

    const article = document.createElement('article');
    article.className = 'helltide-card';
    article.setAttribute('data-status', status);
    article.setAttribute('aria-label',
      `${report.location}: ${statusLabel}. ${relativeTime}. Tier ${report.tier}. Reported by ${reporterName}.`
    );

    article.innerHTML = `
      <header class="card-header">
        <h3 class="location-name">${escapeHtml(report.location)}</h3>
        <span class="status-badge" data-status="${status}" aria-hidden="true">
          ${statusLabel}
        </span>
      </header>
      <div class="card-details">
        <div class="detail-item">
          <span class="detail-label">Status</span>
          <span class="detail-value time-relative">${relativeTime}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Spawn Time</span>
          <time class="detail-value" datetime="${toISOString(report.spawnTime)}">
            ${exactTime}
          </time>
        </div>
        <div class="detail-item">
          <span class="detail-label">Tier</span>
          <span class="detail-value tier-value">Tier ${report.tier}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Reported By</span>
          <span class="detail-value">${escapeHtml(reporterName)}</span>
        </div>
      </div>
    `;

    li.appendChild(article);
    return li;
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Sort reports: upcoming first (by spawn time ascending), then recent past (by spawn time descending)
   * @param {Array} reports - Array of report objects
   * @param {number} now - Current timestamp
   * @returns {Array} Sorted reports
   */
  function sortReports(reports, now) {
    const upcoming = [];
    const active = [];
    const past = [];

    reports.forEach(report => {
      const status = getHelltideStatus(report.spawnTime, now);
      if (status === 'upcoming') {
        upcoming.push(report);
      } else if (status === 'active') {
        active.push(report);
      } else {
        past.push(report);
      }
    });

    // Sort upcoming by spawn time (soonest first)
    upcoming.sort((a, b) => a.spawnTime - b.spawnTime);

    // Sort active by spawn time (most recent first - longest running at bottom)
    active.sort((a, b) => b.spawnTime - a.spawnTime);

    // Sort past by spawn time (most recent first)
    past.sort((a, b) => b.spawnTime - a.spawnTime);

    // Active first, then upcoming, then past
    return [...active, ...upcoming, ...past];
  }

  /**
   * Render the Helltide list
   * @param {Array} reports - Array of report objects
   */
  function renderHelltideList(reports) {
    const now = Date.now();
    const sortedReports = sortReports(reports, now);

    if (sortedReports.length === 0) {
      showState('empty');
      return;
    }

    // Clear existing list
    elements.helltideList.innerHTML = '';

    // Create cards
    sortedReports.forEach(report => {
      const card = createHelltideCard(report, now);
      elements.helltideList.appendChild(card);
    });

    showState('list');

    // Count for announcement
    const activeCount = sortedReports.filter(r => getHelltideStatus(r.spawnTime, now) === 'active').length;
    const upcomingCount = sortedReports.filter(r => getHelltideStatus(r.spawnTime, now) === 'upcoming').length;

    let announcement = 'Helltide data updated. ';
    if (activeCount > 0) {
      announcement += `${activeCount} active Helltide${activeCount > 1 ? 's' : ''}. `;
    }
    if (upcomingCount > 0) {
      announcement += `${upcomingCount} upcoming. `;
    }
    if (activeCount === 0 && upcomingCount === 0) {
      announcement += 'No active or upcoming Helltides. ';
    }

    announce(announcement);
  }

  // ==========================================================================
  // Data Fetching
  // ==========================================================================

  /**
   * Fetch Helltide data from the API
   */
  async function fetchHelltideData() {
    if (isLoading) return;

    isLoading = true;
    elements.refreshBtn.disabled = true;

    // Don't show loading state if we already have data (just refresh in background)
    if (elements.helltideList.children.length === 0) {
      showState('loading');
    }

    try {
      const response = await fetch(CONFIG.apiUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.reports || !Array.isArray(data.reports)) {
        throw new Error('Invalid data format received');
      }

      renderHelltideList(data.reports);
      updateLastUpdated();
      startCountdown();

    } catch (error) {
      console.error('Error fetching Helltide data:', error);

      elements.errorMessage.textContent =
        'Unable to load Helltide data. Please check your internet connection and try again.';
      showState('error');

      announce('Error loading Helltide data. Use the retry button to try again.');

      // Still restart countdown to auto-retry
      startCountdown();
    } finally {
      isLoading = false;
      elements.refreshBtn.disabled = false;
    }
  }

  // ==========================================================================
  // Event Listeners
  // ==========================================================================

  /**
   * Initialize event listeners
   */
  function initEventListeners() {
    // Refresh button
    elements.refreshBtn.addEventListener('click', () => {
      announce('Refreshing Helltide data...');
      fetchHelltideData();
    });

    // Retry button
    elements.retryBtn.addEventListener('click', () => {
      announce('Retrying...');
      fetchHelltideData();
    });

    // Handle visibility change - refresh when user returns to tab
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Check if countdown has elapsed while tab was hidden
        if (countdownValue <= 0) {
          fetchHelltideData();
        }
      }
    });
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  /**
   * Initialize the application
   */
  function init() {
    initEventListeners();
    fetchHelltideData();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
