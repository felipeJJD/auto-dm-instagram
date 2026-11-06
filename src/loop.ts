/** Repete `fn` a cada `everyMs` sem sobrepor ciclos; erro é logado e o laço segue. */
export function startLoop(fn: () => Promise<unknown>, everyMs: number, label: string) {
  let current: Promise<void> | null = null;
  let stopped = false;
  const timer = setInterval(() => {
    if (current || stopped) return;
    current = fn()
      .then(
        () => {},
        (e) => console.error(`${label}:`, (e as Error).message),
      )
      .finally(() => {
        current = null;
      });
  }, everyMs);
  return {
    /** Para novos ciclos e espera o que estiver em andamento terminar (use antes de fechar o pool). */
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      await current;
    },
  };
}
