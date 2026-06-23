#!/usr/bin/env node
/**
 * Custom GitHub Contribution Skyline — isometric grid + stats sidebar.
 * No pie chart, no radar chart. Dark navy bg, white grid cells, green bars.
 *
 * Usage:
 *   GITHUB_TOKEN=xxx node generate.js <username> [outputPath]
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const USERNAME = process.argv[2] || process.env.USERNAME;
const OUT_PATH = process.argv[3] || process.env.OUT_PATH || "./skyline.svg";
const TOKEN = process.env.GITHUB_TOKEN;

if (!USERNAME) {
  console.error("Usage: node generate.js <username> [outputPath]");
  process.exit(1);
}
if (!TOKEN) {
  console.error("Missing GITHUB_TOKEN environment variable.");
  process.exit(1);
}

// ---------- GraphQL fetch ----------
function graphqlRequest(query, variables) {
  const body = JSON.stringify({ query, variables });
  const options = {
    hostname: "api.github.com",
    path: "/graphql",
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "User-Agent": "skyline-widget-script",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.errors) return reject(new Error(JSON.stringify(json.errors)));
          resolve(json.data);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const QUERY = `
  query ($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

// ---------- Stats ----------
function computeStats(weeks) {
  const days = [];
  weeks.forEach((w) => w.contributionDays.forEach((d) => days.push(d)));

  const total = days.reduce((s, d) => s + d.contributionCount, 0);
  const max = days.reduce((m, d) => Math.max(m, d.contributionCount), 0);
  const avg = days.length ? total / days.length : 0;

  let best = 0;
  let cur = 0;
  days.forEach((d) => {
    if (d.contributionCount > 0) {
      cur += 1;
      best = Math.max(best, cur);
    } else {
      cur = 0;
    }
  });

  return { total, max, avg, best, days };
}

function levelFor(count, max) {
  if (count <= 0) return 0;
  if (max <= 0) return 1;
  const r = count / max;
  if (r > 0.75) return 4;
  if (r > 0.5) return 3;
  if (r > 0.25) return 2;
  return 1;
}

// ---------- Isometric projection ----------
// Standard 2:1 isometric: x' = (x - y) * cos(30), y' = (x + y) * sin(30)
const CELL = 11; // footprint size
const GAP = 1.4;
const STEP = CELL + GAP;
const MAX_H = 46; // max bar height in px
const ISO_ANGLE = Math.PI / 6; // 30deg

function isoProject(col, row, z) {
  const x = col * STEP;
  const y = row * STEP;
  const screenX = (x - y) * Math.cos(ISO_ANGLE);
  const screenY = (x + y) * Math.sin(ISO_ANGLE) - z;
  return [screenX, screenY];
}

const COLORS = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
const COLOR_DARK = ["#d8dade", "#7fd190", "#2fa84e", "#218838", "#0f5b27"];
const COLOR_DARKER = ["#c5c7cb", "#69b97a", "#228a3e", "#176d2c", "#0a481e"];

function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `rgb(${r},${g},${b})`;
}

function drawCube(col, row, h, lvl) {
  if (h <= 0) h = 1.5;
  const top = COLORS[lvl];
  const left = shade(top, 0.72);
  const right = shade(top, 0.52);

  const half = CELL / 2;
  // Cube footprint corners (col,row) plane at z=0 and z=h, in grid units
  // Diamond top face corners (clockwise from front)
  const p = (dc, dr, z) => isoProject(col + dc, row + dr, z);

  const topFront = p(0, 1, h);
  const topRight = p(1, 1, h);
  const topBack = p(1, 0, h);
  const topLeft = p(0, 0, h);

  const botFront = p(0, 1, 0);
  const botRight = p(1, 1, 0);

  const pts = (arr) => arr.map((pt) => pt.join(",")).join(" ");

  // top face (diamond)
  const topFace = `<polygon points="${pts([topLeft, topBack, topRight, topFront])}" fill="${top}" />`;
  // left face (front-left side), uses topFront/topLeft down to bot
  const leftFace = `<polygon points="${pts([topFront, topLeft, p(0, 0, 0), botFront])}" fill="${left}" />`;
  // right face (front-right side)
  const rightFace = `<polygon points="${pts([topFront, topRight, botRight, botFront])}" fill="${right}" />`;

  return leftFace + rightFace + topFace;
}

function drawFlatCell(col, row) {
  const top = "#ebedf0";
  const stroke = "#d4d7db";
  const p = (dc, dr) => isoProject(col + dc, row + dr, 0);
  const a = p(0, 0);
  const b = p(1, 0);
  const c = p(1, 1);
  const d = p(0, 1);
  const pts = [a, b, c, d].map((pt) => pt.join(",")).join(" ");
  return `<polygon points="${pts}" fill="${top}" stroke="${stroke}" stroke-width="0.4" />`;
}

// ---------- Icons (simple inline paths, GitHub-octicon-like) ----------
const ICONS = {
  calendar:
    '<path d="M4.75 0a.75.75 0 0 1 .75.75V2h5V.75a.75.75 0 0 1 1.5 0V2h1.25c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25V3.75C1 2.784 1.784 2 2.75 2H4V.75A.75.75 0 0 1 4.75 0ZM2.5 7.5v6.75c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V7.5Z"/>',
  streak:
    '<path d="M9.5.5a.5.5 0 0 1 1 0v1.382a8 8 0 0 1 3.196 1.69l1.061-1.06a.5.5 0 1 1 .707.707l-1.06 1.06A8 8 0 1 1 8 1.5h1.5V.5ZM8 14.5A6.5 6.5 0 1 0 8 1.5a6.5 6.5 0 0 0 0 13Z"/>',
  eye:
    '<path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.329 2.992 6.019 2 8 2Zm0 1.5c-1.534 0-2.903.802-3.999 1.738-1.087.929-1.878 2.016-2.293 2.65a.122.122 0 0 0 0 .224c.415.634 1.206 1.722 2.293 2.65C5.097 11.698 6.466 12.5 8 12.5c1.534 0 2.903-.802 3.999-1.738 1.087-.928 1.878-2.016 2.293-2.65a.122.122 0 0 0 0-.224c-.415-.634-1.206-1.721-2.293-2.65C10.903 4.302 9.534 3.5 8 3.5ZM8 10a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z"/>',
  sparkle:
    '<path d="M8 1l1.2 3.6L12.8 6 9.2 7.2 8 11l-1.2-3.8L3 6l3.8-1.4Z"/>',
  bars:
    '<path d="M2 13h2V7H2v6Zm5 0h2V3H7v10Zm5 0h2V9h-2v4Z"/>',
};

function icon(name, fill, x, y, size = 11) {
  return `<g transform="translate(${x},${y}) scale(${size / 16})" fill="${fill}">${ICONS[name]}</g>`;
}

// ---------- Main render ----------
async function main() {
  const data = await graphqlRequest(QUERY, { login: USERNAME });
  const user = data && data.user;
  if (!user) {
    console.error(`No such user: ${USERNAME}`);
    process.exit(1);
  }
  const weeks = user.contributionsCollection.contributionCalendar.weeks;
  const stats = computeStats(weeks);

  // Layout constants
  const PAD = 28;
  const SIDEBAR_W = 230;
  const GRID_TOP = 70;

  // Compute grid bounds in screen space first (col = week index, row = day index 0-6)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  weeks.forEach((w, col) => {
    for (let row = 0; row < 7; row++) {
      [0, MAX_H].forEach((z) => {
        const [sx, sy] = isoProject(col, row, z);
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, sx + STEP); // rough pad
        minY = Math.min(minY, sy);
        maxY = Math.max(maxY, sy + STEP);
      });
    }
  });

  const gridW = maxX - minX;
  const gridH = maxY - minY;

  const WIDTH = Math.ceil(gridW + PAD * 2 + SIDEBAR_W);
  const HEIGHT = Math.ceil(Math.max(gridH + GRID_TOP + PAD, 230));

  const offsetX = PAD - minX;
  const offsetY = GRID_TOP - minY;

  // Build cell + cube SVG, flats first (so cubes draw on top correctly per row order),
  // then cubes sorted by (col+row) for correct painter's-algorithm overlap.
  const cubes = [];
  weeks.forEach((w, col) => {
    w.contributionDays.forEach((day, row) => {
      cubes.push({ col, row, count: day.contributionCount });
    });
  });

  let flatsSvg = "";
  weeks.forEach((w, col) => {
    for (let row = 0; row < 7; row++) {
      flatsSvg += drawFlatCell(col, row);
    }
  });

  cubes.sort((a, b) => (a.col + a.row) - (b.col + b.row));
  let cubesSvg = "";
  cubes.forEach(({ col, row, count }) => {
    if (count <= 0) return; // empty days stay flat (matches reference look)
    const lvl = levelFor(count, stats.max);
    const h = Math.max(4, Math.round((count / stats.max) * MAX_H));
    cubesSvg += drawCube(col, row, h, lvl);
  });

  const gridGroup = `<g transform="translate(${offsetX},${offsetY})">${flatsSvg}${cubesSvg}</g>`;

  // ---------- Sidebar ----------
  const sbX = WIDTH - SIDEBAR_W + 10;
  let sbY = 50;
  const lineGap = 24;
  const blue = "#58a6ff";
  const fg = "#c9d1d9";
  const fgDim = "#8b949e";

  function statLine(text, y) {
    return `<text x="${sbX + 18}" y="${y}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="12.5" fill="${fg}">${text}</text>` +
      icon("bars", fgDim, sbX, y - 9, 11);
  }
  function sectionHeader(text, y, iconName) {
    return icon(iconName, blue, sbX, y - 10, 12) +
      `<text x="${sbX + 18}" y="${y}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="13" font-weight="600" fill="${blue}">${text}</text>`;
  }

  let sidebar = "";
  sidebar += sectionHeader("Commits streaks", sbY, "streak");
  sbY += lineGap;
  sidebar += statLine(`Best streak ${stats.best} day${stats.best === 1 ? "" : "s"}`, sbY);
  sbY += lineGap + 8;

  sidebar += sectionHeader("Commits per day", sbY, "eye");
  sbY += lineGap;
  sidebar += statLine(`Highest in a day at ${stats.max}`, sbY);
  sbY += lineGap;
  sidebar += statLine(`Average per day at ~${stats.avg.toFixed(2)}`, sbY);
  sbY += lineGap + 8;

  sidebar += sectionHeader("Total", sbY, "calendar");
  sbY += lineGap;
  sidebar += statLine(`${stats.total} contributions`, sbY);

  // ---------- Header ----------
  const header = `
    ${icon("calendar", blue, PAD, 18, 13)}
    <text x="${PAD + 20}" y="29" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="14" font-weight="600" fill="${blue}">Contributions calendar</text>
  `;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0d1117" rx="6"/>
  ${header}
  ${gridGroup}
  ${sidebar}
</svg>`;

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, svg, "utf8");
  console.log(`Wrote ${OUT_PATH} (${WIDTH}x${HEIGHT}), total=${stats.total}, best streak=${stats.best}, max=${stats.max}, avg=${stats.avg.toFixed(2)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
