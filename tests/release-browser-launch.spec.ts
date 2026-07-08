import { vi } from "vitest";

import {
  launchPlaywrightBrowser,
  resolvePlaywrightConnectionCandidates,
  resolvePlaywrightLaunchCandidates
} from "../apps/release/src/main.js";

describe("release browser launch", () => {
  it("resolves explicit browser attachment endpoints before local launch candidates", () => {
    const candidates = resolvePlaywrightConnectionCandidates({
      processEnv: {
        PLAYWRIGHT_WS_ENDPOINT: " ws://127.0.0.1:3000/playwright ",
        PLAYWRIGHT_CDP_URL: "http://127.0.0.1:9222",
        CHROME_REMOTE_DEBUGGING_URL: ""
      }
    });

    expect(candidates).toEqual([
      {
        label: "PLAYWRIGHT_WS_ENDPOINT",
        mode: "ws",
        endpoint: "ws://127.0.0.1:3000/playwright"
      },
      {
        label: "PLAYWRIGHT_CDP_URL",
        mode: "cdp",
        endpoint: "http://127.0.0.1:9222"
      }
    ]);
  });

  it("prefers explicit and detected executables before bundled chromium", () => {
    const candidates = resolvePlaywrightLaunchCandidates({
      platform: "win32",
      processEnv: {
        PLAYWRIGHT_EXECUTABLE_PATH: "D:\\Browsers\\Chrome\\chrome.exe",
        PROGRAMFILES: "C:\\Program Files",
        LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local"
      },
      pathExists(filePath) {
        return new Set([
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Users\\tester\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe"
        ]).has(filePath);
      }
    });

    expect(candidates).toEqual([
      {
        label: "PLAYWRIGHT_EXECUTABLE_PATH",
        options: {
          headless: true,
          executablePath: "D:\\Browsers\\Chrome\\chrome.exe"
        }
      },
      {
        label: "Google Chrome",
        options: {
          headless: true,
          executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        }
      },
      {
        label: "Microsoft Edge (Local AppData)",
        options: {
          headless: true,
          executablePath: "C:\\Users\\tester\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe"
        }
      },
      {
        label: "Playwright bundled Chromium",
        options: {
          headless: true
        }
      }
    ]);
  });

  it("prefers explicit browser attachment endpoints before launching a local executable", async () => {
    const browser = {
      newContext: vi.fn(),
      close: vi.fn()
    };
    const connectOverCDP = vi.fn().mockResolvedValueOnce(browser);
    const launch = vi.fn();

    const result = await launchPlaywrightBrowser({
      chromium: {
        connectOverCDP,
        launch
      }
    }, {
      processEnv: {
        PLAYWRIGHT_CDP_URL: "http://127.0.0.1:9222"
      },
      platform: "linux",
      pathExists() {
        return true;
      }
    });

    expect(result).toBe(browser);
    expect(connectOverCDP).toHaveBeenCalledWith("http://127.0.0.1:9222");
    expect(launch).not.toHaveBeenCalled();
  });

  it("falls back to the bundled browser when a detected executable launch fails", async () => {
    const browser = {
      newContext: vi.fn(),
      close: vi.fn()
    };
    const launch = vi.fn()
      .mockRejectedValueOnce(new Error("system browser unavailable"))
      .mockResolvedValueOnce(browser);

    const result = await launchPlaywrightBrowser({
      chromium: {
        launch
      }
    }, {
      platform: "linux",
      pathExists(filePath) {
        return filePath === "/usr/bin/google-chrome";
      }
    });

    expect(result).toBe(browser);
    expect(launch).toHaveBeenNthCalledWith(1, {
      headless: true,
      executablePath: "/usr/bin/google-chrome"
    });
    expect(launch).toHaveBeenNthCalledWith(2, {
      headless: true
    });
  });

  it("falls back to local launch candidates when browser attachment fails", async () => {
    const browser = {
      newContext: vi.fn(),
      close: vi.fn()
    };
    const connectOverCDP = vi.fn().mockRejectedValueOnce(new Error("connection refused"));
    const launch = vi.fn().mockResolvedValueOnce(browser);

    const result = await launchPlaywrightBrowser({
      chromium: {
        connectOverCDP,
        launch
      }
    }, {
      processEnv: {
        PLAYWRIGHT_CDP_URL: "http://127.0.0.1:9222"
      },
      platform: "linux",
      pathExists(filePath) {
        return filePath === "/usr/bin/google-chrome";
      }
    });

    expect(result).toBe(browser);
    expect(connectOverCDP).toHaveBeenCalledWith("http://127.0.0.1:9222");
    expect(launch).toHaveBeenNthCalledWith(1, {
      headless: true,
      executablePath: "/usr/bin/google-chrome"
    });
  });

  it("keeps the explicit executable candidate even when it is not yet on disk", () => {
    const candidates = resolvePlaywrightLaunchCandidates({
      platform: "linux",
      processEnv: {
        PLAYWRIGHT_EXECUTABLE_PATH: "/custom/browser/chrome"
      },
      pathExists() {
        return false;
      }
    });

    expect(candidates).toEqual([
      {
        label: "PLAYWRIGHT_EXECUTABLE_PATH",
        options: {
          headless: true,
          executablePath: "/custom/browser/chrome"
        }
      },
      {
        label: "Playwright bundled Chromium",
        options: {
          headless: true
        }
      }
    ]);
  });
});
