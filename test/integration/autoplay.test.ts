/**
 * v0.12 — CI smoke test for the audio-alert pipeline
 *
 * Launches a real VS Code instance headlessly via `@vscode/test-electron`,
 * loads the extension from source, focuses the Claudelike Bar sidebar, and
 * fires a play through the private `claudeDashboard.__firePlayForTest`
 * command. Fails on anything the audio path could break on:
 *
 *   - Extension fails to activate
 *   - Sidebar webview doesn't resolve
 *   - CSP rejects the media URL
 *   - `postPlay()` URI resolution throws
 *   - `new Audio(url)` constructor throws (malformed URL)
 *   - Webview message plumbing stops delivering `play` messages
 *
 * What this test explicitly does NOT verify: Chromium's real autoplay
 * policy. Headless VS Code in CI has no user gesture, so Chromium blocks
 * unmuted autoplay by default — production users don't hit that because
 * their clicks count as the required gesture. We pass
 * `--autoplay-policy=no-user-gesture-required` so CI can exercise the
 * code path without fighting the gesture requirement. If you want to
 * verify real-world autoplay behavior, install the VSIX and click around.
 *
 * Run via `npm run test:integration`. The vitest unit suite skips this
 * file — it's in test/integration/ and vitest.config.ts only picks up
 * test/*.test.ts (one level deep).
 */
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // __dirname at runtime is test/integration/out/ (tsc outDir), so the repo
  // root is three levels up — not two. Getting this wrong silently points
  // VS Code at an empty "extension" path, so the extension never activates
  // and claudeDashboard.mainView.focus doesn't exist at runtime.
  const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
  const extensionTestsPath = path.resolve(__dirname, './autoplay.runner');

  // Launch a VS Code instance, load the dev extension, and run the test
  // runner file (which executes inside the extension host).
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [
      // Setup wizard blocks activation on untrusted workspaces otherwise.
      '--disable-workspace-trust',
      // Other extensions could add noise to the extension-host log.
      '--disable-extensions',
      // Chromium flag (VS Code passes it through). Headless CI has no user
      // gesture; real users have many. Verifying the code path, not the
      // policy — see top-of-file comment.
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
}

main().catch((err) => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
