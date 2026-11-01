# Xbox 360 Motion-Controlled Table Tennis

A serverless, browser-based 3D motion-controlled Table Tennis match built with **Three.js**, **Cannon-es**, **MediaPipe Hands**, and **PeerJS WebRTC**.

Inspired by classic Xbox 360 sports titles (*Rockstar Games presents Table Tennis*, *Top Spin*), featuring tournament arena lighting, court line judges, authentic ball bounce physics, stamina/power meters, and real-time multiplayer.

---

## Real Table Tennis Ball Mechanics & Physics Fixes

### 1. Dynamic Serving Mechanics (Angle, Pace & Curve)
- **Interactive Player Serves**:
  - The serve is now directly governed by your **paddle position and swing velocity**.
  - Moving your paddle to the right during a swing launches the ball **cross-court wide to the right**!
  - Moving your paddle to the left sweeps the ball **cross-court wide to the left**!
  - Swing speed controls forward pace (from a controlled 5.0 m/s touch to a blistering 7.5 m/s drive).
  - Horizontal swiping imparts real **Magnus side-spin**, visibly curving the ball in mid-air.
- **Strategic CPU Serves**:
  - The CPU no longer serves in a simple straight line.
  - The CPU dynamically picks from four tactical serve plays:
    1. `WIDE FOREHAND`: Slices across to your wide right sideline.
    2. `WIDE BACKHAND`: Slices across to your wide left sideline.
    3. `POWER DRIVE`: Fast, deep bullet straight down the center line.
    4. `CURVING SLICE`: Curving side-spin bending away in mid-air.

### 2. Elimination of Premature Double-Bounces
- **Dynamic Forward Interception**:
  - The CPU now tracks the ball depth dynamically and **steps forward into the court** (from $z = 1.12\text{m}$ to $1.45\text{m}$) to strike short balls on the rise off the first bounce, completely preventing the ball from bouncing twice.
- **Table Contact Debouncing**:
  - Increased physical table bounce debouncing to 190ms, guaranteeing that a single bounce on the table never triggers a false double-bounce fault.
- **Calibrated ITTF 0.92 Restitution**:
  - Serves and returns bounce cleanly up into the active hitting zone, giving both player and CPU ample height and time to execute clean strokes.

### 3. Directional Rally Mechanics & Shot Placement
- **Off-Center Paddle Deflections**:
  - Hitting the ball on the right side of your paddle blade angles the ball to the right.
  - Hitting on the left side of your paddle blade angles the ball to the left.
- **Aerodynamic Spin**:
  - Swiping across the ball imparts side-spin and curves the flight path.
  - Brushing upwards creates topspin that dips the ball sharply down onto the opponent's table.
- **Tactical CPU AI**:
  - The CPU reads your court position: if you are covering the left, it attacks your open right court; if you are covering the right, it attacks the open left.

---

## Controls & Hotkeys

| Hotkey / Action | Function |
|---|---|
| **Physical Swing** | Swiping forward launches serve naturally |
| **Space / Click** | Serve ball |
| **R** | Reset ball |
| **C** | Lock neutral center reference |
| **M** | Toggle Webcam motion tracking vs Mouse |
| **V** | Cycle camera views (Player 1, Player 2 180°, Side TV) |
| **Mouse Move + Wheel** | Fallback mouse positioning & reach |

---

## Running Locally

```bash
# Start local dev server
npm run dev

# Or build and preview
npm run build
npm run preview
```
Open **`http://localhost:3000`** in your browser.
