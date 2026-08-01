// Coarse User-Agent classification for the study's device/browser reporting.
//
// Deliberately small and dependency-free: we only need enough resolution to
// answer "did this participant do the interview on a phone, a tablet, or a
// computer, and in which browser" as a grouping variable. It is not a
// fingerprint, and it is not trying to be exhaustive — anything unrecognised
// falls back to "unknown" rather than guessing.
//
// The pre-interview Qualtrics survey also asks device type as a self-report;
// this is the objective counterpart, so the two can be cross-checked.

export type DeviceInfo = {
  deviceType: "mobile" | "tablet" | "desktop" | "unknown";
  browser: string;
  os: string;
};

const UNKNOWN: DeviceInfo = {
  deviceType: "unknown",
  browser: "unknown",
  os: "unknown",
};

function detectOs(ua: string): string {
  if (/iPhone|iPod/i.test(ua)) {
    return "iOS";
  }
  if (/iPad/i.test(ua)) {
    return "iPadOS";
  }
  if (/Android/i.test(ua)) {
    return "Android";
  }
  if (/Windows NT/i.test(ua)) {
    return "Windows";
  }
  // Known limitation: iPadOS Safari with "Request Desktop Website" on (the
  // default for many users) reports "Macintosh" and is indistinguishable from
  // a Mac here, so a slice of tablet sessions will be recorded as desktop.
  if (/Macintosh|Mac OS X/i.test(ua)) {
    return "macOS";
  }
  if (/CrOS/i.test(ua)) {
    return "ChromeOS";
  }
  if (/Linux/i.test(ua)) {
    return "Linux";
  }
  return "unknown";
}

function detectBrowser(ua: string): string {
  // Order matters throughout: most of these UA strings contain the names of
  // the engines they were forked from. Edge and Opera both claim "Chrome",
  // and Chrome claims "Safari".
  if (/Edg\//i.test(ua)) {
    return "Edge";
  }
  if (/OPR\/|Opera/i.test(ua)) {
    return "Opera";
  }
  if (/SamsungBrowser/i.test(ua)) {
    return "Samsung Internet";
  }
  if (/FxiOS|Firefox/i.test(ua)) {
    return "Firefox";
  }
  if (/CriOS|Chrome/i.test(ua)) {
    return "Chrome";
  }
  if (/Safari/i.test(ua)) {
    return "Safari";
  }
  return "unknown";
}

function detectDeviceType(ua: string, os: string): DeviceInfo["deviceType"] {
  if (os === "iPadOS" || /Tablet|PlayBook|Silk/i.test(ua)) {
    return "tablet";
  }
  // Android tablets omit "Mobile"; Android phones include it.
  if (os === "Android") {
    return /Mobile/i.test(ua) ? "mobile" : "tablet";
  }
  if (os === "iOS" || /Mobile|iPhone|iPod|Windows Phone/i.test(ua)) {
    return "mobile";
  }
  if (
    os === "Windows" ||
    os === "macOS" ||
    os === "Linux" ||
    os === "ChromeOS"
  ) {
    return "desktop";
  }
  return "unknown";
}

export function parseUserAgent(ua: string | null | undefined): DeviceInfo {
  if (!ua) {
    return UNKNOWN;
  }
  const os = detectOs(ua);
  return {
    deviceType: detectDeviceType(ua, os),
    browser: detectBrowser(ua),
    os,
  };
}
