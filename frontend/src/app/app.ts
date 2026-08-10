import { Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ThemeMode, ThemeService } from './core/theme.service';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    MatIconModule,
    MatMenuModule,
    MatToolbarModule,
    MatButtonModule,
    MatTooltipModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly theme = inject(ThemeService);

  protected readonly themeOptions: { mode: ThemeMode; label: string; icon: string }[] = [
    { mode: 'system', label: 'System', icon: 'brightness_auto' },
    { mode: 'light', label: 'Light', icon: 'light_mode' },
    { mode: 'dark', label: 'Dark', icon: 'dark_mode' },
  ];

  protected readonly themeIcon = computed(
    () => this.themeOptions.find((option) => option.mode === this.theme.mode())!.icon,
  );

  protected readonly logoSrc = computed(() =>
    this.theme.effectiveScheme() === 'dark' ? 'logo/cadence-dark.svg' : 'logo/cadence-light.svg',
  );
}
