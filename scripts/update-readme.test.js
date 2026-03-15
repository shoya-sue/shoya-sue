const {
  StatsAggregator,
  ReadmeRenderer,
  ReadmeWriter,
  DiffReporter,
  HealthChecker,
  LANGUAGE_BADGE_MAP,
  MARKER_ACTIVITY_START,
  MARKER_ACTIVITY_END,
  MARKER_TECH_START,
  MARKER_TECH_END,
} = require('./update-readme');

// ============================================================
// StatsAggregator tests
// ============================================================
describe('StatsAggregator', () => {
  describe('aggregateWeeklyStats', () => {
    it('should count commits from PushEvents correctly', () => {
      const now = new Date();
      const events = [
        {
          type: 'PushEvent',
          created_at: now.toISOString(),
          repo: { name: 'user/repo-a' },
          actor: { login: 'user' },
          payload: {
            size: 3,
            commits: [
              { message: 'feat: add feature A' },
              { message: 'fix: bug B' },
              { message: 'docs: update README' },
            ],
          },
        },
        {
          type: 'PushEvent',
          created_at: now.toISOString(),
          repo: { name: 'user/repo-b' },
          actor: { login: 'user' },
          payload: {
            size: 1,
            commits: [{ message: 'chore: cleanup' }],
          },
        },
      ];

      const stats = StatsAggregator.aggregateWeeklyStats(events);

      expect(stats.commits).toBe(4);
      expect(stats.commitMessages).toHaveLength(4);
      expect(stats.commitMessages[0].repo).toBe('repo-a');
      expect(stats.commitMessages[3].repo).toBe('repo-b');
    });

    it('should count PRs and Issues separately', () => {
      const now = new Date();
      const events = [
        { type: 'PullRequestEvent', created_at: now.toISOString(), repo: { name: 'user/repo' }, actor: { login: 'user' }, payload: {} },
        { type: 'PullRequestEvent', created_at: now.toISOString(), repo: { name: 'user/repo' }, actor: { login: 'user' }, payload: {} },
        { type: 'IssuesEvent', created_at: now.toISOString(), repo: { name: 'user/repo' }, actor: { login: 'user' }, payload: {} },
      ];

      const stats = StatsAggregator.aggregateWeeklyStats(events);
      expect(stats.pullRequests).toBe(2);
      expect(stats.issues).toBe(1);
    });

    it('should extract unique active repositories', () => {
      const now = new Date();
      const events = [
        { type: 'PushEvent', created_at: now.toISOString(), repo: { name: 'user/repo-a' }, actor: { login: 'user' }, payload: { size: 1, commits: [{ message: 'x' }] } },
        { type: 'PushEvent', created_at: now.toISOString(), repo: { name: 'user/repo-a' }, actor: { login: 'user' }, payload: { size: 1, commits: [{ message: 'y' }] } },
        { type: 'IssuesEvent', created_at: now.toISOString(), repo: { name: 'user/repo-b' }, actor: { login: 'user' }, payload: {} },
      ];

      const stats = StatsAggregator.aggregateWeeklyStats(events);
      expect(stats.activeRepos).toEqual(['repo-a', 'repo-b']);
    });

    it('should exclude events older than 7 days', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);
      const events = [
        { type: 'PushEvent', created_at: oldDate.toISOString(), repo: { name: 'user/old-repo' }, actor: { login: 'user' }, payload: { size: 5, commits: [] } },
      ];

      const stats = StatsAggregator.aggregateWeeklyStats(events);
      expect(stats.commits).toBe(0);
      expect(stats.activeRepos).toEqual([]);
    });

    it('should limit commit messages to 8', () => {
      const now = new Date();
      const commits = Array.from({ length: 12 }, (_, i) => ({ message: `commit ${i}` }));
      const events = [
        { type: 'PushEvent', created_at: now.toISOString(), repo: { name: 'user/repo' }, actor: { login: 'user' }, payload: { size: 12, commits } },
      ];

      const stats = StatsAggregator.aggregateWeeklyStats(events);
      expect(stats.commitMessages).toHaveLength(8);
    });
  });

  describe('calculateLanguageRatio', () => {
    it('should return top languages with percentages', () => {
      const bytes = { JavaScript: 5000, TypeScript: 3000, HTML: 1500, CSS: 500 };
      const result = StatsAggregator.calculateLanguageRatio(bytes, 3);

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('JavaScript');
      expect(result[0].percent).toBe(50);
      expect(result[1].name).toBe('TypeScript');
      expect(result[1].percent).toBe(30);
    });

    it('should return empty array for empty input', () => {
      expect(StatsAggregator.calculateLanguageRatio({})).toEqual([]);
    });

    it('should handle single language', () => {
      const result = StatsAggregator.calculateLanguageRatio({ Rust: 10000 });
      expect(result).toHaveLength(1);
      expect(result[0].percent).toBe(100);
    });
  });

  describe('aggregateRepoStats', () => {
    it('should sum stars and forks across repos', () => {
      const repos = [
        { stargazers_count: 10, forks_count: 3 },
        { stargazers_count: 5, forks_count: 2 },
        { stargazers_count: 0, forks_count: 0 },
      ];

      const result = StatsAggregator.aggregateRepoStats(repos);
      expect(result.totalStars).toBe(15);
      expect(result.totalForks).toBe(5);
      expect(result.totalRepos).toBe(3);
    });

    it('should handle empty repos list', () => {
      const result = StatsAggregator.aggregateRepoStats([]);
      expect(result.totalStars).toBe(0);
      expect(result.totalForks).toBe(0);
      expect(result.totalRepos).toBe(0);
    });
  });
});

// ============================================================
// ReadmeWriter tests
// ============================================================
describe('ReadmeWriter', () => {
  describe('parseMarkers', () => {
    it('should find activity markers', () => {
      const content = `Hello\n${MARKER_ACTIVITY_START}\nold\n${MARKER_ACTIVITY_END}\nWorld`;
      const markers = ReadmeWriter.parseMarkers(content, MARKER_ACTIVITY_START, MARKER_ACTIVITY_END);

      expect(markers).not.toBeNull();
      expect(markers.startIndex).toBe(content.indexOf(MARKER_ACTIVITY_START));
    });

    it('should find tech arsenal markers', () => {
      const content = `Hello\n${MARKER_TECH_START}\nold\n${MARKER_TECH_END}\nWorld`;
      const markers = ReadmeWriter.parseMarkers(content, MARKER_TECH_START, MARKER_TECH_END);
      expect(markers).not.toBeNull();
    });

    it('should return null if start marker is missing', () => {
      expect(ReadmeWriter.parseMarkers(`Hello\n${MARKER_ACTIVITY_END}`, MARKER_ACTIVITY_START, MARKER_ACTIVITY_END)).toBeNull();
    });

    it('should return null if end marker is missing', () => {
      expect(ReadmeWriter.parseMarkers(`Hello\n${MARKER_ACTIVITY_START}`, MARKER_ACTIVITY_START, MARKER_ACTIVITY_END)).toBeNull();
    });

    it('should return null if markers are in wrong order', () => {
      expect(ReadmeWriter.parseMarkers(`${MARKER_ACTIVITY_END}\n${MARKER_ACTIVITY_START}`, MARKER_ACTIVITY_START, MARKER_ACTIVITY_END)).toBeNull();
    });
  });

  describe('replaceSection', () => {
    it('should replace content between markers', () => {
      const original = `# Title\n\n${MARKER_ACTIVITY_START}\nold content\n${MARKER_ACTIVITY_END}\n\n## Footer`;
      const result = ReadmeWriter.replaceSection(original, 'new content', MARKER_ACTIVITY_START, MARKER_ACTIVITY_END);

      expect(result).toContain(MARKER_ACTIVITY_START);
      expect(result).toContain('new content');
      expect(result).toContain(MARKER_ACTIVITY_END);
      expect(result).toContain('# Title');
      expect(result).toContain('## Footer');
      expect(result).not.toContain('old content');
    });

    it('should throw if markers are missing', () => {
      expect(() => {
        ReadmeWriter.replaceSection('no markers here', 'content', MARKER_ACTIVITY_START, MARKER_ACTIVITY_END);
      }).toThrow('Markers not found');
    });

    it('should preserve content outside markers exactly', () => {
      const before = '# Header\nSome text\n\n';
      const after = '\n\n## Footer\nMore text';
      const original = `${before}${MARKER_ACTIVITY_START}\nold\n${MARKER_ACTIVITY_END}${after}`;

      const result = ReadmeWriter.replaceSection(original, 'new', MARKER_ACTIVITY_START, MARKER_ACTIVITY_END);
      expect(result.startsWith(before)).toBe(true);
      expect(result.endsWith(after)).toBe(true);
    });

    it('should work with tech arsenal markers independently', () => {
      const content = `A\n${MARKER_TECH_START}\nold tech\n${MARKER_TECH_END}\nB\n${MARKER_ACTIVITY_START}\nold activity\n${MARKER_ACTIVITY_END}\nC`;

      const result1 = ReadmeWriter.replaceSection(content, 'new tech', MARKER_TECH_START, MARKER_TECH_END);
      expect(result1).toContain('new tech');
      expect(result1).toContain('old activity'); // untouched

      const result2 = ReadmeWriter.replaceSection(result1, 'new activity', MARKER_ACTIVITY_START, MARKER_ACTIVITY_END);
      expect(result2).toContain('new tech');
      expect(result2).toContain('new activity');
    });
  });

  describe('hasMarkers', () => {
    it('should return true when markers exist', () => {
      const content = `${MARKER_TECH_START}\ncontent\n${MARKER_TECH_END}`;
      expect(ReadmeWriter.hasMarkers(content, MARKER_TECH_START, MARKER_TECH_END)).toBe(true);
    });

    it('should return false when markers are missing', () => {
      expect(ReadmeWriter.hasMarkers('no markers', MARKER_TECH_START, MARKER_TECH_END)).toBe(false);
    });
  });
});

// ============================================================
// ReadmeRenderer tests
// ============================================================
describe('ReadmeRenderer', () => {
  describe('generateActivitySection', () => {
    const makeStats = (overrides = {}) => ({
      commits: 12,
      commitMessages: [
        { message: 'feat: add new feature', repo: 'project-a' },
        { message: 'fix: resolve issue #42', repo: 'project-b' },
      ],
      pullRequests: 3,
      issues: 1,
      activeRepos: ['project-a', 'project-b'],
      weekStart: '2026/3/8',
      weekEnd: '2026/3/15',
      ...overrides,
    });

    it('should generate complete section with all data', () => {
      const languages = [
        { name: 'JavaScript', bytes: 5000, percent: 50 },
        { name: 'TypeScript', bytes: 3000, percent: 30 },
      ];
      const repoStats = { totalStars: 15, totalForks: 5, totalRepos: 8 };

      const section = ReadmeRenderer.generateActivitySection(makeStats(), languages, repoStats);

      expect(section).toContain('📊 Weekly Activity');
      expect(section).toContain('2026/3/8 - 2026/3/15');
      expect(section).toContain('Commits-12');
      expect(section).toContain('Pull%20Requests-3');
      expect(section).toContain('Issues-1');
      expect(section).toContain('JavaScript');
      expect(section).toContain('50%25');
      expect(section).toContain('[project-a]');
      expect(section).toContain('Stars-15');
      expect(section).toContain('Forks-5');
      expect(section).toContain('Repos-8');
      expect(section).toContain('Active Repositories');
    });

    it('should handle null stats gracefully', () => {
      const section = ReadmeRenderer.generateActivitySection(null, [], null);
      expect(section).toContain('No recent activity data available');
    });

    it('should hide PR and Issue badges when count is zero', () => {
      const section = ReadmeRenderer.generateActivitySection(
        makeStats({ pullRequests: 0, issues: 0 }),
        [],
        { totalStars: 0, totalForks: 0, totalRepos: 1 }
      );
      expect(section).not.toContain('Pull%20Requests');
      expect(section).not.toContain('Issues-');
    });

    it('should truncate long commit messages', () => {
      const section = ReadmeRenderer.generateActivitySection(
        makeStats({
          commitMessages: [{
            message: 'This is a very long commit message that should be truncated at some point because it exceeds the limit',
            repo: 'repo',
          }],
        }),
        [],
        { totalStars: 0, totalForks: 0, totalRepos: 1 }
      );
      expect(section).toContain('...');
    });
  });

  describe('generateTechArsenalSection', () => {
    it('should generate badges for known languages', () => {
      const bytes = { JavaScript: 5000, Rust: 3000, HTML: 1000 };
      const section = ReadmeRenderer.generateTechArsenalSection(bytes);

      expect(section).toContain('Programming Languages');
      expect(section).toContain('logo=javascript');
      expect(section).toContain('logo=rust');
      expect(section).toContain('Frontend');
      expect(section).toContain('logo=html5');
    });

    it('should skip languages without badge mapping', () => {
      const bytes = { JavaScript: 5000, 'UnknownLang': 1000 };
      const section = ReadmeRenderer.generateTechArsenalSection(bytes);

      expect(section).toContain('logo=javascript');
      expect(section).not.toContain('UnknownLang');
    });

    it('should handle empty language bytes', () => {
      const section = ReadmeRenderer.generateTechArsenalSection({});
      expect(section).toContain('<div align="center">');
      expect(section).not.toContain('Programming Languages');
    });

    it('should sort by byte count', () => {
      const bytes = { PHP: 100, TypeScript: 5000, Rust: 3000 };
      const section = ReadmeRenderer.generateTechArsenalSection(bytes);

      const tsIndex = section.indexOf('logo=typescript');
      const rustIndex = section.indexOf('logo=rust');
      const phpIndex = section.indexOf('logo=php');

      expect(tsIndex).toBeLessThan(rustIndex);
      expect(rustIndex).toBeLessThan(phpIndex);
    });
  });
});

// ============================================================
// DiffReporter tests
// ============================================================
describe('DiffReporter', () => {
  it('should detect no changes', () => {
    const result = DiffReporter.generateDiff('hello\nworld', 'hello\nworld');
    expect(result.hasChanges).toBe(false);
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
  });

  it('should detect modified lines', () => {
    const result = DiffReporter.generateDiff('line1\nold\nline3', 'line1\nnew\nline3');
    expect(result.hasChanges).toBe(true);
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    expect(result.diff).toContain('- L2: old');
    expect(result.diff).toContain('+ L2: new');
  });

  it('should detect added lines', () => {
    const result = DiffReporter.generateDiff('line1', 'line1\nline2');
    expect(result.additions).toBe(1);
    expect(result.diff).toContain('+ L2: line2');
  });

  it('should detect deleted lines', () => {
    const result = DiffReporter.generateDiff('line1\nline2', 'line1');
    expect(result.deletions).toBe(1);
    expect(result.diff).toContain('- L2: line2');
  });

  it('should truncate long lines in diff output', () => {
    const longLine = 'x'.repeat(200);
    const result = DiffReporter.generateDiff('short', longLine);
    // Truncated to 120 chars
    expect(result.diff.split('\n')[1].length).toBeLessThanOrEqual(130); // "+ L1: " prefix + 120
  });
});

// ============================================================
// HealthChecker tests
// ============================================================
describe('HealthChecker', () => {
  describe('checkUrl', () => {
    it('should return success for reachable URLs', async () => {
      // Use shields.io which should be reliable
      const result = await HealthChecker.checkUrl('https://img.shields.io/badge/test-test-blue', 5000);
      // Don't assert success since CI may not have network, just verify structure
      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('success');
    });

    it('should handle invalid URLs gracefully', async () => {
      const result = await HealthChecker.checkUrl('https://this-domain-does-not-exist-12345.invalid', 3000);
      expect(result.success).toBe(false);
    });
  });

  describe('runChecks', () => {
    it('should aggregate results correctly', async () => {
      const urls = [
        { name: 'Invalid', url: 'https://this-does-not-exist-12345.invalid' },
      ];
      const results = await HealthChecker.runChecks(urls);
      expect(results.failed).toBe(1);
      expect(results.errors).toHaveLength(1);
      expect(results.errors[0].name).toBe('Invalid');
    });
  });
});

// ============================================================
// LANGUAGE_BADGE_MAP tests
// ============================================================
describe('LANGUAGE_BADGE_MAP', () => {
  it('should have required fields for all entries', () => {
    for (const [lang, badge] of Object.entries(LANGUAGE_BADGE_MAP)) {
      expect(badge).toHaveProperty('color');
      expect(badge).toHaveProperty('logo');
      expect(badge).toHaveProperty('logoColor');
      expect(badge.color).toMatch(/^[A-Fa-f0-9]{6}$/);
    }
  });

  it('should include common languages', () => {
    const expected = ['JavaScript', 'TypeScript', 'Rust', 'Python', 'PHP', 'HTML', 'CSS'];
    for (const lang of expected) {
      expect(LANGUAGE_BADGE_MAP).toHaveProperty(lang);
    }
  });
});
