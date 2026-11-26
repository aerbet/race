export type QualityName = 'low' | 'high';

export interface Quality {
  name: QualityName;
  pixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  bloom: boolean;
  speedLines: boolean;
  motionBlur: boolean;
  smokeParticles: number;
  skidMarks: number;
  lampLights: number;
  drawDistance: number;
}

const QUALITY_KEY = 'sr:quality';
export type QualitySetting = 'auto' | QualityName;

/** Выбор игрока в меню (сохраняется в браузере). */
export function loadQualitySetting(): QualitySetting {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    return v === 'low' || v === 'high' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveQualitySetting(v: QualitySetting): void {
  try {
    localStorage.setItem(QUALITY_KEY, v);
  } catch {
    /* нет хранилища */
  }
}

/**
 * Телефон или планшет. iPad и «полная версия сайта» в Safari выдают себя за Mac —
 * их выдаёт сенсорный экран (PLAN_V2 7.1а).
 */
export function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
}

export function getQuality(): Quality {
  // ?q=low|high — для отладки; иначе выбор игрока; иначе по устройству
  const url = new URLSearchParams(location.search);
  const q = url.get('q');
  const set = loadQualitySetting();
  const name: QualityName =
    q === 'low' || q === 'high' ? q : set !== 'auto' ? set : isMobileDevice() ? 'low' : 'high';
  if (name === 'low') {
    return {
      name,
      // Лёгкая графика: рендер в 0,75 от экрана (PLAN_V2 7.1в), CSS растягивает кадр
      pixelRatio: Math.min(window.devicePixelRatio, 1.25) * 0.75,
      antialias: false,
      shadows: false,
      bloom: false,
      speedLines: false,
      motionBlur: false,
      smokeParticles: 60,
      skidMarks: 400,
      lampLights: 0,
      drawDistance: 450,
    };
  }
  return {
    name,
    pixelRatio: Math.min(window.devicePixelRatio, 2),
    antialias: true,
    shadows: true,
    bloom: true,
    speedLines: true,
    motionBlur: true,
    smokeParticles: 220,
    skidMarks: 1600,
    lampLights: 6,
    drawDistance: 900,
  };
}
