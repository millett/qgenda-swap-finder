// @ts-check
const { defineConfig } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function findArm64Chromium() {
  const home = process.env.HOME;
  if (!home) return null;
  const cacheDir = path.join(home, 'Library', 'Caches', 'ms-playwright');
  if (!fs.existsSync(cacheDir)) return null;

  const entries = fs.readdirSync(cacheDir).filter(name => name.startsWith('chromium-')).sort().reverse();
  for (const entry of entries) {
    const candidate = path.join(
      cacheDir,
      entry,
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing'
    );
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || findArm64Chromium();
const launchOptions = chromiumExecutable ? { executablePath: chromiumExecutable } : {};

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30 * 1000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
