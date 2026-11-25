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

export function getQuality(): Quality {
  const url = new URLSearchParams(location.search);
  const q = url.get('q');
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const name: QualityName = q === 'low' || q === 'high' ? q : mobile ? 'low' : 'high';
  if (name === 'low') {
    return {
      name,
      pixelRatio: Math.min(window.devicePixelRatio, 1.25),
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
