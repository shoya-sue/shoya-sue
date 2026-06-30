jest.mock('fs');
const fs = require('fs');
const { GitHubDataCollector, ReadmeUpdater } = require('./update-readme');

// Keep test output clean – the orchestrator and collectors log verbosely.
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

// ============================================================
// GitHubDataCollector (mocked Octokit)
// ============================================================
describe('GitHubDataCollector', () => {
  it('fetchRepoDataGraphQL aggregates repos and language bytes', async () => {
    const octokit = {
      graphql: jest.fn().mockResolvedValue({
        user: {
          repositories: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              { name: 'a', stargazerCount: 2, forkCount: 1, languages: { edges: [{ size: 100, node: { name: 'Rust' } }] } },
              { name: 'b', stargazerCount: 0, forkCount: 0, languages: { edges: [{ size: 50, node: { name: 'Rust' } }, { size: 30, node: { name: 'Go' } }] } },
            ],
          },
        },
      }),
    };
    const collector = new GitHubDataCollector(octokit, 'tester');
    const { repos, languageBytes } = await collector.fetchRepoDataGraphQL();

    expect(repos).toHaveLength(2);
    expect(repos[0]).toEqual({ name: 'a', stargazers_count: 2, forks_count: 1 });
    expect(languageBytes.Rust).toBe(150);
    expect(languageBytes.Go).toBe(30);
  });

  it('fetchRepoDataGraphQL falls back to REST on GraphQL failure', async () => {
    const octokit = {
      graphql: jest.fn().mockRejectedValue(new Error('GraphQL boom')),
      rest: {
        repos: {
          listForUser: jest.fn()
            .mockResolvedValueOnce({ data: [{ name: 'x', owner: { login: 'tester' }, stargazers_count: 1, forks_count: 0 }] })
            .mockResolvedValueOnce({ data: [] }),
          listLanguages: jest.fn().mockResolvedValue({ data: { Python: 500 } }),
        },
        rateLimit: { get: jest.fn().mockResolvedValue({ data: { resources: { core: { remaining: 100 } } } }) },
      },
    };
    const collector = new GitHubDataCollector(octokit, 'tester');
    const { repos, languageBytes } = await collector.fetchRepoDataGraphQL();

    expect(repos).toHaveLength(1);
    expect(languageBytes.Python).toBe(500);
  });

  it('fetchUserEvents collects pages and stops on the first empty page', async () => {
    const octokit = {
      rest: {
        activity: {
          listPublicEventsForUser: jest.fn()
            .mockResolvedValueOnce({ data: [{ id: 1 }, { id: 2 }] })
            .mockResolvedValueOnce({ data: [] }),
        },
      },
    };
    const collector = new GitHubDataCollector(octokit, 'tester');
    const events = await collector.fetchUserEvents();
    expect(events).toHaveLength(2);
  });

  it('fetchContributionStats maps the GraphQL contribution collection', async () => {
    const octokit = {
      graphql: jest.fn().mockResolvedValue({
        user: {
          contributionsCollection: {
            totalCommitContributions: 12,
            totalPullRequestContributions: 3,
            totalIssueContributions: 1,
            totalPullRequestReviewContributions: 4,
            commitContributionsByRepository: [
              { repository: { nameWithOwner: 'tester/proj' }, contributions: { totalCount: 9 } },
            ],
          },
        },
      }),
    };
    const collector = new GitHubDataCollector(octokit, 'tester');
    const stats = await collector.fetchContributionStats();

    expect(stats.commits).toBe(12);
    expect(stats.pullRequests).toBe(3);
    expect(stats.reviews).toBe(4);
    expect(stats.activeRepos[0]).toEqual({ name: 'proj', fullName: 'tester/proj', commits: 9 });
  });

  it('fetchContributionStats returns null when the user is missing', async () => {
    const octokit = { graphql: jest.fn().mockResolvedValue({ user: null }) };
    const collector = new GitHubDataCollector(octokit, 'ghost');
    expect(await collector.fetchContributionStats()).toBeNull();
  });

  it('fetchContributionStats returns null on a GraphQL error', async () => {
    const octokit = { graphql: jest.fn().mockRejectedValue(new Error('rate limited')) };
    const collector = new GitHubDataCollector(octokit, 'tester');
    expect(await collector.fetchContributionStats()).toBeNull();
  });

  it('fetchRepoDataGraphQL falls back to REST when the GraphQL user is null', async () => {
    const octokit = {
      graphql: jest.fn().mockResolvedValue({ user: null }),
      rest: {
        repos: {
          listForUser: jest.fn()
            .mockResolvedValueOnce({ data: [{ name: 'y', owner: { login: 'tester' }, stargazers_count: 0, forks_count: 0 }] })
            .mockResolvedValueOnce({ data: [] }),
          listLanguages: jest.fn().mockResolvedValue({ data: { Go: 200 } }),
        },
        rateLimit: { get: jest.fn().mockResolvedValue({ data: { resources: { core: { remaining: 50 } } } }) },
      },
    };
    const collector = new GitHubDataCollector(octokit, 'tester');
    const { repos, languageBytes } = await collector.fetchRepoDataGraphQL();
    expect(repos).toHaveLength(1);
    expect(languageBytes.Go).toBe(200);
  });
});

// ============================================================
// ReadmeUpdater.updateReadme orchestration (mocked fs + collector)
// ============================================================
describe('ReadmeUpdater.updateReadme', () => {
  const README_TEMPLATE = [
    '# Title',
    '',
    '<!-- TECH_ARSENAL_START -->',
    'old tech',
    '<!-- TECH_ARSENAL_END -->',
    '',
    '<!-- WEEKLY_ACTIVITY_START -->',
    'old activity',
    '<!-- WEEKLY_ACTIVITY_END -->',
  ].join('\n');

  function makeUpdater(opts = {}) {
    const updater = new ReadmeUpdater({ skipHealthCheck: true, ...opts });
    updater.owner = 'tester';
    updater.collector = {
      fetchRepoDataGraphQL: async () => ({
        repos: [{ name: 'r1', stargazers_count: 3, forks_count: 1 }],
        languageBytes: { TypeScript: 7000, JavaScript: 3000 },
      }),
      fetchUserEvents: async () => [],
      fetchContributionStats: async () => ({ commits: 10, pullRequests: 2, issues: 0, reviews: 0, activeRepos: [] }),
    };
    return updater;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    fs.readFileSync.mockReturnValue(README_TEMPLATE);
    fs.writeFileSync.mockImplementation(() => {});
    fs.mkdirSync.mockImplementation(() => {});
  });

  it('writes dark + light SVG cards and rewrites both markers', async () => {
    const updater = makeUpdater();
    const result = await updater.updateReadme();

    expect(result.updated).toBe(true);
    expect(fs.mkdirSync).toHaveBeenCalled();

    const writeTargets = fs.writeFileSync.mock.calls.map((c) => String(c[0]));
    expect(writeTargets.some((p) => p.endsWith('github-stats-dark.svg'))).toBe(true);
    expect(writeTargets.some((p) => p.endsWith('github-stats-light.svg'))).toBe(true);
    expect(writeTargets.some((p) => p.endsWith('README.md'))).toBe(true);

    const readmeWrite = fs.writeFileSync.mock.calls.find((c) => String(c[0]).endsWith('README.md'));
    const written = readmeWrite[1];
    expect(written).toContain('<picture>');
    expect(written).toContain('./assets/github-stats-dark.svg');
    expect(written).toContain('style=flat');
    expect(written).not.toContain('old activity');
    expect(written).not.toContain('old tech');
  });

  it('does not write any files in dry-run mode', async () => {
    const updater = makeUpdater({ dryRun: true });
    const result = await updater.updateReadme();

    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
  });

  it('returns an error object when README cannot be read', async () => {
    fs.readFileSync.mockImplementation(() => {
      throw new Error('README missing');
    });
    const updater = makeUpdater();
    const result = await updater.updateReadme();

    expect(result.updated).toBe(false);
    expect(result.error).toContain('README missing');
  });

  it('throws on construction for an invalid owner name', () => {
    const prev = process.env.GITHUB_OWNER;
    process.env.GITHUB_OWNER = 'bad name!';
    try {
      expect(() => new ReadmeUpdater()).toThrow('Invalid GitHub owner');
    } finally {
      if (prev === undefined) delete process.env.GITHUB_OWNER;
      else process.env.GITHUB_OWNER = prev;
    }
  });
});
