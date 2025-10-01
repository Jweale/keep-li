export function resolveAsset(path: string): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  if (path.startsWith("/")) {
    return path;
  }
  return `/${path}`;
}
