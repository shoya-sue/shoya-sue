const ReadmeUpdater = require('./update-readme');
const fs = require('fs');
const path = require('path');

// Mock dependencies
jest.mock('@octokit/rest');
jest.mock('fs');

const { Octokit } = require('@octokit/rest');

describe('ReadmeUpdater', () => {
  let updater;
  let mockOctokit;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock Octokit instance
    mockOctokit = {
      rest: {
        repos: {
          listCommits: jest.fn(),
          get: jest.fn(),
          listLanguages: jest.fn()
        },
        issues: {
          listForRepo: jest.fn()
        }
      }
    };
    
    Octokit.mockImplementation(() => mockOctokit);
    
    // Create updater instance
    updater = new ReadmeUpdater();
  });

  describe('getWeeklyStats', () => {
    it('should fetch weekly stats successfully', async () => {
      // Mock API responses
      mockOctokit.rest.repos.listCommits.mockResolvedValue({
        data: [
          { commit: { message: 'Test commit 1', author: { date: '2025-07-28' } } },
          { commit: { message: 'Test commit 2', author: { date: '2025-07-27' } } }
        ]
      });

      mockOctokit.rest.repos.get.mockResolvedValue({
        data: {
          stargazers_count: 10,
          forks_count: 5
        }
      });

      mockOctokit.rest.repos.listLanguages.mockResolvedValue({
        data: {
          JavaScript: 1000,
          TypeScript: 500,
          HTML: 200
        }
      });

      mockOctokit.rest.issues.listForRepo.mockResolvedValue({
        data: [
          { pull_request: undefined },
          { pull_request: {} }
        ]
      });

      const stats = await updater.getWeeklyStats();

      expect(stats).toMatchObject({
        commits: 2,
        commitMessages: ['Test commit 1', 'Test commit 2'],
        totalStars: 10,
        totalForks: 5,
        languages: ['JavaScript', 'TypeScript', 'HTML'],
        issues: 1,
        pullRequests: 1
      });
    });

    it('should handle API errors gracefully', async () => {
      mockOctokit.rest.repos.listCommits.mockRejectedValue(new Error('API Error'));

      const stats = await updater.getWeeklyStats();

      expect(stats).toBeNull();
    });
  });

  describe('generateActivitySection', () => {
    it('should generate activity section with stats', () => {
      const stats = {
        commits: 5,
        commitMessages: ['Commit 1', 'Commit 2'],
        totalStars: 10,
        totalForks: 3,
        languages: ['JavaScript', 'HTML'],
        issues: 2,
        pullRequests: 1,
        weekStart: '2025/7/22',
        weekEnd: '2025/7/29'
      };

      const section = updater.generateActivitySection(stats);

      expect(section).toContain('📊 Weekly Activity');
      expect(section).toContain('2025/7/22 - 2025/7/29');
      expect(section).toContain('Commits-5');
      expect(section).toContain('Issues-2');
      expect(section).toContain('Pull%20Requests-1');
      expect(section).toContain('JavaScript');
      expect(section).toContain('HTML');
    });

    it('should handle null stats', () => {
      const section = updater.generateActivitySection(null);

      expect(section).toContain('No recent activity data available');
    });
  });

  describe('updateReadme', () => {
    it('should update README successfully', async () => {
      const mockReadmeContent = `# GitHub Profile

## 🛠️ Tech Arsenal

Some tech content here

---

## 🤝 Connect with Me

Contact info`;

      const mockStats = {
        commits: 3,
        commitMessages: ['New commit'],
        totalStars: 5,
        totalForks: 2,
        languages: ['JavaScript'],
        issues: 0,
        pullRequests: 0,
        weekStart: '2025/7/22',
        weekEnd: '2025/7/29'
      };

      fs.readFileSync.mockReturnValue(mockReadmeContent);
      fs.writeFileSync.mockImplementation(() => {});
      
      // Mock getWeeklyStats
      updater.getWeeklyStats = jest.fn().mockResolvedValue(mockStats);

      const result = await updater.updateReadme();

      expect(result).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalled();
      
      const writtenContent = fs.writeFileSync.mock.calls[0][1];
      expect(writtenContent).toContain('📊 Weekly Activity');
      expect(writtenContent).toContain('2025/7/22 - 2025/7/29');
      expect(writtenContent).toContain('Commits-3');
      expect(writtenContent).toContain('🤝 Connect with Me');
    });

    it('should handle file read errors', async () => {
      fs.readFileSync.mockImplementation(() => {
        throw new Error('File not found');
      });

      const result = await updater.updateReadme();

      expect(result).toBe(false);
    });
  });
});