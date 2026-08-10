import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import { TtsService } from '../core/tts.service';

@Component({
  selector: 'app-speak-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  template: `
    @if (providers().length > 1) {
      <button
        matIconButton
        [matMenuTriggerFor]="voiceMenu"
        [disabled]="busy()"
        [matTooltip]="'Hear “' + text() + '” (choose a voice)'"
        [attr.aria-label]="'Hear ' + text() + ' pronounced, choose a voice'"
      >
        @if (busy()) {
          <mat-spinner diameter="18" />
        } @else {
          <mat-icon>volume_up</mat-icon>
        }
      </button>
      <mat-menu #voiceMenu="matMenu">
        @for (provider of providers(); track provider.id) {
          <button mat-menu-item (click)="speak(provider.id)">
            <mat-icon>volume_up</mat-icon>
            <span class="menu-provider">{{ provider.label }}</span>
            <span class="menu-voice">{{ voiceName(provider.id) }}</span>
          </button>
        }
      </mat-menu>
    } @else if (providers().length === 1) {
      <button
        matIconButton
        (click)="speak(providers()[0].id)"
        [disabled]="busy()"
        [matTooltip]="'Hear “' + text() + '” with ' + voiceName(providers()[0].id)"
        [attr.aria-label]="'Hear ' + text() + ' pronounced'"
      >
        @if (busy()) {
          <mat-spinner diameter="18" />
        } @else {
          <mat-icon>volume_up</mat-icon>
        }
      </button>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .menu-provider {
      font: var(--mat-sys-body-medium);
    }
    .menu-voice {
      margin-left: 8px;
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class SpeakButton {
  readonly text = input.required<string>();

  private readonly tts = inject(TtsService);

  protected readonly providers = this.tts.usableProviders;

  protected readonly busy = computed(() =>
    this.providers().some((provider) => this.tts.isPending(provider.id, this.text())),
  );

  protected voiceName(providerId: string): string {
    return this.tts.selectedVoiceFor(providerId)?.name ?? '-';
  }

  protected speak(providerId: string): void {
    void this.tts.speak(providerId, this.text());
  }
}
