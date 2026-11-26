# art/ — 3D из Блендера

Порядок работы и этапы — `docs/BLENDER_PLAN.md`, требования к моделям — `docs/ART_BRIEF.md`.
Исходник модели — скрипт + JSON-спецификация; `.blend` и сырые `.glb` пересобираются и в git не хранятся.

## Установка

1. Блендер 4.2 LTS или новее (проверено на 5.3).
2. Путь к нему — переменная `BLENDER_BIN`. Без неё конвейер ищет Блендер в
   `C:\Program Files\Blender Foundation\*` и `D:\Blender Foundation\*` (берёт самую новую версию):
   `pnpm --filter art art blender` покажет найденный путь.
3. `pnpm install` — ставит `@gltf-transform/cli` (сжатие).
4. Для текстур: `toktx` из KTX-Software в `PATH` (без него текстуры не сжимаются в KTX2, будет предупреждение).

## Команды

| Команда | Что делает |
|---|---|
| `pnpm art:silhouette <id>` | Схема силуэта по спецификации: виды спереди, сбоку, сзади, сверху → `art/renders/<id>/silhouette.png` и `.svg` (~5 с) |
| `pnpm art:car <id>` | Блендер в фоне: модель → проверки `checks.py` → UV → LOD → `art/export/cars/<id>/base.glb` → meshopt (+KTX2) → `base.min.glb` → валидатор → рендеры `art/renders/<id>/` |
| `pnpm art:car <id> --publish` | То же + копия в `apps/client/public/cars/<id>/base.glb` и `kit_<kit>.glb` |
| Киты | Если в спецификации есть `kits`, `kits.py` строит их после базы: `art/export/cars/<id>/kit_<kit>.glb`, рендеры `kits.png`, `kits_rear.png` |
| `pnpm art:car <id> --no-render` | Без рендеров (быстро, ~5 с) |
| `pnpm art:car:all` | Все машины из `art/specs/cars/` |
| `pnpm art:render <id>` | Только рендеры из `art/source/cars/<id>.blend` |
| `pnpm art:validate` | Валидатор всех машин (`tools/car-validate`) |
| `pnpm art:wheels [<id>]` | Все диски из `art/specs/wheels/w*.json` × диаметры из `_common.json` → `art/export/wheels/<id>_<дюймы>.min.glb`, валидатор, лист `art/renders/wheels/sheet.png` (~2 мин) |
| `pnpm art:wheels --publish` | То же + копия в `apps/client/public/wheels/` (после утверждения) |
| `pnpm art:city <kit>` | Этап B5 — ещё не написан |

Посмотреть модель в игре: `pnpm dev` → `http://localhost:5173/?carModel=<id>` (все машины заезда
получают эту модель; краска из гаража пока не применяется — задача 9.2).

## Структура

```
scripts/lib/      scene, materials, uv, lod, export, render, checks, curves — общее для всех моделей
scripts/cars/     build_car.py (точка входа), test_rig.py (тестовая модель B0), wheels.py (диски, B1), silhouette.py (схема силуэта)
specs/cars/       <id>.json — параметры машины
specs/wheels/     w*.json — параметры дисков, _common.json — размеры шины и диаметры
renders/<id>/     side, front, rear, top, three_quarter_*, night, uv_check, lod → sheet.png
source/, export/  .blend и .glb — в .gitignore
```

## Тестовая модель `test_rig`

Не игровая машина: «кубик» с колёсами и всеми узлами из ART_BRIEF, габариты как у физики
`era2000_coupe`. Нужна, чтобы проверять конвейер от Блендера до игры.

## Колёса (B1)

Узлы glb: `wheel_root` → `wheel` (шина + диск, вращается), `wheel_LOD1`, `wheel_LOD2`, `brake`
(диск + суппорт, не вращается), `brake_LOD1`, `brake_LOD2` (пустой). Ось вращения — X, лицо диска
смотрит в +X (правый борт); для левых колёс игра зеркалит колесо по X (`scale.x = −1`), а не
поворачивает на 180°, иначе суппорт окажется спереди. Эталонный диаметр — 0,66 м, игра масштабирует.

Параметры диска: `style` (straight, double, star, mesh, turbine), `spokes` (5–10), `spokeWidth`,
`thickness`, `dish` (насколько спицы утоплены от кромки), `concave` (насколько ступица глубже обода),
`finish` и `lip` (silver, gunmetal, bronze, black, white, chrome или same), `lugs` (число гаек).
