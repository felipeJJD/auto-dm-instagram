import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLoop } from '../src/loop.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms = 2000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout esperando condição');
    await sleep(2);
  }
}

test('startLoop: repete a cada intervalo e nunca sobrepõe ciclos', async () => {
  let running = 0;
  let maxRunning = 0;
  let calls = 0;
  const loop = startLoop(async () => {
    calls++;
    running++;
    maxRunning = Math.max(maxRunning, running);
    await sleep(25);
    running--;
  }, 5, 'teste');
  await until(() => calls >= 3);
  await loop.stop();
  assert.equal(maxRunning, 1);
});

test('startLoop.stop espera o ciclo em andamento terminar e não inicia outro', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let started = 0;
  let finished = 0;
  const loop = startLoop(async () => {
    started++;
    await gate;
    finished++;
  }, 5, 'teste');
  await until(() => started === 1);

  let stopped = false;
  const stopping = loop.stop().then(() => (stopped = true));
  await sleep(40);
  assert.equal(stopped, false, 'stop não pode resolver com ciclo em andamento');
  assert.equal(finished, 0);

  release();
  await stopping;
  assert.equal(finished, 1);
  await sleep(30);
  assert.equal(started, 1, 'sem ciclos novos depois do stop');
});

test('startLoop: erro no ciclo é logado e o laço continua; stop sem ciclo em andamento resolve', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  let calls = 0;
  const loop = startLoop(async () => {
    calls++;
    throw new Error('boom');
  }, 5, 'outbox');
  await until(() => calls >= 2);
  await loop.stop();
  assert.match(String(log.mock.calls[0].arguments.join(' ')), /outbox.*boom/);
  await startLoop(async () => {}, 60_000, 'x').stop();
});
