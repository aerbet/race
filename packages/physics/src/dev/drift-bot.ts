import { emptyInput, type InputFrame } from '@sr/shared';

/**
 * Тест-бот: разгон по прямой, срыв ручником, затем удержание дрифта по кругу
 * с фиксированным рулём в сторону поворота и частичным газом. Ввод бота —
 * функция только от номера шага, т.е. это «записанный ввод».
 */
export function driftBot(step: number): InputFrame {
  const t = step / 60;
  const f = emptyInput();
  if (t < 4.2) {
    f.throttle = 1;
  } else if (t < 4.6) {
    f.throttle = 0.6;
    f.steer = 1;
    f.handbrake = 1;
  } else {
    f.throttle = 0.75;
    f.steer = 0.55;
  }
  return f;
}
