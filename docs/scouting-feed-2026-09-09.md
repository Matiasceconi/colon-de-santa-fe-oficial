# Scouting: catálogo sudamericano API-Football — 2026-09-09

Aplicación: COLON DE SANTA FE NUEVA (6aa05e94dccbb66f573319b1).
Institución activa: Club Atletico Colon (6aa05effd58bb5d099ecedf6).

## Entrega
- Nueva pestaña Base sudamericana dentro de Scouting.
- Catálogo de países sudamericanos descubierto con /leagues, sin fijar IDs de divisiones.
- Selección inicial de temporada actual o última publicada; se pueden agregar temporadas históricas.
- Importación por /teams, todas las páginas de /players, y /players/squads para temporadas actuales.
- Ficha única por ID de proveedor; estadísticas separadas por liga, temporada y equipo.
- Los planteles actuales no se atribuyen a temporadas históricas; registros de plantel sin estadísticas no implican cero minutos.
- Búsqueda paginada desde servidor, filtros por país de competencia, liga/temporada y posición general.
- Ficha detallada y promoción explícita a prospecto del club. No se incorporan jugadores al plantel interno.
- Estado/cursor/página descargada persistidos, reserva diaria, control por minuto, errores HTTP 200 y caché de planteles de 24 horas.
- Exclusión mutua con updateMany condicional y lease; entidades protegidas para acceso administrativo; gateway valida permisos de scouting.
- Servidores admitidos: API-Sports directo y API-Football en RapidAPI.
- La importación avanza en la pestaña abierta y puede reanudarse. NO se instaló un proceso autónomo en segundo plano.
- No se han construido comparaciones nuevas: se preservan estadísticas originales para una fase posterior.
- Reconsultar el catálogo no reinicia ligas ya completadas; una actualización incremental periódica de registros completados queda para una fase posterior.

## Estado real
La tabla FootballApiSettings estaba vacía durante la revisión. No se consultó la suscripción del proveedor ni se importaron jugadores reales.
También se admite clave configurada como secreto API_FOOTBALL_KEY, API_FOOTBALL_API_KEY o FOOTBALL_API_KEY; su disponibilidad no fue comprobada en ejecución autenticada.
El estado inicial del catálogo quedó preparado. No hay datos de prueba en las entidades productivas.
La primera conexión se realiza desde Scouting > Base sudamericana > Conectar API, usando la suscripción existente.
La cobertura real y la cantidad de jugadores solo se conocerán después de consultar la API y recorrer las ligas. No se promete cobertura que el proveedor no entregue.
Se incluyen categorías y copas devueltas por los países contemplados; esto no certifica todas las divisiones existentes ni la pertenencia histórica a cada equipo.

## Verificación
- npm run build: exit 0.
- npx eslint src/components/scouting/ScoutingFeedTab.jsx --quiet: exit 0.
- node tests/scoutingFeed.test.mjs: exit 0. Prueba aislada con proveedor y persistencia en memoria, sin escribir datos de muestra en Base44.
- Casos cubiertos: permisos, falta de clave, países, paginación, un mismo jugador en varios equipos, jugadores solo de plantel, aislamiento de temporadas históricas, idempotencia, promoción, reserva diaria, lease concurrente, errores del proveedor y paginación del directorio.
- Esquemas sincronizados: ScoutingFeedState, ScoutingFeedCompetition, ScoutingFeedPlayer, ScoutingFeedEntry, ScoutingFeedSquad.
- Validación visual y prueba real de funciones pendientes: navegador sin sesión de Base44.
- Cambios guardados en el proyecto; no se accionó Publish del sitio público.

## Fuentes de implementación
https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide
https://www.api-football.com/news/post/how-to-get-all-teams-and-players-from-a-league-id
https://www.api-football.com/news/post/how-ratelimit-works
