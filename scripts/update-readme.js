const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ============================================================
// Markers for safe section replacement
// ============================================================
const MARKER_ACTIVITY_START = '<!-- WEEKLY_ACTIVITY_START -->';
const MARKER_ACTIVITY_END = '<!-- WEEKLY_ACTIVITY_END -->';
const MARKER_TECH_START = '<!-- TECH_ARSENAL_START -->';
const MARKER_TECH_END = '<!-- TECH_ARSENAL_END -->';

// ============================================================
// Technology badge mapping (language → shield.io config)
// ============================================================
const LANGUAGE_BADGE_MAP = {
  // Programming Languages
  'JavaScript': { color: 'F7DF1E', logo: 'javascript', logoColor: 'black' },
  'TypeScript': { color: '007ACC', logo: 'typescript', logoColor: 'white' },
  'Rust':       { color: '000000', logo: 'rust', logoColor: 'white' },
  'Python':     { color: '3776AB', logo: 'python', logoColor: 'white' },
  'Go':         { color: '00ADD8', logo: 'go', logoColor: 'white' },
  'Ruby':       { color: 'CC342D', logo: 'ruby', logoColor: 'white' },
  'PHP':        { color: '777BB4', logo: 'php', logoColor: 'white' },
  'Java':       { color: 'ED8B00', logo: 'openjdk', logoColor: 'white' },
  'C':          { color: 'A8B9CC', logo: 'c', logoColor: 'black' },
  'C++':        { color: '00599C', logo: 'cplusplus', logoColor: 'white' },
  'C#':         { color: '239120', logo: 'csharp', logoColor: 'white' },
  'Swift':      { color: 'FA7343', logo: 'swift', logoColor: 'white' },
  'Kotlin':     { color: '7F52FF', logo: 'kotlin', logoColor: 'white' },
  'Dart':       { color: '0175C2', logo: 'dart', logoColor: 'white' },
  'Shell':      { color: '4EAA25', logo: 'gnubash', logoColor: 'white' },
  'Lua':        { color: '2C2D72', logo: 'lua', logoColor: 'white' },
  'Zig':        { color: 'F7A41D', logo: 'zig', logoColor: 'white' },
  // Markup / Style
  'HTML':       { color: 'E34F26', logo: 'html5', logoColor: 'white' },
  'CSS':        { color: '1572B6', logo: 'css3', logoColor: 'white' },
  'SCSS':       { color: 'CC6699', logo: 'sass', logoColor: 'white' },
  // Data / Config
  'Dockerfile': { color: '2496ED', logo: 'docker', logoColor: 'white' },
  'Makefile':   { color: '427819', logo: 'gnu', logoColor: 'white' },
  'Vue':        { color: '4FC08D', logo: 'vuedotjs', logoColor: 'white' },
};

// ============================================================
// GitHub language colors (for the self-hosted SVG language bar)
// ============================================================
const LANGUAGE_COLOR = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5',
  Rust: '#dea584', Go: '#00ADD8', Ruby: '#701516', PHP: '#4F5D95',
  Java: '#b07219', C: '#555555', 'C++': '#f34b7d', 'C#': '#178600',
  Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB', Shell: '#89e051',
  Lua: '#000080', Zig: '#ec915c', HTML: '#e34c26', CSS: '#563d7c',
  SCSS: '#c6538c', Vue: '#41b883', Dockerfile: '#384d54', Solidity: '#AA6746',
  Makefile: '#427819', Swiftpm: '#F05138',
};
const DEFAULT_LANG_COLOR = '#858585';

// Theme tokens for the self-hosted SVG cards (GitHub dark / light).
const SVG_THEME = {
  dark:  { bg: '#0d1117', border: '#30363d', title: '#58a6ff', text: '#c9d1d9', muted: '#8b949e', track: '#21262d' },
  light: { bg: '#ffffff', border: '#d0d7de', title: '#0969da', text: '#1f2328', muted: '#656d76', track: '#eaeef2' },
};

// ============================================================
// GitHubDataCollector – fetch raw data from GitHub APIs
// ============================================================
class GitHubDataCollector {
  constructor(octokit, owner) {
    this.octokit = octokit;
    this.owner = owner;
  }

  /**
   * Fetch repository stats and language data using GraphQL.
   * Single request instead of N+1 REST calls.
   */
  async fetchRepoDataGraphQL() {
    const repos = [];
    const languageBytes = {};
    let hasNextPage = true;
    let cursor = null;

    try {
      while (hasNextPage) {
        const query = `
          query($owner: String!, $cursor: String) {
            user(login: $owner) {
              repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, privacy: PUBLIC) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  name
                  stargazerCount
                  forkCount
                  languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
                    edges {
                      size
                      node { name }
                    }
                  }
                }
              }
            }
          }
        `;

        const result = await this.octokit.graphql(query, {
          owner: this.owner,
          cursor,
        });

        const repoData = result?.user?.repositories;
        if (!repoData) {
          throw new Error(`GraphQL: no repositories for user "${this.owner}"`);
        }
        hasNextPage = repoData.pageInfo.hasNextPage;
        cursor = repoData.pageInfo.endCursor;

        for (const repo of repoData.nodes) {
          repos.push({
            name: repo.name,
            stargazers_count: repo.stargazerCount,
            forks_count: repo.forkCount,
          });

          for (const edge of repo.languages.edges) {
            const lang = edge.node.name;
            languageBytes[lang] = (languageBytes[lang] || 0) + edge.size;
          }
        }
      }

      console.log(`[GraphQL] Fetched ${repos.length} repositories with languages`);
    } catch (error) {
      console.error('GraphQL failed, falling back to REST:', error.message);
      return this.fetchRepoDataREST();
    }

    return { repos, languageBytes };
  }

  /**
   * REST fallback for repo + language data.
   */
  async fetchRepoDataREST() {
    const repos = [];
    const languageBytes = {};

    try {
      for (let page = 1; ; page++) {
        const { data } = await this.octokit.rest.repos.listForUser({
          username: this.owner,
          type: 'owner',
          per_page: 100,
          page,
        });
        if (data.length === 0) break;
        repos.push(...data);
      }

      // Check rate limit before fetching languages
      const { data: rateData } = await this.octokit.rest.rateLimit.get();
      const remaining = rateData.resources.core.remaining;
      const maxRepos = Math.min(repos.length, remaining - 10);

      if (maxRepos > 0) {
        for (const repo of repos.slice(0, maxRepos)) {
          const { data: langs } = await this.octokit.rest.repos.listLanguages({
            owner: repo.owner.login,
            repo: repo.name,
          });
          for (const [lang, bytes] of Object.entries(langs)) {
            languageBytes[lang] = (languageBytes[lang] || 0) + bytes;
          }
        }
      } else if (repos.length > 0) {
        console.warn(`[REST] Rate limit too low (remaining=${remaining}); skipping language fetch — language bar may be empty`);
      }

      console.log(`[REST] Fetched ${repos.length} repositories`);
    } catch (error) {
      console.error('Error in REST fallback:', error.message);
    }

    return { repos, languageBytes };
  }

  /**
   * Fetch user events (up to 10 pages = 300 events).
   * Events API is REST-only (no GraphQL equivalent).
   */
  async fetchUserEvents() {
    const allEvents = [];
    try {
      for (let page = 1; page <= 10; page++) {
        const { data } = await this.octokit.rest.activity.listPublicEventsForUser({
          username: this.owner,
          per_page: 30,
          page,
        });
        if (data.length === 0) break;
        allEvents.push(...data);
      }
      console.log(`Fetched ${allEvents.length} events total`);
    } catch (error) {
      console.error('Error fetching user events:', error.message);
    }
    return allEvents;
  }

  /**
   * Fetch contribution stats via GraphQL contributionsCollection.
   * This includes private contributions and is more reliable than Events API.
   */
  async fetchContributionStats() {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 7);

    try {
      const query = `
        query($owner: String!, $from: DateTime!, $to: DateTime!) {
          user(login: $owner) {
            contributionsCollection(from: $from, to: $to) {
              totalCommitContributions
              totalPullRequestContributions
              totalIssueContributions
              totalPullRequestReviewContributions
              commitContributionsByRepository(maxRepositories: 10) {
                repository { nameWithOwner }
                contributions { totalCount }
              }
            }
          }
        }
      `;

      const result = await this.octokit.graphql(query, {
        owner: this.owner,
        from: from.toISOString(),
        to: to.toISOString(),
      });

      const user = result?.user;
      if (!user) {
        console.warn(`[GraphQL] User "${this.owner}" not found`);
        return null;
      }

      const collection = user.contributionsCollection;
      const stats = {
        commits: collection.totalCommitContributions,
        pullRequests: collection.totalPullRequestContributions,
        issues: collection.totalIssueContributions,
        reviews: collection.totalPullRequestReviewContributions,
        activeRepos: collection.commitContributionsByRepository.map(r => {
          const full = r.repository.nameWithOwner;
          const parts = full.split('/');
          return {
            name: parts.length > 1 ? parts[1] : full,
            fullName: full,
            commits: r.contributions.totalCount,
          };
        }),
      };

      console.log(`[GraphQL] Contributions: ${stats.commits} commits, ${stats.pullRequests} PRs, ${stats.issues} issues, ${stats.reviews} reviews`);
      return stats;
    } catch (error) {
      console.error('Error fetching contribution stats:', error.message);
      return null;
    }
  }
}

// ============================================================
// StatsAggregator – process raw data into displayable stats
// ============================================================
class StatsAggregator {
  /**
   * Filter events to the last 7 days and compute weekly stats.
   * When contributionStats (from GraphQL) is provided, use it as the
   * primary data source for counts; Events API supplements with commit
   * messages and other activity details.
   */
  static aggregateWeeklyStats(events, contributionStats = null) {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const weeklyEvents = events.filter(e => new Date(e.created_at) >= oneWeekAgo);

    // Extract commit messages from Events API (best-effort)
    let eventsCommits = 0;
    const commitMessages = [];
    for (const event of weeklyEvents) {
      if (event.type === 'PushEvent') {
        eventsCommits += event.payload.size || 0;
        for (const c of (event.payload.commits || [])) {
          commitMessages.push({
            message: c.message,
            repo: event.repo.name.replace(`${event.actor.login}/`, ''),
          });
        }
      }
    }

    const eventsPRs = weeklyEvents.filter(e => e.type === 'PullRequestEvent').length;
    const eventsIssues = weeklyEvents.filter(e => e.type === 'IssuesEvent').length;
    const eventsActiveRepos = [...new Set(
      weeklyEvents.map(e => e.repo.name.replace(`${e.actor.login}/`, ''))
    )];

    // Summarize other event types for richer activity display
    const otherActivity = [];
    const eventTypeCounts = {};
    for (const event of weeklyEvents) {
      if (!['PushEvent', 'PullRequestEvent', 'IssuesEvent'].includes(event.type)) {
        eventTypeCounts[event.type] = (eventTypeCounts[event.type] || 0) + 1;
      }
    }
    const EVENT_TYPE_LABELS = {
      'CreateEvent': '🌱 Branch/Repo created',
      'DeleteEvent': '🗑️ Branch/Repo deleted',
      'WatchEvent': '⭐ Starred a repo',
      'ForkEvent': '🍴 Forked a repo',
      'IssueCommentEvent': '💬 Issue comments',
      'PullRequestReviewEvent': '👀 PR reviews',
      'PullRequestReviewCommentEvent': '💬 PR review comments',
      'ReleaseEvent': '🏷️ Releases',
      'PublicEvent': '📢 Made repo public',
      'MemberEvent': '👥 Collaborator added',
      'GollumEvent': '📝 Wiki updates',
      'CommitCommentEvent': '💬 Commit comments',
    };
    for (const [type, count] of Object.entries(eventTypeCounts)) {
      const label = EVENT_TYPE_LABELS[type] || type.replace('Event', '');
      otherActivity.push({ type, label, count });
    }
    otherActivity.sort((a, b) => b.count - a.count);

    // Use GraphQL contributionStats as primary source when available
    let commits, pullRequests, issues, reviews, activeRepos;
    if (contributionStats) {
      commits = contributionStats.commits;
      pullRequests = contributionStats.pullRequests;
      issues = contributionStats.issues;
      reviews = contributionStats.reviews || 0;
      // Merge active repos: GraphQL provides repos with commits, Events API provides repos with any activity
      const graphqlRepoNames = contributionStats.activeRepos.map(r => r.name);
      activeRepos = [...new Set([...graphqlRepoNames, ...eventsActiveRepos])];
    } else {
      commits = eventsCommits;
      pullRequests = eventsPRs;
      issues = eventsIssues;
      reviews = 0;
      activeRepos = eventsActiveRepos;
    }

    return {
      commits,
      commitMessages: commitMessages.slice(0, 8),
      pullRequests,
      issues,
      reviews,
      activeRepos,
      otherActivity,
      weekStart: oneWeekAgo.toLocaleDateString('ja-JP'),
      weekEnd: new Date().toLocaleDateString('ja-JP'),
    };
  }

  /**
   * Calculate language percentages from byte counts.
   */
  static calculateLanguageRatio(languageBytes, topN = 5) {
    const totalBytes = Object.values(languageBytes).reduce((sum, b) => sum + b, 0);
    if (totalBytes === 0) return [];

    const sorted = Object.entries(languageBytes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN);

    return sorted.map(([lang, bytes]) => ({
      name: lang,
      bytes,
      percent: Math.round((bytes / totalBytes) * 1000) / 10,
    }));
  }

  /**
   * Sum stars and forks across all repos.
   */
  static aggregateRepoStats(repos) {
    let totalStars = 0;
    let totalForks = 0;
    for (const repo of repos) {
      totalStars += repo.stargazers_count || 0;
      totalForks += repo.forks_count || 0;
    }
    return { totalStars, totalForks, totalRepos: repos.length };
  }
}

// ============================================================
// HealthChecker – verify external service URLs
// ============================================================
class HealthChecker {
  /**
   * Check if a URL is accessible (HEAD request).
   */
  static checkUrl(url, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const protocol = url.startsWith('https') ? https : http;
      const req = protocol.request(url, { method: 'HEAD', timeout: timeoutMs }, (res) => {
        resolve({
          url,
          status: res.statusCode,
          success: res.statusCode >= 200 && res.statusCode < 400,
        });
      });
      req.on('error', (error) => {
        resolve({ url, status: 0, success: false, error: error.message });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ url, status: 0, success: false, error: 'Timeout' });
      });
      req.end();
    });
  }

  /**
   * Run health checks against critical external services used in README.
   * Returns { passed, failed, errors[] }
   */
  static async runChecks(urls) {
    const results = { passed: 0, failed: 0, errors: [] };

    for (const { name, url } of urls) {
      const result = await HealthChecker.checkUrl(url);
      if (result.success) {
        results.passed++;
        console.log(`  ✅ ${name}`);
      } else {
        results.failed++;
        results.errors.push({ name, url, error: result.error || `HTTP ${result.status}` });
        console.log(`  ❌ ${name} (${result.error || result.status})`);
      }
    }

    return results;
  }
}

// Remaining external dependency in the README. Stats/activity cards are now
// self-hosted SVGs committed to assets/, so shields.io (tech badges) is the
// only third-party image service left to monitor.
const README_EXTERNAL_SERVICES = [
  { name: 'Shields.io', url: 'https://img.shields.io/badge/test-test-blue' },
];

// ============================================================
// SvgCardRenderer – generate self-hosted SVG stat cards
// (zero third-party image-service dependency)
// ============================================================
class SvgCardRenderer {
  /**
   * Escape a string for safe inclusion in SVG/XML text.
   * @param {unknown} value
   * @returns {string}
   */
  static escapeXml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Render a compact GitHub stats card as a standalone SVG string.
   * One card holds weekly activity, all-time repo stats and a top-language bar.
   *
   * @param {{ owner: string, weeklyStats: object, languages: Array, repoStats: object }} data
   * @param {'dark'|'light'} theme
   * @returns {string} SVG markup
   */
  static generateStatsCard({ owner, weeklyStats, languages, repoStats }, theme = 'dark') {
    const t = SVG_THEME[theme] || SVG_THEME.dark;
    const W = 480;
    const H = 200;
    const pad = 25;
    const barW = W - pad * 2;
    const barY = 138;
    const barH = 8;

    const ws = weeklyStats || { commits: 0, pullRequests: 0, issues: 0, reviews: 0 };
    const rs = repoStats || { totalStars: 0, totalForks: 0, totalRepos: 0 };
    const langs = (languages || []).slice(0, 5);

    // Weekly highlights line (always show commits + PRs; issues/reviews when > 0)
    const weeklyParts = [`${ws.commits} commits`, `${ws.pullRequests} PRs`];
    if (ws.issues > 0) weeklyParts.push(`${ws.issues} issues`);
    if (ws.reviews > 0) weeklyParts.push(`${ws.reviews} reviews`);
    const weeklyLine = weeklyParts.join('  ·  ');
    const allTimeLine = `${rs.totalStars} stars  ·  ${rs.totalForks} forks  ·  ${rs.totalRepos} repos`;

    // Segmented language bar (normalised across shown languages)
    const shownTotal = langs.reduce((sum, l) => sum + l.percent, 0) || 1;
    let segX = pad;
    const segments = langs.map((l) => {
      const w = (l.percent / shownTotal) * barW;
      const color = LANGUAGE_COLOR[l.name] || DEFAULT_LANG_COLOR;
      const seg = `<rect x="${segX.toFixed(1)}" y="${barY}" width="${Math.max(0, w).toFixed(1)}" height="${barH}" fill="${color}"/>`;
      segX += w;
      return seg;
    }).join('');

    // Legend with simple width-based wrapping
    const legendStartY = 170;
    const lineHeight = 18;
    let lx = pad;
    let ly = legendStartY;
    const legend = langs.map((l) => {
      const color = LANGUAGE_COLOR[l.name] || DEFAULT_LANG_COLOR;
      const label = `${l.name} ${l.percent}%`;
      const itemW = 16 + label.length * 6.2 + 14;
      if (lx + itemW > W - pad && lx > pad) {
        lx = pad;
        ly += lineHeight;
      }
      const dot = `<circle cx="${(lx + 5).toFixed(1)}" cy="${(ly - 4).toFixed(1)}" r="5" fill="${color}"/>`;
      const text = `<text x="${(lx + 16).toFixed(1)}" y="${ly}" fill="${t.text}" font-size="11">${SvgCardRenderer.escapeXml(label)}</text>`;
      lx += itemW;
      return dot + text;
    }).join('');

    const langBar = langs.length > 0
      ? [
          `<text x="${pad}" y="128" fill="${t.muted}" font-size="12">Top languages</text>`,
          `<rect x="${pad}" y="${barY}" width="${barW}" height="${barH}" rx="4" fill="${t.track}"/>`,
          `<defs><clipPath id="bar-${theme}"><rect x="${pad}" y="${barY}" width="${barW}" height="${barH}" rx="4"/></clipPath></defs>`,
          `<g clip-path="url(#bar-${theme})">${segments}</g>`,
          legend,
        ].join('\n')
      : '';

    return [
      `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${SvgCardRenderer.escapeXml(owner)} GitHub statistics">`,
      `<style>text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;}</style>`,
      `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="${t.bg}" stroke="${t.border}"/>`,
      `<text x="${pad}" y="40" fill="${t.title}" font-size="17" font-weight="600">${SvgCardRenderer.escapeXml(owner)} · GitHub Stats</text>`,
      `<text x="${pad}" y="76" fill="${t.muted}" font-size="12">This week</text>`,
      `<text x="${pad + 78}" y="76" fill="${t.text}" font-size="13" font-weight="500">${SvgCardRenderer.escapeXml(weeklyLine)}</text>`,
      `<text x="${pad}" y="102" fill="${t.muted}" font-size="12">All time</text>`,
      `<text x="${pad + 78}" y="102" fill="${t.text}" font-size="13" font-weight="500">${SvgCardRenderer.escapeXml(allTimeLine)}</text>`,
      langBar,
      `</svg>`,
    ].filter(Boolean).join('\n');
  }
}

// ============================================================
// ReadmeRenderer – generate the Markdown/HTML content
// ============================================================
class ReadmeRenderer {
  /**
   * Generate the Stats section content: a single <picture> that points at the
   * self-hosted dark/light SVG cards (written separately to assets/), plus a
   * last-updated timestamp. The data itself lives in the SVG; this only wires
   * up theme-aware image references.
   *
   * @param {string} owner
   * @param {string} [assetsDir]
   * @returns {string}
   */
  static generateActivitySection(owner, assetsDir = 'assets') {
    const now = new Date().toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const dark = `./${assetsDir}/github-stats-dark.svg`;
    const light = `./${assetsDir}/github-stats-light.svg`;

    return [
      '',
      '<div align="center">',
      '  <picture>',
      `    <source media="(prefers-color-scheme: dark)" srcset="${dark}">`,
      `    <source media="(prefers-color-scheme: light)" srcset="${light}">`,
      `    <img src="${dark}" alt="${owner} の GitHub Stats" width="480">`,
      '  </picture>',
      '  <br>',
      `  <sub>🤖 <em>Last updated: ${now}</em></sub>`,
      '</div>',
      '',
    ].join('\n');
  }

  /**
   * Generate the Tech Stack section dynamically from actual repo languages.
   * Minimal design: a single centered row of `flat` badges for the top-N
   * languages (by bytes) that have a known badge mapping.
   *
   * @param {Record<string, number>} languageBytes
   * @param {number} [topN]
   * @returns {string}
   */
  static generateTechArsenalSection(languageBytes, topN = 8) {
    const sorted = Object.entries(languageBytes)
      .sort((a, b) => b[1] - a[1])
      .map(([lang]) => lang)
      .filter((lang) => LANGUAGE_BADGE_MAP[lang])
      .slice(0, topN);

    const lines = ['', '<div align="center">', ''];
    for (const lang of sorted) {
      const badge = LANGUAGE_BADGE_MAP[lang];
      const encoded = encodeURIComponent(lang);
      const altText = SvgCardRenderer.escapeXml(lang);
      lines.push(`<img src="https://img.shields.io/badge/${encoded}-${badge.color}?style=flat&logo=${badge.logo}&logoColor=${badge.logoColor}" alt="${altText}"/>`);
    }
    lines.push('');
    lines.push('</div>');
    lines.push('');

    return lines.join('\n');
  }
}

// ============================================================
// ReadmeWriter – safely replace content between markers
// ============================================================
class ReadmeWriter {
  /**
   * Find start/end marker positions.
   */
  static parseMarkers(content, startMarker, endMarker) {
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1) return null;
    if (startIdx >= endIdx) return null;

    return {
      startIndex: startIdx,
      endIndex: endIdx + endMarker.length,
    };
  }

  /**
   * Replace content between markers (preserving markers themselves).
   */
  static replaceSection(content, newSection, startMarker, endMarker) {
    const markers = ReadmeWriter.parseMarkers(content, startMarker, endMarker);
    if (!markers) {
      throw new Error(`Markers not found in README. Expected "${startMarker}" and "${endMarker}"`);
    }

    const before = content.substring(0, markers.startIndex);
    const after = content.substring(markers.endIndex);

    return before + startMarker + '\n' + newSection + '\n' + endMarker + after;
  }

  /**
   * Check if a pair of markers exists in the content.
   */
  static hasMarkers(content, startMarker, endMarker) {
    return ReadmeWriter.parseMarkers(content, startMarker, endMarker) !== null;
  }
}

// ============================================================
// DiffReporter – generate human-readable diff for logs
// ============================================================
class DiffReporter {
  /**
   * Generate a simple line-by-line diff between two strings.
   * Returns the diff string and a summary.
   */
  static generateDiff(oldContent, newContent) {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    const diffLines = [];
    let additions = 0;
    let deletions = 0;

    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const oldLine = i < oldLines.length ? oldLines[i] : undefined;
      const newLine = i < newLines.length ? newLines[i] : undefined;

      if (oldLine === newLine) continue;

      if (oldLine !== undefined && newLine !== undefined) {
        diffLines.push(`- L${i + 1}: ${oldLine.substring(0, 120)}`);
        diffLines.push(`+ L${i + 1}: ${newLine.substring(0, 120)}`);
        additions++;
        deletions++;
      } else if (oldLine === undefined) {
        diffLines.push(`+ L${i + 1}: ${newLine.substring(0, 120)}`);
        additions++;
      } else {
        diffLines.push(`- L${i + 1}: ${oldLine.substring(0, 120)}`);
        deletions++;
      }
    }

    return {
      diff: diffLines.join('\n'),
      additions,
      deletions,
      hasChanges: diffLines.length > 0,
    };
  }
}

// ============================================================
// Main orchestrator
// ============================================================
class ReadmeUpdater {
  constructor(options = {}) {
    this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    this.owner = process.env.GITHUB_OWNER || 'shoya-sue';
    // Fail fast on an invalid owner (GitHub usernames: 1-39 chars, alphanumeric or hyphen).
    if (!/^[A-Za-z0-9-]{1,39}$/.test(this.owner)) {
      throw new Error(`Invalid GitHub owner: "${this.owner}"`);
    }
    this.dryRun = options.dryRun || process.env.DRY_RUN === 'true';
    this.skipHealthCheck = options.skipHealthCheck || process.env.SKIP_HEALTH_CHECK === 'true';
    this.collector = new GitHubDataCollector(this.octokit, this.owner);
  }

  /**
   * Write the generated SVG stat cards to assets/. Throws a descriptive error
   * if the directory or files cannot be written (surfaced in CI logs).
   *
   * @param {Record<string, string>} svgCards - filename → SVG content
   * @returns {number} number of files written
   */
  writeSvgCards(svgCards) {
    const assetsDir = path.join(__dirname, '..', 'assets');
    try {
      fs.mkdirSync(assetsDir, { recursive: true });
      for (const [filename, svg] of Object.entries(svgCards)) {
        fs.writeFileSync(path.join(assetsDir, filename), svg);
      }
    } catch (error) {
      throw new Error(`Failed to write SVG cards to ${assetsDir}: ${error.message}`);
    }
    return Object.keys(svgCards).length;
  }

  async updateReadme() {
    try {
      console.log(`Starting README update for user: ${this.owner}`);
      if (this.dryRun) console.log('🔍 DRY RUN MODE – no files will be written');

      // 1. Collect data: GraphQL for repos/languages, REST for events, GraphQL for contributions (parallel)
      const [{ repos, languageBytes }, events, contributionStats] = await Promise.all([
        this.collector.fetchRepoDataGraphQL(),
        this.collector.fetchUserEvents(),
        this.collector.fetchContributionStats(),
      ]);

      // 2. Process data
      const weeklyStats = StatsAggregator.aggregateWeeklyStats(events, contributionStats);
      const languages = StatsAggregator.calculateLanguageRatio(languageBytes);
      const repoStats = StatsAggregator.aggregateRepoStats(repos);

      console.log('\n--- Aggregated Data ---');
      console.log(`Commits: ${weeklyStats.commits}, PRs: ${weeklyStats.pullRequests}, Issues: ${weeklyStats.issues}, Reviews: ${weeklyStats.reviews}`);
      console.log(`Active repos: ${weeklyStats.activeRepos.join(', ') || '(none)'}`);
      console.log(`Languages: ${languages.map(l => `${l.name}(${l.percent}%)`).join(', ') || '(none)'}`);
      console.log(`Stars: ${repoStats.totalStars}, Forks: ${repoStats.totalForks}, Repos: ${repoStats.totalRepos}`);

      // 3. Generate the self-hosted SVG stat cards (dark + light) and write
      //    them to assets/. These replace all third-party stat-image services.
      const cardData = { owner: this.owner, weeklyStats, languages, repoStats };
      const svgCards = {
        'github-stats-dark.svg': SvgCardRenderer.generateStatsCard(cardData, 'dark'),
        'github-stats-light.svg': SvgCardRenderer.generateStatsCard(cardData, 'light'),
      };
      if (this.dryRun) {
        console.log('\n🔍 DRY RUN – skipping SVG card write (cards generated in memory)');
      } else {
        const written = this.writeSvgCards(svgCards);
        console.log(`\n✅ Wrote ${written} SVG stat card(s) to assets/`);
      }

      // 4. Read current README
      const readmePath = path.join(__dirname, '..', 'README.md');
      const readmeContent = fs.readFileSync(readmePath, 'utf8');

      // 5. Render and replace the Stats section (theme-aware <picture> wiring)
      let updatedContent = readmeContent;
      const activitySection = ReadmeRenderer.generateActivitySection(this.owner);
      updatedContent = ReadmeWriter.replaceSection(
        updatedContent, activitySection,
        MARKER_ACTIVITY_START, MARKER_ACTIVITY_END
      );

      // 5. Render and replace Tech Arsenal section (if markers exist)
      if (ReadmeWriter.hasMarkers(updatedContent, MARKER_TECH_START, MARKER_TECH_END)) {
        const techSection = ReadmeRenderer.generateTechArsenalSection(languageBytes);
        updatedContent = ReadmeWriter.replaceSection(
          updatedContent, techSection,
          MARKER_TECH_START, MARKER_TECH_END
        );
        console.log('\nTech Arsenal section updated dynamically');
      } else {
        console.log('\nTech Arsenal markers not found – skipping dynamic generation');
      }

      // 6. Generate and display diff (ignore the volatile timestamp; non-greedy
      //    so multiple "Last updated:" lines never over-match across content)
      const stripTimestamp = (s) => s.replace(/Last updated:.*?<\/em>/g, '');
      const diff = DiffReporter.generateDiff(
        stripTimestamp(readmeContent),
        stripTimestamp(updatedContent)
      );

      if (!diff.hasChanges) {
        console.log('\n✅ No meaningful changes detected – skipping write');
        return { updated: false, diff };
      }

      console.log(`\n--- Diff Summary ---`);
      console.log(`+${diff.additions} additions, -${diff.deletions} deletions`);
      console.log(diff.diff.split('\n').slice(0, 40).join('\n'));
      if (diff.diff.split('\n').length > 40) {
        console.log(`... and ${diff.diff.split('\n').length - 40} more lines`);
      }

      // 7. Write (or skip in dry-run)
      if (this.dryRun) {
        console.log('\n🔍 DRY RUN – skipping file write');
        return { updated: false, diff, dryRun: true };
      }

      fs.writeFileSync(readmePath, updatedContent);
      console.log(`\n✅ README updated successfully! (${updatedContent.length} chars)`);

      // 8. Health check (post-update)
      if (!this.skipHealthCheck) {
        console.log('\n--- Post-Update Health Check ---');
        const healthResults = await HealthChecker.runChecks(README_EXTERNAL_SERVICES);
        if (healthResults.failed > 0) {
          console.warn(`\n⚠️  ${healthResults.failed} external service(s) unreachable`);
          // Write health report for workflow to pick up
          const reportPath = path.join(__dirname, '..', 'health-report.json');
          fs.writeFileSync(reportPath, JSON.stringify(healthResults, null, 2));
        }
      }

      return { updated: true, diff };
    } catch (error) {
      console.error('Error updating README:', error);
      return { updated: false, error: error.message };
    }
  }
}

// ============================================================
// CLI entry point
// ============================================================
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    skipHealthCheck: args.includes('--skip-health-check'),
  };

  const updater = new ReadmeUpdater(options);
  updater.updateReadme().then((result) => {
    if (result.error) {
      process.exit(1);
    }
    // In non-dry-run mode, exit 0 even if no changes (that's normal)
    process.exit(0);
  });
}

module.exports = {
  GitHubDataCollector,
  StatsAggregator,
  SvgCardRenderer,
  ReadmeRenderer,
  ReadmeWriter,
  ReadmeUpdater,
  DiffReporter,
  HealthChecker,
  README_EXTERNAL_SERVICES,
  LANGUAGE_BADGE_MAP,
  LANGUAGE_COLOR,
  SVG_THEME,
  MARKER_ACTIVITY_START,
  MARKER_ACTIVITY_END,
  MARKER_TECH_START,
  MARKER_TECH_END,
};
