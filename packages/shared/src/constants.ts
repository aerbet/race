/** Частота физики, Гц. Все расчёты ведутся только с этим шагом. */
export const PHYSICS_HZ = 60;
export const FIXED_DT = 1 / PHYSICS_HZ;
/** Не больше стольких шагов за один кадр рендера (защита от «спирали смерти»). */
export const MAX_STEPS_PER_FRAME = 8;
export const GRAVITY = 9.81;
