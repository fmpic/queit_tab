// Shrink only when necessary; preserve browser zoom and readable size otherwise.
export function viewportScale(contentWidth, contentHeight, availableWidth, availableHeight) {
  if (contentWidth <= 0 || contentHeight <= 0) return 1;
  return Math.max(0.01, Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight));
}
// Keep the upward shift inside the space left after fitting the content.
export function viewportOffset(contentHeight, scale, availableHeight, viewportHeight) {
  return Math.max(0, Math.min(32, viewportHeight * 0.04, (availableHeight - contentHeight * scale) / 2));
}
export function installViewportFit(main) {
  let frame = 0;
  const fit = () => {
    frame = 0;
    const style = getComputedStyle(document.body);
    const horizontal = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const vertical = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const width = Math.max(1, document.body.clientWidth - horizontal - 8);
    const height = Math.max(1, document.body.clientHeight - vertical - 8);
    const scale = viewportScale(main.offsetWidth, main.offsetHeight, width, height);
    const offset = viewportOffset(main.offsetHeight, scale, height, document.body.clientHeight);
    main.style.setProperty('--page-scale', String(scale));
    main.style.setProperty('--page-offset', `${offset}px`);
  };
  const queue = () => { if (!frame) frame = requestAnimationFrame(fit); };
  window.addEventListener('resize', queue, { passive: true });
  // Address-bar changes can alter dvh without changing the window width.
  window.visualViewport?.addEventListener('resize', queue, { passive: true });
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(queue);
    observer.observe(main);
    observer.observe(document.body);
  }
  queue();
}
