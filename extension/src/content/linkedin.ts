import { initBrowserSentry } from "../telemetry/init-browser";
import { createLogger } from "../telemetry/logger";

const sentry = initBrowserSentry({ context: "content-linkedin" });
const logger = createLogger({ component: "content_linkedin" });

const toErrorMetadata = (error: unknown) => ({
  message: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined
});

const captureException = (error: unknown, component?: string) => {
  if (!sentry) {
    return;
  }
  sentry.withScope((scope) => {
    if (component) {
      scope.setTag("component", component);
    }
    scope.captureException(error instanceof Error ? error : new Error(String(error)));
  });
};

const INJECTED_ATTR = "data-keep-li-injected";
const BUTTON_CLASS = "keep-li-save-btn";
const BUTTON_ICON_CLASS = "keep-li-save-btn__icon";
const BUTTON_LABEL_CLASS = "keep-li-save-btn__label";
const POST_SELECTOR = "div[componentkey^='urn:li:activity']";
const MENU_CONTAINER_SELECTOR = "div[data-view-name='feed-control-menu-container']";

let lastMenuPost: HTMLElement | null = null;

type RuntimeEnvironment = typeof globalThis & {
  chrome?: { runtime?: typeof chrome.runtime };
  browser?: { runtime?: typeof chrome.runtime };
};

function ensureStyles() {
  if (document.head.querySelector(`style[${INJECTED_ATTR}]`)) {
    return;
  }
  const style = document.createElement("style");
  style.setAttribute(INJECTED_ATTR, "true");
  style.textContent = `
    .${BUTTON_CLASS} {
      align-items: center;
      background: transparent;
      border-radius: 9999px;
      border: none;
      color: #027373;
      cursor: pointer;
      display: inline-flex;
      font-size: 13px;
      font-weight: 600;
      gap: 6px;
      line-height: 1;
      margin-left: auto;
      padding: 8px 14px;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .${BUTTON_CLASS}:hover,
    .${BUTTON_CLASS}:focus-visible {
      background: #027373;
      color: #ffffff;
      outline: none;
      box-shadow: 0 0 0 2px rgba(2, 115, 115, 0.2);
    }
    .${BUTTON_CLASS}[disabled] {
      opacity: 0.5;
      cursor: progress;
    }
    .${BUTTON_CLASS} .${BUTTON_ICON_CLASS} {
      display: inline-flex;
      width: 18px;
      height: 18px;
    }
    .${BUTTON_CLASS} .${BUTTON_ICON_CLASS} svg {
      width: 18px;
      height: 18px;
    }
    .${BUTTON_CLASS} .${BUTTON_LABEL_CLASS} {
      letter-spacing: 0.01em;
    }
  `;
  document.head.appendChild(style);
}

type PendingCapture = {
  url?: string;
};

function getRuntimeApi(): typeof chrome.runtime | null {
  const globalScope: RuntimeEnvironment | undefined =
    typeof globalThis !== "undefined" ? (globalThis as RuntimeEnvironment) : undefined;
  const chromeRuntime = globalScope?.chrome?.runtime;
  if (chromeRuntime?.sendMessage) {
    return chromeRuntime as typeof chrome.runtime;
  }
  const browserRuntime = globalScope?.browser?.runtime;
  if (browserRuntime?.sendMessage) {
    return browserRuntime as typeof chrome.runtime;
  }
  return null;
}

function sendOpenPanelMessage(payload: PendingCapture) {
  const runtime = getRuntimeApi();
  if (!runtime) {
    logger.warn("content.runtime_unavailable");
    return;
  }
  
  // Check if extension context is still valid
  if (!runtime.id) {
    logger.warn("content.extension_context_invalidated");
    return;
  }
  
  try {
    runtime.sendMessage({ type: "open-capture-panel", payload }, () => {
      const lastError = chrome?.runtime?.lastError;
      if (lastError) {
        // Check for context invalidation
        if (lastError.message?.includes("Extension context invalidated")) {
          logger.warn("content.extension_reloaded");
        } else {
          logger.warn("content.open_panel_message_failed", {
            error: toErrorMetadata(lastError)
          });
        }
      }
    });
  } catch (error) {
    logger.error("content.send_message_failed", {
      error: toErrorMetadata(error)
    });
    captureException(error, "content-sendMessage");
  }
}

function injectIntoPost(post: HTMLElement) {
  if (post.hasAttribute(INJECTED_ATTR)) {
    return;
  }

  const actionsContainer = resolveActionsContainer(post);

  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.setAttribute("aria-label", "Save this LinkedIn post to Keep-li");

  button.innerHTML = `
    <span class="${BUTTON_ICON_CLASS}" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    </span>
    <span class="${BUTTON_LABEL_CLASS}">Keep-Li</span>
  `;

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;

    const metadata = buildCapturePayload(post);
    try {
      sendOpenPanelMessage(metadata);
    } finally {
      button.disabled = false;
    }
  });

  const insertionTarget = actionsContainer.querySelector?.(
    "button[data-view-name='feed-comment-button']"
  );

  if (insertionTarget && insertionTarget.parentElement === actionsContainer) {
    insertionTarget.parentElement.appendChild(button);
  } else {
    actionsContainer.appendChild(button);
  }

  post.setAttribute(INJECTED_ATTR, "true");

  const menuTrigger =
    post.querySelector<HTMLElement>("button[data-view-name='feed-control-menu-trigger']") ||
    post.querySelector<HTMLElement>("button[aria-label*='more options']") ||
    post.querySelector<HTMLElement>("button[aria-label*='View more options']");

  if (menuTrigger && !menuTrigger.hasAttribute("data-keep-li-menu-trigger")) {
    menuTrigger.addEventListener(
      "click",
      () => {
        lastMenuPost = post;
      },
      { capture: true }
    );
    menuTrigger.setAttribute("data-keep-li-menu-trigger", "true");
  }
}

function injectMenuOption(container: HTMLElement) {
  if (container.querySelector('[data-view-name="keep-li-menu-option"]')) {
    return;
  }

  let post = container.closest<HTMLElement>(POST_SELECTOR);
  if (!post) {
    post = lastMenuPost;
  }
  if (!post) {
    return;
  }

  const baseOption = container.querySelector<HTMLElement>("[data-view-name='feed-control-menu-save']");

  if (!baseOption) {
    return;
  }

  const option = document.createElement(baseOption.tagName.toLowerCase());
  Array.from(baseOption.attributes).forEach((attr) => {
    if (attr.name === "data-view-name") {
      return;
    }
    option.setAttribute(attr.name, attr.value);
  });
  option.className = baseOption.className;
  option.setAttribute("role", "button");
  option.setAttribute("tabindex", "0");
  option.setAttribute("data-view-name", "keep-li-menu-option");
  option.setAttribute("aria-label", "Save to Keep-Li");
  option.setAttribute("componentkey", "keep-li-menu-option");
  option.setAttribute("data-keep-li", "true");

  const baseContent = baseOption.firstElementChild as HTMLElement | null;
  const content = document.createElement(baseContent?.tagName.toLowerCase() ?? "div");
  content.className = baseContent?.className ?? "";
  content.setAttribute("aria-label", "Save to Keep-Li");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  const baseSvg = baseOption.querySelector("svg");
  if (baseSvg?.getAttribute("class")) {
    svg.setAttribute("class", baseSvg.getAttribute("class") ?? "");
  }

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z");
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", "22,6 12,13 2,6");
  svg.append(path, polyline);

  const baseLabelContainer = baseOption.querySelector("p")?.parentElement as HTMLElement | null;
  const labelContainer = document.createElement(baseLabelContainer?.tagName.toLowerCase() ?? "div");
  labelContainer.className = baseLabelContainer?.className ?? "";
  labelContainer.setAttribute("componentkey", "keep-li-menu-option-label");

  const baseLabel = baseOption.querySelector("p");
  const label = document.createElement(baseLabel?.tagName.toLowerCase() ?? "p");
  label.className = baseLabel?.className ?? "";
  label.textContent = "Save to Keep-Li";

  labelContainer.appendChild(label);
  content.append(svg, labelContainer);
  option.appendChild(content);

  const triggerSave = () => {
    const metadata = buildCapturePayload(post);
    sendOpenPanelMessage(metadata);
  };

  option.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    triggerSave();
  });

  option.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      triggerSave();
    }
  });

  const insertAfter = baseOption.nextSibling;
  if (insertAfter) {
    container.insertBefore(option, insertAfter);
  } else {
    container.appendChild(option);
  }

  container.setAttribute("data-keep-li-menu", "true");
}
function resolveActionsContainer(post: HTMLElement): HTMLElement {
  const commentButton = post.querySelector<HTMLButtonElement>("button[data-view-name='feed-comment-button']");
  if (commentButton) {
    const parent = commentButton.parentElement;
    if (parent) {
      return parent;
    }
  }

  const shareButton = post.querySelector<HTMLButtonElement>("button[data-view-name='feed-share-button']");
  if (shareButton) {
    const parent = shareButton.parentElement;
    if (parent) {
      return parent;
    }
  }

  const fallback =
    post.querySelector<HTMLElement>(
      "div.feed-shared-social-actions, div.social-details-social-activity, footer.feed-shared-update-v2__card-footer"
    ) || post;

  return fallback;
}

function buildCapturePayload(post: HTMLElement): PendingCapture {
  const url = extractPermalink(post) ?? window.location.href;
  return { url } satisfies PendingCapture;
}

function extractPermalink(post: HTMLElement): string | undefined {
  const componentKey = post.getAttribute("componentkey");
  if (componentKey && componentKey.startsWith("urn:li:activity:")) {
    return `https://www.linkedin.com/feed/update/${componentKey}/`;
  }

  const linkCandidate =
    post.querySelector<HTMLAnchorElement>("a[href*='/posts/']") ||
    post.querySelector<HTMLAnchorElement>("a[href*='/feed/update/']");

  const href = linkCandidate?.getAttribute("href") ?? undefined;
  if (!href) {
    const urn = post.getAttribute("data-urn") || post.getAttribute("data-id");
    if (urn && urn.startsWith("urn:li:activity:")) {
      return `https://www.linkedin.com/feed/update/${urn}/`;
    }
    return undefined;
  }

  return toAbsoluteUrl(href);
}

function toAbsoluteUrl(href?: string | null): string | undefined {
  if (!href) {
    return undefined;
  }
  if (href.startsWith("http")) {
    return href.split("?")[0];
  }
  try {
    const url = new URL(href, window.location.origin);
    return url.href.split("?")[0];
  } catch {
    return undefined;
  }
}

function scan() {
  ensureStyles();
  document.querySelectorAll<HTMLElement>(POST_SELECTOR).forEach(injectIntoPost);
  document.querySelectorAll<HTMLElement>(MENU_CONTAINER_SELECTOR).forEach(injectMenuOption);
}

scan();

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      if (node.matches(POST_SELECTOR)) {
        injectIntoPost(node);
        return;
      }
      node.querySelectorAll<HTMLElement>(POST_SELECTOR).forEach(injectIntoPost);

      const menuContainer = node.matches?.(MENU_CONTAINER_SELECTOR)
        ? (node as HTMLElement)
        : (node.querySelector?.(MENU_CONTAINER_SELECTOR) as HTMLElement | null);
      if (menuContainer) {
        injectMenuOption(menuContainer);
      }
    });
  }
});

observer.observe(document.body, { childList: true, subtree: true });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    scan();
  }
});
