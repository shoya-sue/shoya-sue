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
    if (!stats) {
      return `
<div align="center">
  <h2>📊 Weekly Activity</h2>
  <p><em>No recent activity data available</em></p>
</div>

`;
    }

    const activityContent = `
<div align="center">
  <h2>📊 Weekly Activity</h2>
  <p><code>${stats.weekStart} - ${stats.weekEnd}</code></p>
</div>

<table align="center" width="100%">
<tr>
<td width="50%" align="center">

### 🚀 This Week's Highlights

<div align="center">
<table>
<tr>
<td align="center">
<img src="https://img.shields.io/badge/Commits-${stats.commits}-blue?style=for-the-badge&logo=git&logoColor=white" alt="Commits"/>
</td>
</tr>
${stats.issues > 0 ? `<tr><td align="center"><img src="https://img.shields.io/badge/Issues-${stats.issues}-orange?style=for-the-badge&logo=github&logoColor=white" alt="Issues"/></td></tr>` : ''}
${stats.pullRequests > 0 ? `<tr><td align="center"><img src="https://img.shields.io/badge/Pull%20Requests-${stats.pullRequests}-green?style=for-the-badge&logo=github&logoColor=white" alt="PRs"/></td></tr>` : ''}
</table>
</div>

${stats.languages.length > 0 ? `
### 💻 Languages Used
<div align="center">
<table>
<tr>
${stats.languages.slice(0, 3).map(lang => `<td align="center"><img src="https://img.shields.io/badge/${lang}-★-purple?style=for-the-badge&logo=${lang.toLowerCase()}&logoColor=white" alt="${lang}"/></td>`).join('')}
</tr>
</table>
</div>
` : ''}

</td>
<td width="50%" align="center">

### 📋 Recent Activity

<div align="left">
${stats.commitMessages.length > 0 ? 
  stats.commitMessages.slice(0, 4).map((message, index) => {
    const firstLine = message.split('\n')[0];
    const shortMessage = firstLine.length > 45 ? firstLine.substring(0, 45) + '...' : firstLine;
    const emoji = ['🎯', '🔧', '✨', '🐛'][index] || '📝';
    return `<p>${emoji} <code>${shortMessage}</code></p>`;
  }).join('') 
  : '<p><em>No recent commits</em></p>'
}
</div>

### 📈 Repository Stats

<div align="center">
<table>
<tr>
<td align="center">
<img src="https://img.shields.io/badge/⭐%20Stars-${stats.totalStars}-yellow?style=for-the-badge" alt="Stars"/>
</td>
<td align="center">
<img src="https://img.shields.io/badge/🍴%20Forks-${stats.totalForks}-blue?style=for-the-badge" alt="Forks"/>
</td>
</tr>
</table>
</div>

</td>
</tr>
</table>

<div align="center">
  <sub>🤖 <em>Last updated: ${new Date().toLocaleDateString('ja-JP', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })}</em></sub>
</div>

---

`;

    return activityContent;
  }

  async updateReadme() {
    try {
      const stats = await this.getWeeklyStats();
      const readmePath = path.join(__dirname, '..', 'README.md');
      const readmeContent = fs.readFileSync(readmePath, 'utf8');
      
      // Find the Weekly Activity section and replace it, or Featured Projects if it doesn't exist
      const activitySection = this.generateActivitySection(stats);
      
      // Try to replace existing Weekly Activity section first
      let updatedContent = readmeContent.replace(
        /## 📊 \*\*Weekly Activity\*\* \([^)]+\)\n\n[\s\S]*?(?=\n## |$)/,
        activitySection
      );
      
      // If Weekly Activity section doesn't exist, replace Featured Projects
      if (updatedContent === readmeContent) {
        updatedContent = readmeContent.replace(
          /## 🌟 \*\*Featured Projects\*\*\n\nComing soon\.\.\. 🚀\n/,
          activitySection
        );
      }

      // Check if content actually changed
      if (updatedContent === readmeContent) {
        console.log('No changes made to README - pattern may not match');
        console.log('Looking for Weekly Activity section...');
        return false;
      }
      
      fs.writeFileSync(readmePath, updatedContent);
      console.log('README updated successfully!');
      console.log(`Updated ${updatedContent.length - readmeContent.length} characters`);
      
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