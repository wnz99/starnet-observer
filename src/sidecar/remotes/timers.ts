export interface TimerOptions<Timer> {
  setTimer?: ((fn: () => void, delay: number) => Timer) | undefined;
  clearTimer?: ((timer: Timer) => void) | undefined;
}
export function timerScheduler<Timer>({ setTimer, clearTimer }: TimerOptions<Timer>) {
  return (fn: () => void, delay: number) => {
    const timer = (setTimer ?? setTimeout)(fn, delay);
    // Injection supports custom handles and independently supplied callbacks, as the original runtime did.
    return timer
      ? () => {
          Reflect.apply(clearTimer ?? clearTimeout, undefined, [timer]);
        }
      : null;
  };
}
