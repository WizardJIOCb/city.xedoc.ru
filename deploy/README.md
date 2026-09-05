# Публикация

Игра обслуживается Nginx как статические файлы. Начиная с 0.4, режим реальных карт использует небольшой Node.js 22.14+ сервис на `127.0.0.1:5190`, доступный через `/api/geo/`. Зависимостей npm на сервере у него нет.

- Домен: `https://city.xedoc.ru`
- SSH: `myserver` (82.146.42.213), либо `-Server user@82.146.42.213`.
- Папка: `/var/www/city.xedoc.ru`.
- `releases/<полный SHA>` — неизменяемые сборки; `current` — ссылка на активную.
- `incoming/` — архивы сборок. Скрипт проверяет SHA-256 после загрузки.
- `/version.json` — версия приложения, Git commit и время сборки.

## Обновление

```powershell
git push origin main
powershell -NoProfile -File .\deploy\Deploy.ps1
```

Скрипт требует чистый checkout и совпадение HEAD с публичным main. Выполняет тесты и сборку, загружает `dist` (включая сервер в `.server/`), атомарно переключает `current`, перезапускает API и проверяет сайт и `/api/geo/health` через Nginx. При ошибке возвращает предыдущую ссылку и перезапускает прежний API; откат на релиз до 0.4 останавливает API. Старые релизы автоматически не удаляются. GitHub Actions отдельно проверяет каждый push и pull request; SSH-секреты в GitHub не используются.

## Сервис карт (один раз перед первым релизом 0.4)

Проверьте `/usr/bin/node --version`, свободный порт 5190 и существующий конфиг домена. Установите `crush-city-geo.service` в `/etc/systemd/system/`, выполните `systemctl daemon-reload` и `systemctl enable crush-city-geo.service`. До активации релиза запускать службу не нужно. Добавьте блок `/api/geo/` из `city.xedoc.ru.conf` в конфигурацию этого домена с резервной копией; после `nginx -t` выполните `systemctl reload nginx`.

Служба работает от `www-data`, слушает только localhost, имеет лимит памяти 384 МБ. Кэш в `/var/cache/crush-city-geo` создаётся systemd, хранится между релизами и ограничен 100 файлами / 128 МБ. Геометрия хранится 7 дней, поиск — сутки. Одновременно выполняется один запрос геометрии, не чаще одного нового участка за 4 секунды; поиск — не чаще одного нового запроса за 1,2 секунды. На IP действует предел 30 запросов в минуту. Nginx обязательно перезаписывает `X-Real-IP`, не доверяя заголовку клиента.

При необходимости `/etc/default/crush-city-geo` задаёт `OVERPASS_URL`, `GEOCODER_URL` (Photon-совместимый API), `MAP_TILE_URL` или `GEO_CACHE_DIR`. Поставщиков меняйте с учётом их условий; переключения между публичными серверами для обхода лимитов нет. Проверка: `systemctl status crush-city-geo`, `journalctl -u crush-city-geo`, публичный `/api/geo/health`. Скрытая `.server/` закрыта Nginx от HTTP-доступа.

## Первичная настройка

После проверки DNS и отсутствия существующего сайта создайте `incoming/`, `releases/` и `/var/www/_letsencrypt`. Установите `city.xedoc.ru.http.conf` в `/etc/nginx/sites-available/city.xedoc.ru`, включите ссылкой из `sites-enabled`, выполните `nginx -t` и только после успеха `systemctl reload nginx`.

На сервере с уже зарегистрированной учётной записью Certbot:

```sh
certbot certonly --webroot -w /var/www/_letsencrypt --cert-name city.xedoc.ru -d city.xedoc.ru --non-interactive --keep-until-expiring
```

Установите финальный `city.xedoc.ru.conf`, затем снова `nginx -t` и `systemctl reload nginx`. После этого запустите `Deploy.ps1`. Проверьте `certbot.timer` и автоматическую перезагрузку Nginx после продления сертификатов. Не заменяйте конфигурации других доменов.

## Откат

```sh
# Подставьте полный SHA существующего предыдущего релиза:
bash /var/www/city.xedoc.ru/activate-release.sh <SHA>
```

Проверьте публичный `/version.json`, страницу и загрузку JS/CSS. Сертификат и настройки Nginx при обновлении игрового кода не меняются.
