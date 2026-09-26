import { clampAutoLockMinutes } from './schema'

export interface AutoLockTimers {
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}

export const defaultTimers: AutoLockTimers = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle),
}

/** Events that count as "the user is still here". */
export const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const

/**
 * Locks the vault after a period without activity.
 *
 * The clock is injected so the behaviour is testable without waiting, and the
 * controller stops itself once it fires: after a lock, only a fresh `start()`
 * re-arms it.
 */
export class AutoLockController {
  private handle: ReturnType<typeof setTimeout> | null = null
  private running = false
  private minutes: number

  constructor(
    private readonly onLock: () => void,
    minutes: number,
    private readonly timers: AutoLockTimers = defaultTimers,
  ) {
    this.minutes = clampAutoLockMinutes(minutes)
  }

  get timeoutMs(): number {
    return this.minutes * 60_000
  }

  get autoLockMinutes(): number {
    return this.minutes
  }

  get isRunning(): boolean {
    return this.running
  }

  get isArmed(): boolean {
    return this.handle !== null
  }

  start(): void {
    this.running = true
    this.arm()
  }

  stop(): void {
    this.running = false
    this.disarm()
  }

  /** Restarts the countdown. Ignored while stopped. */
  noteActivity(): void {
    if (!this.running) return
    this.arm()
  }

  /** Applies a new timeout from Settings and restarts the countdown. */
  setMinutes(minutes: number): void {
    this.minutes = clampAutoLockMinutes(minutes)
    if (this.running) this.arm()
  }

  private arm(): void {
    this.disarm()
    this.handle = this.timers.setTimeout(() => {
      this.handle = null
      this.running = false
      this.onLock()
    }, this.timeoutMs)
  }

  private disarm(): void {
    if (this.handle !== null) {
      this.timers.clearTimeout(this.handle)
      this.handle = null
    }
  }
}

/** Wires activity events to the controller; returns the cleanup function. */
export function observeActivity(
  controller: AutoLockController,
  target: EventTarget,
  events: readonly string[] = ACTIVITY_EVENTS,
): () => void {
  const handler = (): void => {
    controller.noteActivity()
  }

  for (const event of events) {
    target.addEventListener(event, handler)
  }

  return () => {
    for (const event of events) {
      target.removeEventListener(event, handler)
    }
  }
}
