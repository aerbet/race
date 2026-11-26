# ASSETS — внешние и собственные ассеты

Каждый внешний ассет — строка: файл, источник, лицензия. Собственные (сгенерированные кодом) тоже отмечаем.

| Файл / ассет | Источник | Лицензия |
|---|---|---|
| Кузова машин (`apps/client/src/render/car.ts`) | собственные, процедурная экструзия профиля | собственные |
| Текстуры асфальта, земли, окон, поребрика (`render/level.ts`) | собственные, генерируются на canvas | собственные |
| Окружение отражений `RoomEnvironment` | входит в three.js (examples) | MIT |
| Тестовая модель `apps/client/public/cars/test_rig/base.glb` | собственная, строится скриптом `art/scripts/cars/test_rig.py` в Блендере | собственные |
| Декодер meshopt (`three/examples/jsm/libs/meshopt_decoder.module.js`) | входит в three.js (examples), meshoptimizer | MIT |
