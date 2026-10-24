// dev ページの簡易グラフ（canvas に直近の値を折れ線で描く）．
// 値は起動時に確保した Float32Array のリングバッファに書き込むだけにする（イベントごとに配列を作らない）
export interface StripSeries {
  readonly name: string;
  readonly color: string;
}

export class StripChart {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly values: Float32Array[];
  private head = 0;
  private count = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly series: readonly StripSeries[],
    /** 残す点の数（60 Hz で 5 秒なら 300） */
    private readonly capacity: number,
    /** 縦軸の範囲（± range） */
    private readonly range: number,
  ) {
    this.ctx = canvas.getContext("2d");
    this.values = series.map(() => new Float32Array(capacity));
  }

  /** 1 点分を足す（values は series の順．NaN は線を切る） */
  push(...values: number[]): void {
    for (let i = 0; i < this.values.length; i++)
      this.values[i][this.head] = values[i] ?? Number.NaN;
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  draw(): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    // 表示の大きさに合わせて解像度を決める（高解像度の端末でにじまないように）
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    const xStep = w / Math.max(1, this.capacity - 1);
    const start = (this.head - this.count + this.capacity) % this.capacity;
    const offset = this.capacity - this.count;
    ctx.lineWidth = 1.5 * dpr;
    this.series.forEach((s, si) => {
      const data = this.values[si];
      ctx.strokeStyle = s.color;
      ctx.beginPath();
      let drawing = false;
      for (let i = 0; i < this.count; i++) {
        const v = data[(start + i) % this.capacity];
        if (!Number.isFinite(v)) {
          drawing = false;
          continue;
        }
        const clamped = Math.max(-this.range, Math.min(this.range, v));
        const x = (offset + i) * xStep;
        const y = h / 2 - (clamped / this.range) * (h / 2);
        if (drawing) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        drawing = true;
      }
      ctx.stroke();
    });

    ctx.font = `${12 * dpr}px sans-serif`;
    this.series.forEach((s, si) => {
      ctx.fillStyle = s.color;
      ctx.fillText(s.name, 6 * dpr, (14 + si * 14) * dpr);
    });
    ctx.fillStyle = "#888";
    ctx.fillText(`±${this.range}`, w - 40 * dpr, 14 * dpr);
  }
}
