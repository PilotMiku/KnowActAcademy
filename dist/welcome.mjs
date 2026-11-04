import { brandIcon } from "./ui.mjs";

// Fixed seeds keep the sky stable when the page redraws; each star has its own rhythm.
function starfield() {
  let seed = 731;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: 62 }, (_, index) => {
    const x = random() * 96 + 2;
    const y = random() * 94 + 3;
    const size = Math.round(random() * 2 + 2);
    const duration = random() * 8 + 10;
    const delay = (-random() * duration).toFixed(2);
    // Fade stars near the quote without masking an entire animated layer.
    const distance = Math.hypot((x - 50) / 33, (y - 49) / 30);
    const strength = Math.min(1, Math.max(.18, (distance - .4) / .6)).toFixed(2);
    return `<i class="welcome-star${index % 9 === 0 ? " welcome-star--cross" : ""}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--size:${size}px;--star-strength:${strength};--twinkle:${duration.toFixed(2)}s;--delay:${delay}s"></i>`;
  }).join("");
}

function constellation(name, path, points, index) {
  return `<svg class="welcome-constellation welcome-constellation--${name}" viewBox="0 0 160 120" style="--pulse:${10 + index * 1.7}s;--delay:${-index * 2.3}s" focusable="false">
    <path class="welcome-constellation-line" d="${path}"/>
    ${points.map(([x, y], i) => `<circle class="welcome-constellation-halo" cx="${x}" cy="${y}" r="${i % 3 === 0 ? 6 : 4.5}"/><circle class="welcome-constellation-node" cx="${x}" cy="${y}" r="${i % 3 === 0 ? 2.6 : 1.8}"/>`).join("")}
  </svg>`;
}

function orbit(rx, ry, angle, duration, index) {
  const path = `M ${600 + rx} 600 A ${rx} ${ry} 0 1 1 ${600 - rx} 600 A ${rx} ${ry} 0 1 1 ${600 + rx} 600`;
  return `<g transform="rotate(${angle} 600 600)" style="--pulse:${11 + index * 3}s;--delay:${-index * 4}s">
    <ellipse class="welcome-orbit-track" cx="600" cy="600" rx="${rx}" ry="${ry}"/>
    <path class="welcome-orbit-arc" d="${path}" pathLength="100"/>
    ${[0, 1].map((dot) => `<g class="welcome-orbit-traveler" style="offset-path:path('${path}');--travel:${duration + dot * 9}s;--travel-delay:${-duration * (.18 + dot * .48)}s">
      <circle class="welcome-orbit-halo" r="${dot ? 9 : 13}"/>
      <circle class="welcome-orbit-point" r="${dot ? 2 : 3}"/>
    </g>`).join("")}
  </g>`;
}

function welcomeSky() {
  return `<div class="welcome-sky" aria-hidden="true">
    <div class="welcome-nebula welcome-nebula--blue"></div><div class="welcome-nebula welcome-nebula--violet"></div>
    <div class="welcome-starfield">${starfield()}</div>
    <svg class="welcome-orbits" viewBox="0 0 1200 1200" focusable="false">
      ${orbit(540, 325, -28, 48, 0)}${orbit(485, 410, 32, 63, 1)}${orbit(405, 480, -12, 78, 2)}
    </svg>
    <div class="welcome-constellations">
      ${constellation("sum", "M 116 23 L 43 23 L 78 59 L 40 99 L 117 99", [[116,23],[79,23],[43,23],[61,42],[78,59],[59,79],[40,99],[79,99],[117,99]], 0)}
      ${constellation("infinity", "M 80 60 C 64 35 46 29 31 42 C 8 64 35 98 59 77 L 101 43 C 126 22 152 57 129 78 C 113 92 96 85 80 60 Z", [[80,60],[57,36],[31,42],[26,72],[48,83],[102,42],[127,37],[138,61],[119,83]], 1)}
      ${constellation("pi", "M 25 30 L 136 30 M 56 30 L 54 65 L 45 99 M 109 30 L 106 75 Q 105 97 128 92", [[25,30],[56,30],[82,30],[109,30],[136,30],[54,65],[45,99],[106,75],[110,91],[128,92]], 2)}
      ${constellation("root", "M 20 63 L 39 53 L 59 93 L 83 25 L 143 25", [[20,63],[39,53],[49,73],[59,93],[71,59],[83,25],[113,25],[143,25]], 3)}
      ${constellation("delta", "M 80 20 L 28 101 L 132 101 Z", [[80,20],[54,60],[28,101],[80,101],[132,101],[106,60]], 4)}
    </div>
  </div>`;
}

export function welcomePage() {
  return `<div class="welcome-shell">
    ${welcomeSky()}
    <header class="welcome-header">
      <a class="welcome-brand" href="#/welcome" aria-label="知行学习起始页">${brandIcon(document.documentElement.dataset.theme)}<span>知行学习</span></a>
      <span class="welcome-caption">学习，从这里开始</span>
    </header>
    <main id="main" class="welcome-main" tabindex="-1">
      <div class="welcome-rule" aria-hidden="true"></div>
      <blockquote class="welcome-quote">
        <h1><span>行是知之始</span><span>知是行之成</span></h1>
        <footer><span aria-hidden="true">--</span><cite>陶行知</cite></footer>
      </blockquote>
      <a class="welcome-enter" href="#/">进入学习<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></a>
    </main>
    <footer class="welcome-footer" aria-label="学习方式"><a href="#/practice">题库练习</a><span aria-hidden="true">·</span><a href="#/prepare">加权备考</a><span aria-hidden="true">·</span><a href="#/knowledge">知识复习</a></footer>
  </div>`;
}

let activeExit = null;

export function cancelWelcomeExit() {
  const exit = activeExit;
  if (!exit) return;
  activeExit = null;
  exit.animation?.cancel();
  exit.shell.inert = false;
  delete exit.shell.dataset.leaving;
}

export async function enterStudy(shell, navigate) {
  if (!shell || activeExit) return;
  const exit = { shell, animation: null };
  activeExit = exit;
  shell.dataset.leaving = "true";
  shell.inert = true;
  try {
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches && shell.animate) {
      exit.animation = shell.animate(
        [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-6px)" }],
        { duration: 180, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
      );
      await exit.animation.finished;
    }
  } catch {
    if (activeExit !== exit) return;
  }
  if (activeExit === exit) {
    if (shell.isConnected) navigate();
    else cancelWelcomeExit();
  }
}
