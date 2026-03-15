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

        const repoData = result.user.repositories;
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
}

// ============================================================
// StatsAggregator – process raw data into displayable stats
// ============================================================
class StatsAggregator {
  /**
   * Filter events to the last 7 days and compute weekly stats.
   */
  static aggregateWeeklyStats(events) {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const weeklyEvents = events.filter(e => new Date(e.created_at) >= oneWeekAgo);

    let commits = 0;
    const commitMessages = [];
    for (const event of weeklyEvents) {
      if (event.type === 'PushEvent') {
        commits += event.payload.size || 0;
        for (const c of (event.payload.commits || [])) {
          commitMessages.push({
            message: c.message,
            repo: event.repo.name.replace(`${event.actor.login}/`, ''),
          });
        }
      }
    }

    const pullRequests = weeklyEvents.filter(e => e.type === 'PullRequestEvent').length;
    const issues = weeklyEvents.filter(e => e.type === 'IssuesEvent').length;
    const activeRepos = [...new Set(
      weeklyEvents.map(e => e.repo.name.replace(`${e.actor.login}/`, ''))
    )];

    return {
      commits,
      commitMessages: commitMessages.slice(0, 8),
      pullRequests,
      issues,
      activeRepos,
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

// Critical external services used in the README
const README_EXTERNAL_SERVICES = [
  { name: 'Capsule Render', url: 'https://capsule-render.vercel.app/api?type=waving&color=gradient&height=1&section=header' },
  { name: 'Typing SVG', url: 'https://readme-typing-svg.herokuapp.com?font=JetBrains+Mono&size=1&lines=test' },
  { name: 'GitHub Stats', url: 'https://github-stats-alpha.vercel.app/api?username=shoya-sue' },
  { name: 'Activity Graph', url: 'https://github-readme-activity-graph.vercel.app/graph?username=shoya-sue' },
  { name: 'GitHub Trophies', url: 'https://github-trophies.vercel.app/?username=shoya-sue' },
  { name: 'Shields.io', url: 'https://img.shields.io/badge/test-test-blue' },
  { name: 'Profile Views', url: 'https://komarev.com/ghpvc/?username=shoya-sue' },
];

// ============================================================
// ReadmeRenderer – generate the Markdown/HTML content
// ============================================================
class ReadmeRenderer {
  /**
   * Generate the Weekly Activity section content.
   */
  static generateActivitySection(weeklyStats, languages, repoStats) {
    const stats = weeklyStats;

    if (!stats) {
      return [
        '',
        '<div align="center">',
        '  <h2>📊 Weekly Activity</h2>',
        '  <p><em>No recent activity data available</em></p>',
        '</div>',
        '',
      ].join('\n');
    }

    const lines = [];

    lines.push('');
    lines.push('<div align="center">');
    lines.push('  <h2>📊 Weekly Activity</h2>');
    lines.push(`  <p><code>${stats.weekStart} - ${stats.weekEnd}</code></p>`);
    lines.push('</div>');
    lines.push('');
    lines.push('<table align="center" width="100%">');
    lines.push('<tr>');
    lines.push('<td width="50%" align="center">');
    lines.push('');

    // Left column: Highlights
    lines.push('### 🚀 This Week\'s Highlights');
    lines.push('');
    lines.push('<div align="center">');
    lines.push('<table>');
    lines.push('<tr>');
    lines.push('<td align="center">');
    lines.push(`<img src="https://img.shields.io/badge/Commits-${stats.commits}-blue?style=for-the-badge&logo=git&logoColor=white" alt="Commits"/>`);
    lines.push('</td>');
    lines.push('</tr>');

    if (stats.pullRequests > 0) {
      lines.push('<tr><td align="center">');
      lines.push(`<img src="https://img.shields.io/badge/Pull%20Requests-${stats.pullRequests}-green?style=for-the-badge&logo=github&logoColor=white" alt="PRs"/>`);
      lines.push('</td></tr>');
    }
    if (stats.issues > 0) {
      lines.push('<tr><td align="center">');
      lines.push(`<img src="https://img.shields.io/badge/Issues-${stats.issues}-orange?style=for-the-badge&logo=github&logoColor=white" alt="Issues"/>`);
      lines.push('</td></tr>');
    }
    lines.push('</table>');
    lines.push('</div>');
    lines.push('');

    // Languages
    if (languages && languages.length > 0) {
      lines.push('### 💻 Languages Used');
      lines.push('<div align="center">');
      lines.push('<table>');
      for (let i = 0; i < languages.length; i += 2) {
        lines.push('<tr>');
        for (let j = i; j < Math.min(i + 2, languages.length); j++) {
          const lang = languages[j];
          const encodedName = encodeURIComponent(lang.name);
          lines.push(`<td align="center"><img src="https://img.shields.io/badge/${encodedName}-${lang.percent}%25-purple?style=for-the-badge&logo=${lang.name.toLowerCase()}&logoColor=white" alt="${lang.name}"/></td>`);
        }
        lines.push('</tr>');
      }
      lines.push('</table>');
      lines.push('</div>');
      lines.push('');
    }

    // Active Repos
    if (stats.activeRepos && stats.activeRepos.length > 0) {
      lines.push('### 📂 Active Repositories');
      lines.push('<div align="center">');
      const repoBadges = stats.activeRepos.slice(0, 5).map(r => {
        const encoded = encodeURIComponent(r);
        return `<img src="https://img.shields.io/badge/${encoded}-active-brightgreen?style=flat-square&logo=github&logoColor=white" alt="${r}"/>`;
      });
      lines.push(repoBadges.join(' '));
      lines.push('</div>');
      lines.push('');
    }

    lines.push('</td>');
    lines.push('<td width="50%" align="center">');
    lines.push('');

    // Right column: Recent Activity
    lines.push('### 📋 Recent Activity');
    lines.push('');
    lines.push('<div align="left">');
    if (stats.commitMessages.length > 0) {
      const emojis = ['🎯', '🔧', '✨', '🐛', '📝', '🚀', '💡', '🔨'];
      stats.commitMessages.slice(0, 5).forEach((c, index) => {
        const firstLine = c.message.split('\n')[0];
        const shortMessage = firstLine.length > 40 ? firstLine.substring(0, 40) + '...' : firstLine;
        const emoji = emojis[index] || '📝';
        lines.push(`<p>${emoji} <code>[${c.repo}]</code> ${shortMessage}</p>`);
      });
    } else {
      lines.push('<p><em>No recent commits</em></p>');
    }
    lines.push('</div>');
    lines.push('');

    // Repository Stats
    lines.push('### 📈 Repository Stats');
    lines.push('');
    lines.push('<div align="center">');
    lines.push('<table>');
    lines.push('<tr>');
    if (repoStats) {
      lines.push('<td align="center">');
      lines.push(`<img src="https://img.shields.io/badge/⭐%20Stars-${repoStats.totalStars}-yellow?style=for-the-badge" alt="Stars"/>`);
      lines.push('</td>');
      lines.push('<td align="center">');
      lines.push(`<img src="https://img.shields.io/badge/🍴%20Forks-${repoStats.totalForks}-blue?style=for-the-badge" alt="Forks"/>`);
      lines.push('</td>');
      lines.push('<td align="center">');
      lines.push(`<img src="https://img.shields.io/badge/📦%20Repos-${repoStats.totalRepos}-grey?style=for-the-badge" alt="Repos"/>`);
      lines.push('</td>');
    }
    lines.push('</tr>');
    lines.push('</table>');
    lines.push('</div>');
    lines.push('');
    lines.push('</td>');
    lines.push('</tr>');
    lines.push('</table>');
    lines.push('');

    const now = new Date().toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    lines.push('<div align="center">');
    lines.push(`  <sub>🤖 <em>Last updated: ${now}</em></sub>`);
    lines.push('</div>');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate the Tech Arsenal section dynamically from actual repo languages.
   * Merges detected languages with a curated list of known frameworks/tools.
   */
  static generateTechArsenalSection(languageBytes) {
    const lines = [];

    // Categorize detected languages
    const programmingLangs = [];
    const markupLangs = [];
    const otherLangs = [];

    const PROGRAMMING = ['JavaScript', 'TypeScript', 'Rust', 'Python', 'Go', 'Ruby', 'PHP', 'Java', 'C', 'C++', 'C#', 'Swift', 'Kotlin', 'Dart', 'Shell', 'Lua', 'Zig'];
    const MARKUP = ['HTML', 'CSS', 'SCSS', 'Vue'];

    // Sort by bytes descending
    const sorted = Object.entries(languageBytes).sort((a, b) => b[1] - a[1]);

    for (const [lang] of sorted) {
      if (PROGRAMMING.includes(lang)) programmingLangs.push(lang);
      else if (MARKUP.includes(lang)) markupLangs.push(lang);
      else otherLangs.push(lang);
    }

    lines.push('');
    lines.push('<div align="center">');
    lines.push('');

    // Programming Languages
    if (programmingLangs.length > 0) {
      lines.push('### 💻 Programming Languages');
      for (const lang of programmingLangs) {
        const badge = LANGUAGE_BADGE_MAP[lang];
        if (badge) {
          const encoded = encodeURIComponent(lang);
          lines.push(`<img src="https://img.shields.io/badge/${encoded}-${badge.color}?style=for-the-badge&logo=${badge.logo}&logoColor=${badge.logoColor}" alt="${lang}"/>`);
        }
      }
      lines.push('');
    }

    // Frontend / Markup
    if (markupLangs.length > 0) {
      lines.push('### 🌐 Frontend');
      for (const lang of markupLangs) {
        const badge = LANGUAGE_BADGE_MAP[lang];
        if (badge) {
          const encoded = encodeURIComponent(lang);
          lines.push(`<img src="https://img.shields.io/badge/${encoded}-${badge.color}?style=for-the-badge&logo=${badge.logo}&logoColor=${badge.logoColor}" alt="${lang}"/>`);
        }
      }
      lines.push('');
    }

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
    this.dryRun = options.dryRun || process.env.DRY_RUN === 'true';
    this.skipHealthCheck = options.skipHealthCheck || process.env.SKIP_HEALTH_CHECK === 'true';
    this.collector = new GitHubDataCollector(this.octokit, this.owner);
  }

  async updateReadme() {
    try {
      console.log(`Starting README update for user: ${this.owner}`);
      if (this.dryRun) console.log('🔍 DRY RUN MODE – no files will be written');

      // 1. Collect data: GraphQL for repos/languages, REST for events (parallel)
      const [{ repos, languageBytes }, events] = await Promise.all([
        this.collector.fetchRepoDataGraphQL(),
        this.collector.fetchUserEvents(),
      ]);

      // 2. Process data
      const weeklyStats = StatsAggregator.aggregateWeeklyStats(events);
      const languages = StatsAggregator.calculateLanguageRatio(languageBytes);
      const repoStats = StatsAggregator.aggregateRepoStats(repos);

      console.log('\n--- Aggregated Data ---');
      console.log(`Commits: ${weeklyStats.commits}, PRs: ${weeklyStats.pullRequests}, Issues: ${weeklyStats.issues}`);
      console.log(`Active repos: ${weeklyStats.activeRepos.join(', ') || '(none)'}`);
      console.log(`Languages: ${languages.map(l => `${l.name}(${l.percent}%)`).join(', ') || '(none)'}`);
      console.log(`Stars: ${repoStats.totalStars}, Forks: ${repoStats.totalForks}, Repos: ${repoStats.totalRepos}`);

      // 3. Read current README
      const readmePath = path.join(__dirname, '..', 'README.md');
      const readmeContent = fs.readFileSync(readmePath, 'utf8');

      // 4. Render and replace Weekly Activity section
      let updatedContent = readmeContent;
      const activitySection = ReadmeRenderer.generateActivitySection(weeklyStats, languages, repoStats);
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

      // 6. Generate and display diff
      const stripTimestamp = (s) => s.replace(/Last updated:.*<\/em>/g, '');
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
  ReadmeRenderer,
  ReadmeWriter,
  ReadmeUpdater,
  DiffReporter,
  HealthChecker,
  README_EXTERNAL_SERVICES,
  LANGUAGE_BADGE_MAP,
  MARKER_ACTIVITY_START,
  MARKER_ACTIVITY_END,
  MARKER_TECH_START,
  MARKER_TECH_END,
};
