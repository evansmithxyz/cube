# Cube Timer

A speedcubing timer for **GAN smart cubes** (built for the GAN i4) that runs in the browser.
It shows a live 3D copy of your cube, tracks your scramble turn by turn, starts timing on your
first turn, and stops the moment the cube is solved.

The Bluetooth protocol is ported from [cube-real2sim](https://github.com/pthangeda/cube-real2sim)
(Python + MuJoCo) and [gan-web-bluetooth](https://github.com/afedotov/gan-web-bluetooth) to
TypeScript + Web Bluetooth + Three.js, so no install is needed beyond a browser.

### Supported cubes

GAN has shipped three Bluetooth protocol generations, and the same model (including the i4)
can come with different ones. The app detects which one your cube uses when it connects and
shows it next to the cube's name.

| Protocol | Cubes |
|----------|-------|
| Gen2 | GAN356 i3, GAN356 i Carry / Carry S, GAN12 ui, GAN12 ui FreePlay, GAN Mini ui FreePlay, Monster Go 3Ai, MoYu AI 2023 |
| Gen3 | GAN356 i Carry 2 |
| Gen4 | GAN12 ui Maglev, GAN14 ui FreePlay, GAN i4 (some units) |

Only a Gen4 GAN i4 has been tested on real hardware (by cube-real2sim). The live gyro view
needs a cube with a gyroscope.

## Run it

Needs Node 20+ and **Chrome or Edge** (desktop or Android; Safari and Firefox have no Web Bluetooth).

```bash
npm install
npm run dev
```

Open http://localhost:5173. Web Bluetooth only works on `https://` or `localhost`.

## Connecting the GAN i4

1. Turn a face to wake the cube (it stops advertising when asleep).
2. Click **Connect GAN cube** and pick your cube (e.g. `GANi4_XXXX`).
3. Hold the cube **white up, green facing you** and click **Reset view**. The 3D cube then
   matches what you see in your hand (it's drawn from roughly your eye position). Do it again
   whenever it looks off: the gyro's heading drifts slowly.

GAN cubes encrypt their data with a key derived from the cube's MAC address. Browsers hide
MAC addresses, so the first time you'll either:

- turn on `chrome://flags/#enable-experimental-web-platform-features` (Edge: `edge://flags`)
  and restart, after which the address is read automatically, or
- enter it by hand: open `chrome://bluetooth-internals/#devices`, click *Start scan*, wake the
  cube, and copy its address. The last 4 characters of the name (`GANi4_AEC3`) are the end of it.

The address is saved in the browser, so you only do this once per cube.

## A solve

1. Start with a solved cube. The app shows a random 25-turn scramble and highlights the next
   turn. If you turn the wrong way it tells you what to undo.
2. When the cube reaches the scrambled state, 15 s WCA inspection starts (switch it off in the
   sidebar). Starting after 15 s is +2, after 17 s DNF.
3. Your first turn starts the timer; solving the cube stops it.
4. The solve is saved with its turns and timestamps. Click a solve to see the scramble,
   solution, turns per second, or to change the penalty or delete it.

## Splits and algorithm times

Pick your method under **Split solves by** (CFOP, Layer by layer or Roux). Every solve is split
into the method's stages from the cube's state, turn by turn, whichever colour you start on:

| Method | Stages |
|--------|--------|
| CFOP | Cross, F2L 1–4 (pairs in any order), OLL, PLL |
| Layer by layer | Cross, First layer, Second layer, Top cross, Last layer |
| Roux | First block, Second block, CMLL, LSE (the M slice can be off while you build blocks) |

Each stage records its **look** time (the pause before its first turn) and **turn** time. The
splits show under the clock during a solve, in each solve's details, and averaged in the
**Stages** tab. Switching method re-splits every saved solve.

With CFOP the app also recognises your **OLL and PLL cases** (PLLs by name, e.g. T or Ua; OLLs
as the usual top-down diagram), from any angle and with any AUF. The **Algorithms** tab lists
each case you've had with its count, average look and turn time, and best, slowest first.

## Drill mode

Switch to **Drill** in the header to time one algorithm over and over. Pick it from the list
(all 21 PLLs, Sune, Antisune and two common triggers) or **Add algorithm** with your own, in
standard notation including wide turns (r, Rw), slices (M E S) and rotations (x y z).

Each rep starts on your first turn and stops the moment the cube shows the algorithm's result.
That's judged from the cube's state, not the exact moves, so:

- you can do it from any angle, and **any algorithm for the same case counts**;
- a turn of the top layer before or after (AUF) is fine, and one before isn't timed (except for
  algorithms that themselves start or end with a U turn);
- reps chain: do the algorithm again straight away for the next rep, from wherever the cube is;
- if you fumble and it can't match any more, the rep is dropped and you start again. **Esc**
  restarts a rep by hand.

The sidebar shows every rep of the current algorithm (time, turns per second, ao5) and a table of
all the algorithms you've drilled with best, ao5 and mean, slowest first. Drill reps are kept
separately from your solves.

**I scrambled it myself** uses the cube's current state as the scramble. **Esc** cancels an
attempt without saving it. **Mark cube as solved** fixes the cube's own idea of its state
if it ever drifts (hold it solved first).

No cube? **Virtual cube** works with the keyboard (csTimer layout): `I`/`K` R R′, `J`/`F` U U′,
`H`/`G` F F′, `D`/`E` L L′, `S`/`L` D D′, `W`/`O` B B′. Drag the 3D cube to look around.

## Code

| Path | What it does |
|------|--------------|
| `src/gan/` | GAN protocols: AES key from MAC (`crypto.ts`), per-generation UUIDs and commands (`generations.ts`), packet decoding and dropped-move recovery (`drivers.ts`), Web Bluetooth connection |
| `src/cube/` | Moves and the 54-sticker cube state (Kociemba facelet order, same as the cube reports), whole-cube rotations, and full notation (wide, slice, rotations) |
| `src/analysis/` | Method stage definitions, solve splitting, and OLL/PLL case recognition |
| `src/drill/` | Drill mode: rep detection by the algorithm's effect, presets, rep storage |
| `src/timer/` | Attempt state machine, scramble tracking, averages, solve storage (`localStorage`) |
| `src/view/cubeView.ts` | Three.js rendering with animated layer turns and gyro orientation |
| `src/virtualCube.ts` | Keyboard stand-in for a smart cube |
| `src/main.ts` | Wires cube events to the timer, view and page |

```bash
npm test          # unit tests (protocol, cube model, timer, stats)
npm run typecheck
npm run build     # static site in dist/
```

The tests check the protocol port against the reference implementation's test cases, the cube
model against Kociemba's move definitions and a state recorded from a real GAN i4, and the
encryption against WebCrypto.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for credits and licenses.
