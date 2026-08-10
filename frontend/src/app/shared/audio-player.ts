import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';

import { PlaybackSettingsService, RATE_STEPS } from '../core/playback-settings.service';
import { PcmRecording, WavePeak } from '../core/recording';
import { ThemeService } from '../core/theme.service';

const BAR_WIDTH = 2;
const BAR_GAP = 1;
const WAVE_HEIGHT = 56;
const EDGE_GRAB_PX = 6;
const DRAG_THRESHOLD_PX = 4;
const MIN_SELECTION_SEC = 0.1;

interface TimeRange {
  start: number;
  end: number;
}

type DragMode = 'new' | 'start' | 'end';

interface DragState {
  mode: DragMode;
  anchorSec: number;
  moved: boolean;
}

@Component({
  selector: 'app-audio-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule],
  template: `
    <div class="player">
      <button
        matIconButton
        class="play-button"
        (click)="toggle()"
        [matTooltip]="selection() ? 'Play the selected range' : 'Play'"
        [attr.aria-label]="playing() ? 'Pause' : 'Play recording'"
      >
        <mat-icon>{{ playing() ? 'pause' : 'play_arrow' }}</mat-icon>
      </button>
      <div class="wave-wrap">
        <canvas
          #canvas
          (pointerdown)="onPointerDown($event)"
          (pointermove)="onPointerMove($event)"
          (pointerup)="onPointerUp($event)"
          (pointercancel)="onPointerCancel()"
        ></canvas>
      </div>
      <div class="time-col">
        <span class="time">{{ timeLabel() }}</span>
        @if (selectionLabel(); as label) {
          <span class="selection-label">{{ label }}</span>
        }
      </div>
      <button
        matIconButton
        [matMenuTriggerFor]="actionsMenu"
        matTooltip="Player actions"
        aria-label="Player actions"
      >
        <mat-icon>more_vert</mat-icon>
      </button>
      <mat-menu #actionsMenu="matMenu">
        <button mat-menu-item [matMenuTriggerFor]="rateMenu">
          <mat-icon>speed</mat-icon>
          <span>Speed</span>
          <span class="menu-value">{{ formatRate(rate()) }}</span>
        </button>
        @if (selection()) {
          <button mat-menu-item (click)="clearSelection()">
            <mat-icon>deselect</mat-icon>
            <span>Clear selection</span>
          </button>
        }
        <button mat-menu-item (click)="download()">
          <mat-icon>download</mat-icon>
          <span>{{ selection() ? 'Download selection' : 'Download recording' }}</span>
        </button>
      </mat-menu>
      <mat-menu #rateMenu="matMenu">
        @for (step of rateSteps; track step) {
          <button mat-menu-item (click)="setRate(step)">
            <mat-icon>{{ rate() === step ? 'check' : '' }}</mat-icon>
            <span>{{ formatRate(step) }}</span>
          </button>
        }
      </mat-menu>
    </div>
    <p class="hint">Drag on the wave to select a fragment; drag its edges to adjust.</p>
  `,
  styles: `
    .player {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .wave-wrap {
      flex: 1;
      min-width: 0;
    }
    canvas {
      display: block;
      width: 100%;
      height: ${WAVE_HEIGHT}px;
      cursor: crosshair;
      touch-action: none;
      color: var(--mat-sys-primary);
      outline-color: var(--mat-sys-outline-variant);
    }
    .time-col {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
    }
    .menu-value {
      margin-left: auto;
      padding-left: 12px;
      font-variant-numeric: tabular-nums;
      color: var(--mat-sys-on-surface-variant);
    }
    @media (max-width: 600px) {
      .player {
        gap: 6px;
      }
      .time,
      .selection-label {
        font-size: 11px;
      }
    }
    .time {
      font: var(--mat-sys-label-medium);
      font-variant-numeric: tabular-nums;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
    .selection-label {
      font: var(--mat-sys-label-small);
      font-variant-numeric: tabular-nums;
      color: var(--mat-sys-primary);
      white-space: nowrap;
    }
    .hint {
      margin: 6px 0 0;
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-outline);
    }
  `,
})
export class AudioPlayer implements OnDestroy {
  readonly recording = input.required<PcmRecording>();
  readonly langCode = input('');
  readonly labelText = input('');

  private readonly theme = inject(ThemeService);
  protected readonly playback = inject(PlaybackSettingsService);
  protected readonly rateSteps = RATE_STEPS;

  protected readonly rate = signal(this.playback.playbackRate());
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  protected readonly playing = signal(false);
  protected readonly positionSec = signal(0);
  protected readonly selection = signal<TimeRange | null>(null);

  protected readonly timeLabel = computed(
    () => `${this.format(this.positionSec())} / ${this.format(this.recording().durationSeconds)}`,
  );

  protected readonly selectionLabel = computed(() => {
    const range = this.selection();
    if (!range) {
      return null;
    }
    return `${this.formatPrecise(range.start)} – ${this.formatPrecise(range.end)}`;
  });

  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private peaksCache: { buckets: number; peaks: WavePeak[] } | null = null;
  private frame = 0;
  private resizeObserver: ResizeObserver | null = null;
  private drag: DragState | null = null;

  constructor() {
    effect((onCleanup) => {
      const recording = this.recording();
      this.setUpAudio(recording);
      onCleanup(() => this.tearDownAudio());
    });
    effect(() => {
      this.rate();
      this.applyRate();
    });
    effect(() => {
      this.theme.effectiveScheme();
      this.selection();
      this.scheduleDraw();
    });
    afterNextRender(() => {
      this.resizeObserver = new ResizeObserver(() => this.scheduleDraw());
      this.resizeObserver.observe(this.canvasRef().nativeElement.parentElement!);
      this.scheduleDraw();
    });
  }

  protected setRate(step: number): void {
    this.rate.set(step);
    this.playback.setPlaybackRate(step);
  }

  protected formatRate(rate: number): string {
    return `${rate}\u00d7`;
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.tearDownAudio();
  }

  protected toggle(): void {
    if (!this.audio) {
      return;
    }
    if (this.playing()) {
      this.audio.pause();
      this.playing.set(false);
      return;
    }
    const range = this.selection();
    if (range) {
      const position = this.positionSec();
      if (position < range.start - 0.01 || position >= range.end - 0.05) {
        this.audio.currentTime = range.start;
        this.positionSec.set(range.start);
      }
    } else if (this.audio.ended) {
      this.audio.currentTime = 0;
    }
    void this.audio
      .play()
      .then(() => {
        this.playing.set(true);
        this.tick();
      })
      .catch(() => this.playing.set(false));
  }

  protected clearSelection(): void {
    this.selection.set(null);
  }

  protected download(): void {
    const range = this.selection();
    const blob = this.recording().toWavBlob(range?.start, range?.end);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = this.downloadFileName();
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  private downloadFileName(): string {
    const now = new Date();
    const pad = (value: number) => value.toString().padStart(2, '0');
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const parts = [stamp];
    if (this.langCode()) {
      parts.push(this.langCode());
    }
    const slug = this.slugify(this.labelText());
    if (slug) {
      parts.push(slug);
    }
    return `${parts.join('-')}.wav`;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 15)
      .replace(/-+$/g, '');
  }

  private tick(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (!this.audio || !this.playing()) {
        return;
      }
      const range = this.selection();
      if (range && this.audio.currentTime >= range.end) {
        this.audio.pause();
        this.audio.currentTime = range.start;
        this.playing.set(false);
        this.positionSec.set(range.start);
        this.scheduleDraw();
        return;
      }
      this.positionSec.set(this.audio.currentTime);
      this.draw();
      this.tick();
    });
  }

  protected onPointerDown(event: PointerEvent): void {
    const canvas = this.canvasRef().nativeElement;
    canvas.setPointerCapture(event.pointerId);
    const { seconds, x, width } = this.locate(event);
    const range = this.selection();
    let mode: DragMode = 'new';
    if (range) {
      const startX = this.secondsToX(range.start, width);
      const endX = this.secondsToX(range.end, width);
      if (Math.abs(x - startX) <= EDGE_GRAB_PX) {
        mode = 'start';
      } else if (Math.abs(x - endX) <= EDGE_GRAB_PX) {
        mode = 'end';
      }
    }
    this.drag = { mode, anchorSec: seconds, moved: false };
  }

  protected onPointerMove(event: PointerEvent): void {
    const canvas = this.canvasRef().nativeElement;
    if (!this.drag) {
      canvas.style.cursor = this.hoverCursor(event);
      return;
    }
    const { seconds, x, width } = this.locate(event);
    if (!this.drag.moved) {
      const anchorX = this.secondsToX(this.drag.anchorSec, width);
      if (Math.abs(x - anchorX) < DRAG_THRESHOLD_PX) {
        return;
      }
      this.drag.moved = true;
    }
    switch (this.drag.mode) {
      case 'new':
        this.selection.set(this.normalize(this.drag.anchorSec, seconds));
        break;
      case 'start': {
        const range = this.selection();
        if (range) {
          this.selection.set(this.normalize(seconds, range.end));
        }
        break;
      }
      case 'end': {
        const range = this.selection();
        if (range) {
          this.selection.set(this.normalize(range.start, seconds));
        }
        break;
      }
    }
  }

  protected onPointerUp(event: PointerEvent): void {
    if (!this.drag) {
      return;
    }
    const drag = this.drag;
    this.drag = null;
    if (!drag.moved) {
      this.seekTo(this.locate(event).seconds);
      return;
    }
    const range = this.selection();
    if (range && range.end - range.start < MIN_SELECTION_SEC) {
      this.selection.set(null);
      this.seekTo(drag.anchorSec);
    }
  }

  protected onPointerCancel(): void {
    this.drag = null;
  }

  private hoverCursor(event: PointerEvent): string {
    const range = this.selection();
    if (!range) {
      return 'crosshair';
    }
    const { x, width } = this.locate(event);
    const startX = this.secondsToX(range.start, width);
    const endX = this.secondsToX(range.end, width);
    if (Math.abs(x - startX) <= EDGE_GRAB_PX || Math.abs(x - endX) <= EDGE_GRAB_PX) {
      return 'col-resize';
    }
    return 'crosshair';
  }

  private seekTo(seconds: number): void {
    if (!this.audio) {
      return;
    }
    this.audio.currentTime = seconds;
    this.positionSec.set(seconds);
    this.scheduleDraw();
  }

  private normalize(a: number, b: number): TimeRange {
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }

  private locate(event: PointerEvent): { seconds: number; x: number; width: number } {
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const fraction = Math.min(Math.max(x / rect.width, 0), 1);
    return { seconds: fraction * this.recording().durationSeconds, x, width: rect.width };
  }

  private secondsToX(seconds: number, width: number): number {
    const duration = this.recording().durationSeconds;
    return duration > 0 ? (seconds / duration) * width : 0;
  }

  private setUpAudio(recording: PcmRecording): void {
    this.tearDownAudio();
    this.objectUrl = URL.createObjectURL(recording.toWavBlob());
    this.audio = new Audio(this.objectUrl);
    this.audio.preload = 'auto';
    this.applyRate();
    this.audio.onended = () => {
      this.playing.set(false);
      this.positionSec.set(recording.durationSeconds);
      this.scheduleDraw();
    };
    this.playing.set(false);
    this.positionSec.set(0);
    this.selection.set(null);
    this.peaksCache = null;
    this.scheduleDraw();
  }

  private applyRate(): void {
    if (!this.audio) {
      return;
    }
    this.audio.preservesPitch = true;
    this.audio.playbackRate = untracked(this.rate);
  }

  private tearDownAudio(): void {
    this.audio?.pause();
    this.audio = null;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private scheduleDraw(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  private draw(): void {
    const canvas = this.canvasRef().nativeElement;
    const width = canvas.parentElement?.clientWidth ?? 0;
    if (width === 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(WAVE_HEIGHT * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, WAVE_HEIGHT);

    const buckets = Math.max(1, Math.floor(width / (BAR_WIDTH + BAR_GAP)));
    if (!this.peaksCache || this.peaksCache.buckets !== buckets) {
      this.peaksCache = { buckets, peaks: this.recording().peaks(buckets) };
    }

    const styles = getComputedStyle(canvas);
    const primary = styles.color;
    const muted = styles.outlineColor;

    const duration = this.recording().durationSeconds;
    const playedX = duration > 0 ? (this.positionSec() / duration) * width : 0;
    const range = this.selection();
    const selStartX = range ? this.secondsToX(range.start, width) : 0;
    const selEndX = range ? this.secondsToX(range.end, width) : 0;

    if (range) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = primary;
      ctx.fillRect(selStartX, 0, selEndX - selStartX, WAVE_HEIGHT);
      ctx.globalAlpha = 1;
    }

    const mid = WAVE_HEIGHT / 2;
    const amplitude = mid - 2;
    for (let i = 0; i < this.peaksCache.peaks.length; i++) {
      const peak = this.peaksCache.peaks[i];
      const x = i * (BAR_WIDTH + BAR_GAP);
      const center = x + BAR_WIDTH / 2;
      const top = mid - peak.max * amplitude;
      const height = Math.max((peak.max - peak.min) * amplitude, 2);
      const outsideSelection = range !== null && (center < selStartX || center > selEndX);
      ctx.globalAlpha = outsideSelection ? 0.35 : 1;
      ctx.fillStyle = center <= playedX ? primary : muted;
      ctx.fillRect(x, top, BAR_WIDTH, height);
    }
    ctx.globalAlpha = 1;

    if (range) {
      ctx.fillStyle = primary;
      for (const edgeX of [selStartX, selEndX]) {
        ctx.fillRect(edgeX - 1, 0, 2, WAVE_HEIGHT);
        ctx.beginPath();
        ctx.roundRect(edgeX - 3, mid - 7, 6, 14, 3);
        ctx.fill();
      }
    }

    ctx.fillStyle = primary;
    ctx.fillRect(Math.min(playedX, width - 2), 0, 2, WAVE_HEIGHT);
  }

  private format(seconds: number): string {
    const total = Math.floor(seconds);
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return `${minutes}:${rest.toString().padStart(2, '0')}`;
  }

  private formatPrecise(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
  }
}
