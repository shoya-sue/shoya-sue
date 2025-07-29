const https = require('https');
const http = require('http');

// List of all dynamic objects in README
const dynamicObjects = [
  {
    name: 'Header Capsule Render',
    url: 'https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=180&section=header&text=shoya-sue',
    type: 'svg'
  },
  {
    name: 'Typing SVG',
    url: 'https://readme-typing-svg.herokuapp.com?font=JetBrains+Mono&size=28&duration=3000&pause=1000&color=58A6FF&center=true&vCenter=true&width=500&lines=Full+Stack+Developer+🚀',
    type: 'svg'
  },
  {
    name: 'Animated GIF',
    url: 'https://user-images.githubusercontent.com/74038190/212284100-561aa473-3905-4a80-b561-0d28506553ee.gif',
    type: 'gif'
  },
  {
    name: 'Profile Avatar',
    url: 'https://github.com/shoya-sue.png',
    type: 'png'
  },
  {
    name: 'GitHub Stats',
    url: 'https://github-stats-alpha.vercel.app/api?username=shoya-sue&show_icons=true&theme=tokyonight',
    type: 'svg'
  },
  {
    name: 'Streak Stats',
    url: 'https://github-readme-streak-stats.herokuapp.com/?user=shoya-sue&theme=tokyonight',
    type: 'svg'
  },
  {
    name: 'Activity Graph',
    url: 'https://github-readme-activity-graph.vercel.app/graph?username=shoya-sue&theme=tokyo-night',
    type: 'svg'
  },
  {
    name: 'GitHub Trophies',
    url: 'https://github-trophies.vercel.app/?username=shoya-sue&theme=tokyonight',
    type: 'svg'
  },
  {
    name: 'Footer Capsule Render',
    url: 'https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=6,11,20&height=150&section=footer',
    type: 'svg'
  },
  {
    name: 'Profile View Counter',
    url: 'https://komarev.com/ghpvc/?username=shoya-sue&style=for-the-badge&color=blue',
    type: 'svg'
  }
];

// Also check shields.io badges from Tech Stack
const techStackBadges = [
  'https://img.shields.io/badge/Focus-Full%20Stack%20Development-blue?style=for-the-badge',
  'https://img.shields.io/badge/Status-Always%20Learning-green?style=for-the-badge',
  'https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white',
  'https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white',
  'https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black'
];

// Check if a URL is accessible
async function checkUrl(url) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const options = {
      method: 'HEAD',
      timeout: 10000
    };

    const req = protocol.request(url, options, (res) => {
      resolve({
        url,
        status: res.statusCode,
        success: res.statusCode >= 200 && res.statusCode < 400
      });
    });

    req.on('error', (error) => {
      resolve({
        url,
        status: 0,
        success: false,
        error: error.message
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        url,
        status: 0,
        success: false,
        error: 'Timeout'
      });
    });

    req.end();
  });
}

// Run health check
async function runHealthCheck() {
  console.log('🏥 Running README Health Check...\n');
  
  const results = {
    passed: 0,
    failed: 0,
    errors: []
  };

  // Check dynamic objects
  console.log('📊 Checking Dynamic Objects:');
  for (const obj of dynamicObjects) {
    process.stdout.write(`  - ${obj.name}... `);
    const result = await checkUrl(obj.url);
    
    if (result.success) {
      console.log('✅ OK');
      results.passed++;
    } else {
      console.log(`❌ FAILED (${result.error || `Status: ${result.status}`})`);
      results.failed++;
      results.errors.push({
        name: obj.name,
        url: obj.url,
        error: result.error || `HTTP ${result.status}`
      });
    }
  }

  // Check some tech stack badges
  console.log('\n🎯 Checking Sample Badges:');
  for (let i = 0; i < Math.min(5, techStackBadges.length); i++) {
    const url = techStackBadges[i];
    process.stdout.write(`  - Badge ${i + 1}... `);
    const result = await checkUrl(url);
    
    if (result.success) {
      console.log('✅ OK');
      results.passed++;
    } else {
      console.log(`❌ FAILED (${result.error || `Status: ${result.status}`})`);
      results.failed++;
    }
  }

  // Summary
  console.log('\n📋 Health Check Summary:');
  console.log(`  ✅ Passed: ${results.passed}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  
  if (results.errors.length > 0) {
    console.log('\n❌ Failed Services:');
    results.errors.forEach(err => {
      console.log(`  - ${err.name}: ${err.error}`);
      console.log(`    URL: ${err.url}`);
    });
  }

  // Return exit code
  return results.failed === 0 ? 0 : 1;
}

// Export for testing
module.exports = { checkUrl, dynamicObjects, runHealthCheck };

// Run if called directly
if (require.main === module) {
  runHealthCheck().then(exitCode => {
    process.exit(exitCode);
  });
}