import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const CIRCUMFERENCE = 2 * Math.PI * 45;

@Component({
  selector: 'app-score-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gauge" [class.primary]="primary()">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="track" cx="50" cy="50" r="45" />
        @if (score() !== null && score() !== undefined) {
          <circle
            class="value"
            [class]="scoreClass()"
            cx="50"
            cy="50"
            r="45"
            [style.stroke-dasharray]="dash()"
          />
        }
      </svg>
      <div class="text">
        <span class="score">{{ display() }}</span>
        <span class="label">{{ label() }}</span>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .gauge {
      position: relative;
      width: 92px;
      aspect-ratio: 1;
    }
    .gauge.primary {
      width: 132px;
    }
    svg {
      width: 100%;
      height: 100%;
      transform: rotate(-90deg);
    }
    circle {
      fill: none;
      stroke-width: 8;
      stroke-linecap: round;
    }
    .track {
      stroke: var(--mat-sys-surface-container-highest);
    }
    .value {
      transition: stroke-dasharray 600ms ease;
    }
    .value.good {
      stroke: var(--cadence-score-good);
    }
    .value.mid {
      stroke: var(--cadence-score-mid);
    }
    .value.bad {
      stroke: var(--cadence-score-bad);
    }
    .text {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      text-align: center;
    }
    .score {
      font: var(--mat-sys-title-medium);
      font-variant-numeric: tabular-nums;
    }
    .primary .score {
      font: var(--mat-sys-headline-medium);
    }
    .label {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
      max-width: 90%;
    }
  `,
})
export class ScoreGauge {
  readonly score = input<number | null | undefined>(null);
  readonly label = input('');
  readonly primary = input(false);

  protected readonly display = computed(() => {
    const value = this.score();
    return value === null || value === undefined ? '-' : Math.round(value).toString();
  });

  protected readonly scoreClass = computed(() => {
    const value = this.score() ?? 0;
    return value >= 80 ? 'good' : value >= 60 ? 'mid' : 'bad';
  });

  protected readonly dash = computed(() => {
    const value = Math.max(0, Math.min(100, this.score() ?? 0));
    return `${(value / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`;
  });
}
