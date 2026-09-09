import { ContentPair } from '../types';

export interface OverlayOptions {
  structure: string;
  explanation: string;
  pair: ContentPair;
  revealAnswer: boolean;
}

/**
 * Renders a 720x1280 overlay PNG as a Uint8Array using Canvas 2D.
 */
export async function renderOverlayPNG(options: OverlayOptions): Promise<Uint8Array> {
  const { structure, explanation, pair, revealAnswer } = options;

  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 1280;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  // Clear canvas (transparent background for overlay)
  ctx.clearRect(0, 0, 720, 1280);

  // 1. Orange Box: (65, 282) to (655, 464) -> x=65, y=282, w=590, h=182
  const orangeX = 65;
  const orangeY = 282;
  const orangeW = 590;
  const orangeH = 182;
  const orangeRadius = 20;

  drawRoundedRect(ctx, orangeX, orangeY, orangeW, orangeH, orangeRadius, '#EA580C');

  // Orange box subtle border
  ctx.strokeStyle = '#F97316';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Formula centered in Orange Box
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Dynamic font sizing for structure if very long
  const structureFontSize = structure.length > 30 ? 32 : 38;
  ctx.font = `bold ${structureFontSize}px system-ui, -apple-system, sans-serif`;

  const structureCenterY = explanation ? orangeY + 68 : orangeY + orangeH / 2;
  ctx.fillText(structure, orangeX + orangeW / 2, structureCenterY, orangeW - 40);

  // Explanation in Orange Box (max 2 lines)
  if (explanation) {
    ctx.font = '500 24px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    wrapText(ctx, explanation, orangeX + orangeW / 2, orangeY + 120, orangeW - 48, 30, 2);
  }
  ctx.restore();

  // 2. Black Box: (58, 540) to (662, 874) -> x=58, y=540, w=604, h=334
  const blackX = 58;
  const blackY = 540;
  const blackW = 604;
  const blackH = 334;
  const blackRadius = 24;

  drawRoundedRect(ctx, blackX, blackY, blackW, blackH, blackRadius, 'rgba(10, 15, 26, 0.92)');

  // Black box border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Vietnamese question text: white, bold, ~44px, x near 82, y near 582
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 44px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const viX = 82;
  const viY = 582;
  const viMaxW = blackW - 48; // ~556px
  wrapText(ctx, pair.vi, viX, viY, viMaxW, 54, 2);
  ctx.restore();

  // Fixed white divider under question: y ~ 668
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(blackX + 24, 668);
  ctx.lineTo(blackX + blackW - 24, 668);
  ctx.stroke();
  ctx.restore();

  // English answer: RGB near (183, 184, 186) -> #B7B8BA, ~43px, centered at y near 713
  if (revealAnswer) {
    ctx.save();
    ctx.fillStyle = 'rgb(183, 184, 186)';
    ctx.font = '600 43px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const enCenterX = blackX + blackW / 2;
    const enY = 705;
    wrapText(ctx, pair.en, enCenterX, enY, blackW - 48, 52, 2);
    ctx.restore();
  }

  // 3. Yellow CTA around y=934 and y=976:
  // "Xem bình luận để được hướng dẫn"
  // "phát âm chuẩn các câu trên nhé"
  ctx.save();
  ctx.fillStyle = '#FACC15';
  ctx.font = 'bold 30px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const ctaCenterX = 360;
  ctx.fillText('Vào nhóm trong bình luận để', ctaCenterX, 934);
  ctx.fillText('luyện nghe - nói cùng Hà', ctaCenterX, 976);
  ctx.restore();

  // Convert canvas to PNG blob -> Uint8Array
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to export canvas to PNG blob'));
        return;
      }
      blob
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(reject);
    }, 'image/png');
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fillColor: string
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();

  ctx.fillStyle = fillColor;
  ctx.fill();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 2
) {
  const words = text.split(' ');
  let line = '';
  let lineCount = 0;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;

    if (testWidth > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, y + lineCount * lineHeight);
      line = words[n] + ' ';
      lineCount++;
      if (lineCount >= maxLines - 1) {
        // If this is the last allowed line, append remaining words with ellipsis if needed
        const remaining = words.slice(n).join(' ');
        let fitText = remaining;
        while (ctx.measureText(fitText + '...').width > maxWidth && fitText.length > 0) {
          fitText = fitText.slice(0, -1);
        }
        ctx.fillText(fitText.trim() + (fitText.length < remaining.length ? '...' : ''), x, y + lineCount * lineHeight);
        return;
      }
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), x, y + lineCount * lineHeight);
}
