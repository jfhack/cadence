import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { TtsVoice } from '../core/models';
import { TtsService } from '../core/tts.service';

@Component({
  selector: 'app-voice-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatAutocompleteModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <mat-form-field appearance="outline" class="voice-field" subscriptSizing="dynamic">
      <mat-label>{{ label() }}</mat-label>
      <input
        #voiceInput
        matInput
        type="text"
        [ngModel]="display()"
        (ngModelChange)="draft.set($event)"
        [matAutocomplete]="voiceAuto"
        [disabled]="disabled()"
        (input)="query.set(voiceInput.value)"
        (focus)="voiceInput.select()"
        placeholder="Type to search voices…"
      />
      <mat-icon matSuffix>arrow_drop_down</mat-icon>
      <mat-autocomplete
        #voiceAuto="matAutocomplete"
        requireSelection
        [displayWith]="labelFor"
        (optionSelected)="choose($event)"
        (closed)="query.set('')"
      >
        @for (group of groups(); track group.label) {
          <mat-optgroup [label]="group.label">
            @for (voice of group.voices; track voice.id) {
              <mat-option [value]="voice">
                <span class="voice-name">{{ voice.name }}</span>
                <span class="voice-meta">
                  {{ voice.locale || 'any language' }}
                  @if (voice.gender) {
                    · {{ voice.gender }}
                  }
                </span>
              </mat-option>
            }
          </mat-optgroup>
        } @empty {
          <mat-option disabled>No voice matches</mat-option>
        }
      </mat-autocomplete>
    </mat-form-field>
  `,
  styles: `
    :host {
      display: block;
    }
    .voice-field {
      width: 100%;
    }
    .voice-name {
      font: var(--mat-sys-body-medium);
    }
    .voice-meta {
      margin-left: 8px;
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class VoicePicker {
  readonly providerId = input.required<string>();
  readonly label = input('Voice');
  readonly locale = input('');
  readonly disabled = input(false);

  protected readonly tts = inject(TtsService);
  protected readonly query = signal('');
  protected readonly draft = signal<TtsVoice | string | null>(null);

  protected readonly groups = computed(() =>
    this.tts.groupsFor(this.providerId(), this.locale(), this.query()),
  );

  protected readonly display = computed<TtsVoice | string | null>(
    () => this.tts.selectedVoiceFor(this.providerId()) ?? this.draft(),
  );

  protected readonly labelFor = (value: TtsVoice | string | null): string =>
    typeof value === 'object' && value !== null ? value.name : (value ?? '');

  protected choose(event: MatAutocompleteSelectedEvent): void {
    this.tts.setVoice(this.providerId(), (event.option.value as TtsVoice).id);
    this.query.set('');
  }
}
