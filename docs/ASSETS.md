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
| Кузовные киты `apps/client/public/cars/kaizen_rx34/kit_{street,track,drift}.glb` | собственные, `art/scripts/cars/kits.py` + `art/specs/cars/kaizen_rx34.json`; AO запечён в Блендере | собственные |
| Текстуры ливрей и карбона в клиенте (`render/paint.ts`) | собственные, рисуются в canvas | собственные |
| Машины `apps/client/public/cars/{takumo_raiden,hoshi_vortex,tsurugi_rs4,voss_kleiner,brawler_500,voss_imperator,falkner_heck,raijin_tempest,hoshi_kaze,nimbus_e1,ferro_cuneo}/` (base + 3 кита, 26.11.2026) | собственные, `art/scripts/cars/*.py` + `art/specs/cars/<id>.json`; AO запечён в Блендере | собственные |
| Наборы зданий `apps/client/public/cities/kits/{moscow,tokyo}/` (атлас, модули, реквизит, ориентиры) | собственные, `art/scripts/city/*.py`; атласы нарисованы процедурно | собственные |
| Оформление трасс и рельеф `apps/client/public/tracks/` | собственные, `art/scripts/track/dressing.py`, `terrain.py`; логотипы спонсоров — вымышленные фигуры | собственные |
| Карты трасс `apps/client/public/maps/*.png` | собственные, `art/scripts/track/map.py` | собственные |
