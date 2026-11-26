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
| `pnpm art:car <id>` | Блендер в фоне: модель → проверки `checks.py` → UV → LOD → `art/export/cars/<id>/base.glb` → meshopt (+KTX2) → `base.min.glb` → валидатор → рендеры `art/renders/<id>/` |
| `pnpm art:car <id> --publish` | То же + копия в `apps/client/public/cars/<id>/base.glb` (только после утверждения владельцем) |
| `pnpm art:car <id> --no-render` | Без рендеров (быстро, ~5 с) |
| `pnpm art:car:all` | Все машины из `art/specs/cars/` |
| `pnpm art:render <id>` | Только рендеры из `art/source/cars/<id>.blend` |
| `pnpm art:validate` | Валидатор всех машин (`tools/car-validate`) |
| `pnpm art:wheels`, `pnpm art:city <kit>` | Этапы B1 и B5 — ещё не написаны |

Посмотреть модель в игре: `pnpm dev` → `http://localhost:5173/?carModel=<id>` (все машины заезда
получают эту модель; краска из гаража пока не применяется — задача 9.2).

## Структура

```
scripts/lib/      scene, materials, uv, lod, export, render, checks — общее для всех моделей
scripts/cars/     build_car.py (точка входа), test_rig.py (тестовая модель B0)
specs/cars/       <id>.json — параметры машины
renders/<id>/     side, front, rear, top, three_quarter_*, night, uv_check, lod → sheet.png
source/, export/  .blend и .glb — в .gitignore
```

## Тестовая модель `test_rig`

Не игровая машина: «кубик» с колёсами и всеми узлами из ART_BRIEF, габариты как у физики
`era2000_coupe`. Нужна, чтобы проверять конвейер от Блендера до игры.
