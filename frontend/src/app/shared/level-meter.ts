import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-level-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="meter"
      role="meter"
      aria-label="Microphone input level"
      [attr.aria-valuenow]="Math.round(level() * 100)"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div class="track">
        <div class="mask" [style.left.%]="filled()"></div>
      </div>
      <span class="clip" [class.lit]="clipping()" title="Clipping">CLIP</span>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .meter {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .track {
      position: relative;
      flex: 1;
      height: 10px;
      border-radius: 999px;
      overflow: hidden;
      background: linear-gradient(
        to right,
        var(--cadence-score-good) 0 60%,
        var(--cadence-score-mid) 60% 85%,
        var(--cadence-score-bad) 85% 100%
      );
    }
    .mask {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      background: var(--mat-sys-surface-container-highest);
      transition: left 90ms linear;
    }
    .clip {
      font: var(--mat-sys-label-small);
      letter-spacing: 0.06em;
      padding: 1px 6px;
      border-radius: 4px;
      color: var(--mat-sys-on-surface-variant);
      background: var(--mat-sys-surface-container-highest);
      transition: background-color 120ms ease;
    }
    .clip.lit {
      color: var(--mat-sys-on-error);
      background: var(--mat-sys-error);
    }
  `,
})
export class LevelMeter {
  readonly level = input(0);
  readonly clipping = input(false);

  protected readonly Math = Math;

  protected readonly filled = computed(() => Math.min(100, Math.max(0, this.level() * 100)));
}
