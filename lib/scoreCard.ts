// Shareable score card — draws the analysis as a 1200x675 PNG on a canvas,
// zero dependencies. The artifact people actually post.
"use client";

interface CardInput {
  title: string;
  topic: string;
  scores: Record<string, number>;
  verdict: string;
  winnersUsed?: number;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawScoreCard(input: CardInput): string {
  const W = 1200, H = 675;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;

  // ground
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "rgba(245,158,11,0.08)");
  grad.addColorStop(1, "rgba(245,158,11,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(245,158,11,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, W - 48, H - 48);

  // header
  ctx.fillStyle = "#f59e0b";
  ctx.font = "600 20px -apple-system, system-ui, sans-serif";
  ctx.fillText("SCRIPT ANALYSIS", 64, 84);
  ctx.fillStyle = "#737373";
  ctx.font = "16px -apple-system, system-ui, sans-serif";
  const meta = `${input.topic || "untitled topic"}${input.winnersUsed ? `  ·  scored against ${input.winnersUsed} outlier winners` : ""}`;
  ctx.fillText(meta, 64, 110);

  // title
  ctx.fillStyle = "#fafafa";
  ctx.font = "700 34px -apple-system, system-ui, sans-serif";
  const titleLines = wrap(ctx, input.title || "Untitled script", W - 128).slice(0, 2);
  titleLines.forEach((l, i) => ctx.fillText(l, 64, 165 + i * 42));

  // scores
  const entries = Object.entries(input.scores || {});
  const avg = entries.length ? entries.reduce((a, [, v]) => a + v, 0) / entries.length : 0;
  const startY = 165 + titleLines.length * 42 + 40;
  const colW = (W - 128 - 200) / Math.max(1, entries.length);
  entries.forEach(([k, v], i) => {
    const x = 64 + i * colW;
    ctx.fillStyle = v >= 7 ? "#4ade80" : v >= 5 ? "#f59e0b" : "#f87171";
    ctx.font = "800 56px -apple-system, system-ui, sans-serif";
    ctx.fillText(String(v), x, startY + 50);
    ctx.fillStyle = "#737373";
    ctx.font = "600 13px -apple-system, system-ui, sans-serif";
    ctx.fillText(k.replace(/_/g, " ").toUpperCase(), x, startY + 76);
  });
  // overall
  const ox = 64 + entries.length * colW + 30;
  ctx.fillStyle = avg >= 7 ? "#4ade80" : avg >= 5 ? "#f59e0b" : "#f87171";
  ctx.font = "800 84px -apple-system, system-ui, sans-serif";
  ctx.fillText(avg.toFixed(1), ox, startY + 62);
  ctx.fillStyle = "#737373";
  ctx.font = "600 13px -apple-system, system-ui, sans-serif";
  ctx.fillText("OVERALL", ox + 4, startY + 88);

  // verdict
  ctx.fillStyle = "#d4d4d4";
  ctx.font = "20px -apple-system, system-ui, sans-serif";
  const verdictLines = wrap(ctx, `"${(input.verdict || "").slice(0, 320)}"`, W - 128).slice(0, 4);
  verdictLines.forEach((l, i) => ctx.fillText(l, 64, startY + 150 + i * 30));

  // footer
  ctx.fillStyle = "#525252";
  ctx.font = "15px -apple-system, system-ui, sans-serif";
  ctx.fillText("Analyzed with the AI Thumbnail & Script System — free at skool.com/aiceolab", 64, H - 56);

  return c.toDataURL("image/png");
}
