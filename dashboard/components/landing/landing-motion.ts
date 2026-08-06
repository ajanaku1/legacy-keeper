import { useEffect, useRef, type RefObject } from "react";

interface TiltStyle {
  setProperty(name: string, value: string): void;
}

interface TiltElement {
  readonly style: TiltStyle;
}

type ElementReader = () => TiltElement | null;
type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

export interface VaultTiltController {
  queue(rotateX: number, rotateZ: number): void;
  reset(): void;
  cancel(): void;
}

export function createVaultTiltController(
  getElement: ElementReader,
  requestFrame: RequestFrame = window.requestAnimationFrame.bind(window),
  cancelFrame: CancelFrame = window.cancelAnimationFrame.bind(window),
): VaultTiltController {
  let frame: number | undefined;
  let nextTilt = { rotateX: 0, rotateZ: 0 };

  const commit = () => {
    frame = undefined;
    const element = getElement();
    if (!element) return;
    setTilt(element.style, nextTilt.rotateX, nextTilt.rotateZ);
  };

  const queue = (rotateX: number, rotateZ: number) => {
    nextTilt = { rotateX, rotateZ };
    frame ??= requestFrame(commit);
  };

  return {
    queue,
    reset: () => queue(0, 0),
    cancel: () => {
      if (frame !== undefined) cancelFrame(frame);
      frame = undefined;
    },
  };
}

function setTilt(style: TiltStyle, rotateX: number, rotateZ: number): void {
  style.setProperty("--vault-rotate-x", `${rotateX.toFixed(2)}deg`);
  style.setProperty("--vault-rotate-z", `${rotateZ.toFixed(2)}deg`);
}

export function useLandingReveal<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.dataset.reveal = "true";
    if (prefersReducedMotion() || !window.IntersectionObserver) {
      element.dataset.visible = "true";
      return;
    }
    const observer = observeOnce(element);
    return () => observer.disconnect();
  }, []);

  return ref;
}

function observeOnce(element: HTMLElement): IntersectionObserver {
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return;
      element.dataset.visible = "true";
      observer.disconnect();
    },
    { rootMargin: "0px 0px -12%" },
  );
  observer.observe(element);
  return observer;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
