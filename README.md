# Gehoot

Quiz tipo Kahoot, estático (GitHub Pages) con Supabase Realtime (broadcast + presence, sin base de datos).

- Jugadores: `index.html` (o escanear el QR del presentador).
- Presentador: `host.html?pin=2002` (el PIN está en `host.js`).

## Cambiar las preguntas

Edita `questions.json`. Cada pregunta:

```json
{ "texto": "¿Pregunta?", "opciones": ["A", "B", "C", "D"], "correcta": 0, "segundos": 10 }
```

- `opciones`: exactamente 4 (orden = rojo ▲, azul ◆, amarillo ●, verde ■).
- `correcta`: índice de la buena, empezando en 0 (0 = primera … 3 = cuarta).
- Valida el JSON (comas, comillas) antes de subir; si es inválido, el host muestra un error.

## Notas

- El host guarda la partida en el navegador: si recargas, sigue donde estaba. "Nueva partida" (al final) genera sala nueva.
- Puntos: 0 si falla; si acierta, `round(1000 × (1 − t/límite/2))`, con `t` medido por el reloj del host.
