# ASSETS — внешние и собственные ассеты

Каждый внешний ассет — строка: файл, источник, лицензия. Собственные (сгенерированные кодом) тоже отмечаем.

| Файл / ассет | Источник | Лицензия |
|---|---|---|
| Кузова машин (`apps/client/src/render/car.ts`) | собственные, процедурная экструзия профиля | собственные |
| Текстуры асфальта, земли, окон, поребрика (`render/level.ts`) | собственные, генерируются на canvas | собственные |
| Окружение отражений `RoomEnvironment` | входит в three.js (examples) | MIT |
| Тестовая модель `apps/client/public/cars/test_rig/base.glb` | собственная, строится скриптом `art/scripts/cars/test_rig.py` в Блендере | собственные |
| Декодер meshopt (`three/examples/jsm/libs/meshopt_decoder.module.js`) | входит в three.js (examples), meshoptimizer | MIT |
| Диски и шины `art/export/wheels/*.glb`, карта нормалей протектора | собственные, строятся скриптом `art/scripts/cars/wheels.py` (рисунок протектора — numpy, без надписей) | собственные |
| Колёса `apps/client/public/wheels/*.glb` (утверждены 26.11.2026) | собственные, `art/scripts/cars/wheels.py` | собственные |
| Машина `apps/client/public/cars/kaizen_rx34/base.glb` (утверждена 26.11.2026) | собственная, `art/scripts/cars/car.py` + `art/specs/cars/kaizen_rx34.json`; AO запечён в Блендере | собственные |
