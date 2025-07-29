const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');

class ReadmeUpdater {
  constructor() {
    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN
    });
    this.owner = 'shoya-sue';
    this.repo = 'shoya-sue';
  }

  async getWeeklyStats() {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const since = oneWeekAgo.toISOString();

    try {
      // Get commits from the last week (increased per_page to get more commits)
      const { data: commits } = await this.octokit.rest.repos.listCommits({
        owner: this.owner,
        repo: this.repo,
        since: since,
        per_page: 100
      });

      // Get repository stats
      const { data: repoStats } = await this.octokit.rest.repos.get({
        owner: this.owner,
        repo: this.repo
      });

      // Get language stats
      const { data: languages } = await this.octokit.rest.repos.listLanguages({
        owner: this.owner,
        repo: this.repo
      });

      // Get recent issues and PRs
      const { data: issues } = await this.octokit.rest.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        since: since,
        state: 'all'
      });

      // Debug logging
      console.log(`Found ${commits.length} commits since ${since}`);
      console.log(`Commits:`, commits.map(c => ({
        message: c.commit.message.split('\n')[0],
        date: c.commit.author.date
      })));

      return {
        commits: commits.length,
        commitMessages: commits.map(c => c.commit.message),
        totalStars: repoStats.stargazers_count,
        totalForks: repoStats.forks_count,
        languages: Object.keys(languages).slice(0, 3), // Top 3 languages
        issues: issues.filter(i => !i.pull_request).length,
        pullRequests: issues.filter(i => i.pull_request).length,
        weekStart: oneWeekAgo.toLocaleDateString('ja-JP'),
        weekEnd: new Date().toLocaleDateString('ja-JP')
      };
    } catch (error) {
      console.error('Error fetching GitHub stats:', error);
      return null;
    }
  }

  generateActivitySection(stats) {
    if (!stats) return '## 📊 **Weekly Activity**\n\nNo recent activity data available.\n';

    let activityContent = `## 📊 **Weekly Activity** (${stats.weekStart} - ${stats.weekEnd})\n\n`;
    
    // Activity summary
    activityContent += `### 🚀 **This Week's Highlights**\n`;
    activityContent += `- 📝 **${stats.commits}** commits pushed\n`;
    
    if (stats.issues > 0) {
      activityContent += `- 🐛 **${stats.issues}** issues worked on\n`;
    }
    
    if (stats.pullRequests > 0) {
      activityContent += `- 🔄 **${stats.pullRequests}** pull requests\n`;
    }

    if (stats.languages.length > 0) {
      activityContent += `- 💻 **Languages used:** ${stats.languages.join(', ')}\n`;
    }

    // Recent commits (limit to 5)
    if (stats.commitMessages.length > 0) {
      activityContent += `\n### 📋 **Recent Commits**\n`;
      stats.commitMessages.slice(0, 5).forEach(message => {
        const firstLine = message.split('\n')[0];
        const shortMessage = firstLine.length > 60 ? firstLine.substring(0, 60) + '...' : firstLine;
        activityContent += `- ${shortMessage}\n`;
      });
    }

    // Repository stats
    activityContent += `\n### 📈 **Repository Stats**\n`;
    activityContent += `- ⭐ **${stats.totalStars}** stars\n`;
    activityContent += `- 🍴 **${stats.totalForks}** forks\n`;
    
    activityContent += `\n*Last updated: ${new Date().toLocaleDateString('ja-JP', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}*\n\n`;

    return activityContent;
  }

  async updateReadme() {
    try {
      const stats = await this.getWeeklyStats();
      const readmePath = path.join(__dirname, '..', 'README.md');
      const readmeContent = fs.readFileSync(readmePath, 'utf8');
      
      // Find the Featured Projects section and replace it
      const activitySection = this.generateActivitySection(stats);
      const updatedContent = readmeContent.replace(
        /## 🌟 \*\*Featured Projects\*\*\n\nComing soon\.\.\. 🚀\n/,
        activitySection
      );

      fs.writeFileSync(readmePath, updatedContent);
      console.log('README updated successfully!');
      
      return true;
    } catch (error) {
      console.error('Error updating README:', error);
      return false;
    }
  }
}

// Run the updater
if (require.main === module) {
  const updater = new ReadmeUpdater();
  updater.updateReadme().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = ReadmeUpdater;