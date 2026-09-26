import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ACTIVITY_EVENTS,
  AutoLockController,
  observeActivity,
  type AutoLockTimers,
} from './auto-lock'
import { DEFAULT_AUTO_LOCK_MINUTES } from './schema'

const ONE_MINUTE_MS = 60_000

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AutoLockController', () => {
  it('is idle before start', () => {
    const controller = new AutoLockController(vi.fn(), 15)
    expect(controller.isRunning).toBe(false)
    expect(controller.isArmed).toBe(false)
  })

  it('arms on start', () => {
    const controller = new AutoLockController(vi.fn(), 15)
    controller.start()
    expect(controller.isRunning).toBe(true)
    expect(controller.isArmed).toBe(true)
  })

  it('locks after the configured timeout', () => {
    const onLock = vi.fn()
    const controller = new AutoLockController(onLock, 1)
    controller.start()

    vi.advanceTimersByTime(ONE_MINUTE_MS - 1)
    expect(onLock).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('stops itself once it has fired', () => {
    const onLock = vi.fn()
    const controller = new AutoLockController(onLock, 1)
    controller.start()

    vi.advanceTimersByTime(ONE_MINUTE_MS * 5)

    expect(onLock).toHaveBeenCalledTimes(1)
    expect(controller.isRunning).toBe(false)
    expect(controller.isArmed).toBe(false)
  })

  it('restarts the countdown on activity', () => {
    const onLock = vi.fn()
    const controller = new AutoLockController(onLock, 1)
    controller.start()

    vi.advanceTimersByTime(ONE_MINUTE_MS - 1)
    controller.noteActivity()
    vi.advanceTimersByTime(ONE_MINUTE_MS - 1)

    expect(onLock).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('ignores activity while stopped', () => {
    const onLock = vi.fn()
    const controller = new AutoLockController(onLock, 1)
    controller.noteActivity()

    vi.advanceTimersByTime(ONE_MINUTE_MS * 2)
    expect(onLock).not.toHaveBeenCalled()
    expect(controller.isArmed).toBe(false)
  })

  it('disarms on stop', () => {
    const onLock = vi.fn()
    const controller = new AutoLockController(onLock, 1)
    controller.start()
    controller.stop()

    vi.advanceTimersByTime(ONE_MINUTE_MS * 2)
    expect(onLock).not.toHaveBeenCalled()
    expect(controller.isRunning).toBe(false)
  })

  it('applies a new timeout from Settings', () => {
    const onLock = vi.fn()
    const controller = new AutoLockController(onLock, 1)
    controller.start()
    controller.setMinutes(5)

    expect(controller.autoLockMinutes).toBe(5)
    expect(controller.timeoutMs).toBe(5 * ONE_MINUTE_MS)

    vi.advanceTimersByTime(ONE_MINUTE_MS)
    expect(onLock).not.toHaveBeenCalled()

    vi.advanceTimersByTime(4 * ONE_MINUTE_MS)
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('clamps an unsupported timeout to the default', () => {
    const controller = new AutoLockController(vi.fn(), 7)
    expect(controller.autoLockMinutes).toBe(DEFAULT_AUTO_LOCK_MINUTES)
  })

  it('clamps a negative timeout to the default', () => {
    const controller = new AutoLockController(vi.fn(), -5)
    expect(controller.autoLockMinutes).toBe(DEFAULT_AUTO_LOCK_MINUTES)
  })

  it('defaults to fifteen minutes', () => {
    const controller = new AutoLockController(vi.fn(), DEFAULT_AUTO_LOCK_MINUTES)
    expect(controller.timeoutMs).toBe(15 * ONE_MINUTE_MS)
  })

  it('can be driven by injected timers', () => {
    const callbacks: Array<() => void> = []
    const cleared: unknown[] = []
    const timers: AutoLockTimers = {
      setTimeout: (callback) => {
        callbacks.push(callback)
        return callbacks.length as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeout: (handle) => {
        cleared.push(handle)
      },
    }

    const onLock = vi.fn()
    const controller = new AutoLockController(onLock, 1, timers)
    controller.start()
    controller.noteActivity()

    expect(cleared).toHaveLength(1)
    expect(callbacks).toHaveLength(2)

    callbacks[1]?.()
    expect(onLock).toHaveBeenCalledTimes(1)
  })
})

describe('observeActivity', () => {
  it('restarts the countdown when an activity event fires', () => {
    const onLock = vi.fn()
    const controller = new AutoLockController(onLock, 1)
    const target = new EventTarget()
    const stop = observeActivity(controller, target)

    controller.start()
    vi.advanceTimersByTime(ONE_MINUTE_MS - 1)
    target.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(ONE_MINUTE_MS - 1)

    expect(onLock).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onLock).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stops listening after cleanup', () => {
    const onLock = vi.fn()
    const controller = new AutoLockController(onLock, 1)
    const target = new EventTarget()
    const stop = observeActivity(controller, target)

    controller.start()
    stop()
    target.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(ONE_MINUTE_MS * 2)

    // Still locks once: cleanup removed the listeners, not the timer.
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('watches pointer, key and wheel activity', () => {
    expect(ACTIVITY_EVENTS).toContain('pointerdown')
    expect(ACTIVITY_EVENTS).toContain('keydown')
    expect(ACTIVITY_EVENTS).toContain('wheel')
  })
})
