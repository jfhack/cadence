import { TestBed } from '@angular/core/testing';
import { Injectable, inject, signal } from '@angular/core';

import { persistOnChange } from './persist';

@Injectable()
class Probe {
  readonly value = signal(inject(START));
  readonly writes: string[] = [];

  constructor() {
    persistOnChange(this.value, (v) => this.writes.push(v));
  }
}

import { InjectionToken } from '@angular/core';
const START = new InjectionToken<string>('start');

function probe(start: string): Probe {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [Probe, { provide: START, useValue: start }],
  });
  return TestBed.inject(Probe);
}

describe('persistOnChange', () => {
  it('writes nothing when the value is only ever the restored one', () => {
    const p = probe('stored');
    TestBed.tick();
    expect(p.writes).toEqual([]);
  });

  it('writes once the value actually changes', () => {
    const p = probe('stored');
    p.value.set('edited');
    TestBed.tick();
    expect(p.writes).toEqual(['edited']);
  });

  it('catches a change made before the first flush', () => {
    const p = probe('stored');
    p.value.set('edited');
    TestBed.tick();
    expect(p.writes).toEqual(['edited']);
  });

  it('still writes when the value returns to its original', () => {
    const p = probe('stored');
    p.value.set('edited');
    TestBed.tick();
    p.value.set('stored');
    TestBed.tick();
    expect(p.writes).toEqual(['edited', 'stored']);
  });
});
