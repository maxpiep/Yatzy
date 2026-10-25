// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PinLock, type PinStorage } from './pin';

const mem = (): PinStorage & { dump: () => string } => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), dump: () => JSON.stringify([...m]) };
};

describe('PIN-Sperre', () => {
  it('speichert nur einen Hash und entsperrt mit der richtigen PIN', async () => {
    const store = mem();
    const lock = new PinLock(store, mem());
    expect(lock.hasPin()).toBe(false);
    await lock.setPin('4711');
    expect(store.dump()).not.toContain('4711');
    lock.lock();
    expect(lock.isUnlocked()).toBe(false);
    expect(await lock.unlock('1234')).toBe('wrong');
    expect(await lock.unlock('4711')).toBe('ok');
    expect(lock.isUnlocked()).toBe(true);
  });

  it('lehnt ungültige PINs ab', async () => {
    const lock = new PinLock(mem(), mem());
    await expect(lock.setPin('12')).rejects.toThrow();
    await expect(lock.setPin('12345678901')).rejects.toThrow();
    await expect(lock.setPin('abcd')).rejects.toThrow();
  });

  it('sperrt nach 5 Fehlversuchen mit steigender Wartezeit', async () => {
    let t = 1_000_000;
    const lock = new PinLock(mem(), mem(), () => t);
    await lock.setPin('2468');
    lock.lock();
    for (let i = 0; i < 5; i++) expect(await lock.unlock('0000')).toBe('wrong');
    expect(lock.waitMs()).toBe(30_000);
    expect(await lock.unlock('2468')).toBe('wait');
    t += 30_001;
    expect(await lock.unlock('0000')).toBe('wrong');
    expect(lock.waitMs()).toBe(60_000);
    t += 60_001;
    expect(await lock.unlock('2468')).toBe('ok');
    expect(lock.failedAttempts()).toBe(0);
  });

  it('PIN ändern verlangt die alte PIN', async () => {
    const lock = new PinLock(mem(), mem());
    await lock.setPin('1111');
    expect(await lock.changePin('9999', '2222')).toBe('wrong');
    expect(await lock.changePin('1111', '2222')).toBe('ok');
    lock.lock();
    expect(await lock.unlock('2222')).toBe('ok');
  });
});
