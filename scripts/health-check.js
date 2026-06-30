const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================================
// Health check for the minimal, self-hosted README design.
//
// Stat/activity cards are now self-hosted SVGs committed to assets/, so the
// only remaining third-party image dependency is shields.io (tech badges).
// We therefore verify:
//   1. the generated SVG assets exist locally and look like valid SVG
//   2. shields.io is reachable
// No GitHub username is hardcoded here.
// ============================================================

// Local self-hosted assets that the README references.
const localAssets = [
  'assets/github-stats-dark.svg',
  'assets/github-stats-light.svg',
];

// Remaining external image services used in the README.
const externalServices = [
  { name: 'Shields.io', url: 'https://img.shields.io/badge/test-test-blue' },
];

/**
 * Verify a local asset exists and looks like an SVG document.
 * @param {string} relativePath - path relative to the repo root
 * @returns {{ path: string, success: boolean, error?: string }}
 */
function checkAsset(relativePath) {
  const absolute = path.join(__dirname, '..', relativePath);
  try {
    const content = fs.readFileSync(absolute, 'utf8');
    if (!content.trim().startsWith('<svg')) {
      return { path: relativePath, success: false, error: 'Not an SVG document' };
    }
    return { path: relativePath, success: true };
  } catch (error) {
    return { path: relativePath, success: false, error: error.message };
  }
}

/**
 * Check if a URL is accessible via a HEAD request.
 * @param {string} url
 * @returns {Promise<{ url: string, status: number, success: boolean, error?: string }>}
 */
async function checkUrl(url) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const options = { method: 'HEAD', timeout: 10000 };

    const req = protocol.request(url, options, (res) => {
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
 * Run the README health check.
 * @returns {Promise<number>} exit code (0 = all healthy, 1 = failures)
 */
async function runHealthCheck() {
  console.log('🏥 Running README Health Check...\n');

  const results = { passed: 0, failed: 0, errors: [] };

  console.log('🖼️  Checking self-hosted SVG assets:');
  for (const asset of localAssets) {
    process.stdout.write(`  - ${asset}... `);
    const result = checkAsset(asset);
    if (result.success) {
      console.log('✅ OK');
      results.passed++;
    } else {
      console.log(`❌ FAILED (${result.error})`);
      results.failed++;
      results.errors.push({ name: asset, error: result.error });
    }
  }

  console.log('\n🌐 Checking external services:');
  for (const { name, url } of externalServices) {
    process.stdout.write(`  - ${name}... `);
    const result = await checkUrl(url);
    if (result.success) {
      console.log('✅ OK');
      results.passed++;
    } else {
      console.log(`❌ FAILED (${result.error || `Status: ${result.status}`})`);
      results.failed++;
      results.errors.push({ name, url, error: result.error || `HTTP ${result.status}` });
    }
  }

  console.log('\n📋 Health Check Summary:');
  console.log(`  ✅ Passed: ${results.passed}`);
  console.log(`  ❌ Failed: ${results.failed}`);

  if (results.errors.length > 0) {
    console.log('\n❌ Failed checks:');
    results.errors.forEach((err) => {
      console.log(`  - ${err.name}: ${err.error}`);
      if (err.url) console.log(`    URL: ${err.url}`);
    });
  }

  return results.failed === 0 ? 0 : 1;
}

module.exports = { checkUrl, checkAsset, localAssets, externalServices, runHealthCheck };

// Run if called directly
if (require.main === module) {
  runHealthCheck().then((exitCode) => {
    process.exit(exitCode);
  });
}
