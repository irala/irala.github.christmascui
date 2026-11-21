# Cobaya Golosa 🎄

Minijuego navideño 2D cenital para móvil (vertical), hecho con **HTML5 Canvas** y **JavaScript ES6+** sin dependencias. Todo el arte es geométrico: círculos, aros, rectángulos, destellos y un gorro de Papá Noel dibujado con trazados.

Protagonizan **Fito**, una cobaya calva, rosada y con manchas grises, y **Castanho**, una cobaya de cara blanca con blaze, corona castaña y cara de mucha hambre. Los regalos que hay que recoger se dibujan como **aros rojos y verdes**.

## Archivos

```text
cobaya-golosa/
├── index.html   · estructura, canvas y overlay de menús
├── styles.css   · interfaz, menús y adaptación segura al móvil
├── game.js      · TODO el juego en un único módulo (IIFE)
└── README.md
```

`game.js` no necesita build ni servidor: `index.html` carga un script clásico, así que también funciona abriendo el archivo directamente. Para probar en un móvil de la misma red:

```bash
cd cobaya-golosa
python -m http.server 8123
# abre http://IP-DEL-ORDENADOR:8123
```

## Cómo se juega

- **Arrastra el dedo en cualquier punto de la pista**: aparece un joystick flotante y la cobaya se mueve en 360°.
- Al soltar, la cobaya se detiene.
- El HUD superior muestra **nivel (X/5)**, **regalos recogidos / total** y, cuando el nivel lo tiene, **tiempo restante**.
- En escritorio también se puede jugar con los cursores o `WASD`; `Enter` pulsa el botón principal del menú.
- **M** activa o silencia el sonido.

## Sonido y silencio

Todos los efectos se sintetizan en tiempo real con **Web Audio API**: no hay archivos de audio ni peticiones externas.

- **Recoger premio**: campanita corta que sube de tono con cada aro.
- **Castanho se despierta**: rumor ascendente grave.
- **Castanho roba un premio**: gulp descendente con un pequeño mordisco.
- **Mordisco/aturdimiento**: golpe grave y seco.
- **Nivel superado**: arpegio alegre.
- **Victoria**: pequeña fanfarria navideña con acorde final.
- **Botón de sonido**: arriba a la derecha, accesible por teclado y con estado `switch` (`on`/`off`). La preferencia se guarda en `localStorage`.

El contexto de audio se crea en el primer gesto del usuario (toque, clic o tecla), como exigen las políticas de reproducción de los móviles.

## Los 5 niveles

| Nivel | Reto |
|---|---|
| 1 · Primer bocado | 3 regalos, sin peligro. |
| 2 · Campo nevado | 5 regalos y 2 bolas de nieve estáticas. |
| 3 · La siesta | 5 regalos en **20 s**. Si se acaba el tiempo, Castanho se despierta, corre a comerse un regalo y termina la partida. |
| 4 · Mordisco | 5 regalos. Castanho persigue. Si muerde: empuje, **1,2 s aturdida** y **1,5 s de invulnerabilidad posterior** para no encadenar mordiscos. No mata. |
| 5 · Nochebuena | 7 regalos. Castanho muerde y aturde, pero si un regalo está más cerca de ella que de ti, se lanza a por él. Si se lo come, **game over**. |

### El robo del nivel 5

Para que el robo sea legible y justo:

- Solo entra a disputar regalos que estén a menos de **200 unidades** de la jugadora; no roba al otro lado de la pista.
- Cuando elige uno, se queda mirándolo **1,2 s** con un aviso: burbuja de regalo sobre ella, anillo dorado alrededor del regalo y un `!`. Tú puedes llegar antes y quitárselo.
- Si te acercas más que ella al regalo, abandona y vuelve a perseguirte.
- No puede empezar un robo mientras estás aturdida. Después del aturdimiento vuelve a evaluar.
- Tiene **3 s de margen inicial** antes de poder robar.

## Configuración rápida

Todo está al principio de `game.js`, en `TUNING` y `LEVELS_CONFIG`.

```js
const LEVELS_CONFIG = [
  {
    title: 'Primer bocado',
    prizes: 3,          // cantidad de regalos
    timeLimit: 0,       // segundos; 0 = sin límite
    obstacles: 0,       // bolas de nieve estáticas
    playerSpeed: 208,   // unidades de mundo / segundo
    hint: 'Recoge los 3 regalos',
    rival: null,        // o { type: 'sleeper' | 'chaser' | 'hungry', ... }
  },
  // ...
];
```

### Campos de `rival`

| Campo | Niveles | Qué hace |
|---|---|---|
| `type` | 3, 4, 5 | `sleeper` duerme hasta que expira el tiempo; `chaser` persigue; `hungry` persigue y roba. |
| `speed` | 3, 4, 5 | Velocidad de Castanho. |
| `wakeDelay` / `eatDelay` | 3 | Pausa al despertar y al masticar. |
| `stunDuration` | 4, 5 | Segundos que la jugadora no puede moverse tras un mordisco. |
| `invulnDuration` | 4, 5 | Invulnerabilidad **después** del aturdimiento. |
| `knockback` | 4, 5 | Impulso del empuje al morder. |
| `recoverTime` | 4, 5 | Tiempo que Castanho retrocede tras morder. |
| `decisionInterval` | 5 | Cada cuánto reevalúa perseguir o robar. |
| `stealDelay` | 5 | Margen inicial antes de poder robar. |
| `stealRange` | 5 | Distancia máxima jugadora-regalo para que entre a disputarlo. |
| `stealWindup` | 5 | Aviso antes de lanzarse al regalo. |

Otros ajustes útiles en `TUNING`:

- `joystickRadius`: radio del joystick flotante.
- `joystickDeadzone`: zona muerta.
- `knockbackFriction`: cuánto frena el empuje.
- `topPlayArea`, `wallPadding`: márgenes de la pista.
- `worldWidth`: ancho lógico del mundo. El alto se adapta al dispositivo; todos los tamaños y velocidades están en esas unidades.

## Detalles técnicos

- Canvas a pantalla completa con `devicePixelRatio` (limitado a 3) y `resize` con reescalado de posiciones.
- Bucle con `requestAnimationFrame` y `deltaTime` limitado a `0.05 s` para evitar saltos al volver de segundo plano.
- Pista con aspecto vertical constante: se limita el ancho del escenario y se centra en pantallas grandes.
- Joystick flotante con `pointer events` (ratón y táctil), captura de puntero y zona muerta.
- Estados: `START`, `PLAYING`, `LEVEL_CLEAR`, `GAME_OVER` (con motivo) y `VICTORY`.
- Menús en HTML/CSS (accesibles y nítidos) sobre el canvas; el juego se pausa al mostrarlos.
- Audio sintetizado con Web Audio API, sin archivos externos, con ganancia maestra, compresor y silencio persistente.
- Botón de silencio superior y HUD adaptados a `env(safe-area-inset-*)`; el escenario se centra dentro de las zonas seguras.
- Sin scroll de página, zoom por doble toque ni selección de texto: `touch-action`, `user-select` y `overflow` controlados tanto en el canvas como en los botones.

## Probar en otro móvil o publicar

El juego es estático: no hay build. Solo necesitas servir la carpeta `cobaya-golosa` (donde está `index.html`).

### 1. En este mismo ordenador

Puedes abrir `index.html` directamente, o servirlo en local:

```bash
cd cobaya-golosa
python -m http.server 8123
```

Y entrar en `http://localhost:8123`.

### 2. Otro móvil en la misma Wi-Fi

Arranca el servidor escuchando en toda la red local:

```bash
cd cobaya-golosa
python -m http.server 8123 --bind 0.0.0.0
```

Averigua la IP local del ordenador:

```powershell
ipconfig
```

Busca la **Dirección IPv4** del adaptador Wi-Fi/Ethernet activo (por ejemplo, `192.168.1.42`). En el móvil abre:

```text
http://192.168.1.42:8123
```

Si no carga:

- Permite Python en el **firewall de Windows** para redes privadas. Si no aparece el aviso, ejecuta en PowerShell como administrador:

```powershell
New-NetFirewallRule -DisplayName "Cobaya Golosa 8123" -Direction Inbound -Protocol TCP -LocalPort 8123 -Action Allow -Profile Private
```

- Comprueba que el móvil y el ordenador están en la **misma Wi-Fi**, sin una red de invitados con aislamiento.
- Desactiva VPNs que puedan separar la red.
- Si sigue sin funcionar, activa el punto de acceso móvil del ordenador y conecta el teléfono a esa red.

No uses `--bind 127.0.0.1` para esto: solo acepta conexiones del propio ordenador.

### 3. Un móvil ajeno, en otra red o un enlace para enviar

Necesitas una URL pública. Opciones sencillas:

- **Netlify Drop**: entra en <https://app.netlify.com/drop> y arrastra el contenido de `cobaya-golosa` (con `index.html` en la raíz). Te da una URL HTTPS al momento. Es la opción más rápida.
- **GitHub Pages**: sube los archivos a un repositorio y activa *Settings → Pages → Deploy from branch → main / root*. Queda en `https://TU-USUARIO.github.io/TU-REPO/`.
- **itch.io**: comprime el contenido en un ZIP con `index.html` en la raíz, crea un proyecto HTML y súbelo. También funciona en móvil.
- **Túnel temporal** (sin desplegar, pero el ordenador debe quedar encendido):

```bash
# Cloudflare Quick Tunnel, sin cuenta
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:8123
```

El comando imprime una URL `trycloudflare.com` que puedes abrir desde cualquier móvil. También puedes usar `npx localtunnel --port 8123` o `ngrok http 8123`.

Mientras el túnel esté abierto, cualquiera con el enlace puede entrar. Arranca el servidor **desde la carpeta del juego**, no desde `Documents`, para no exponer otros archivos.

### Notas

- Para compartir no envíes solo `index.html` por WhatsApp: necesita `styles.css` y `game.js` al lado. Mejor envía la URL o un ZIP.
- En una URL pública conviene HTTPS; los hostings anteriores lo dan gratis. El audio se desbloquea con el primer toque.
- El atajo `?level=3` también funciona en la URL publicada.

## Atajo de desarrollo

Puedes arrancar directamente un nivel con:

```text
index.html?level=3
```

También queda expuesto `window.__cobayaGolosa` para depurar desde la consola del navegador.

## Siguientes pasos posibles

1. Arte o sprites animados manteniendo la misma lógica.
2. Persistencia de récords/tiempos en `localStorage`.
3. Vibración táctil (`navigator.vibrate`) en mordiscos y robos.
4. Modo paisaje o tablero más ancho para tablets.
5. Ajustes de volumen o pistas musicales opcionales.
