# Публикация

Игра обслуживается Nginx как статические файлы. Node.js на сервере не нужен.

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

Скрипт требует чистый checkout и совпадение HEAD с публичным main. Выполняет тесты и сборку, загружает только `dist`, атомарно переключает `current`, проверяет сайт через Nginx. При ошибке серверной проверки возвращает предыдущую ссылку. Старые релизы автоматически не удаляются. GitHub Actions отдельно проверяет каждый push и pull request; SSH-секреты в GitHub не используются.

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
