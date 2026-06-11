import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, of } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { RouteBoardData, BoardStopInfo, StopPrediction, TrainBoardData } from '../../models/board.model';
import { DelayCategory, delayCategory } from '../../shared/delay.utils';

const MAX_COLS = 3;
const SOON_MINS = 5;

const HEADER_CLASS:     Record<DelayCategory, string> = { late: 'g-late',    early: 'g-early',    ontime: 'g-ontime' };
const CHIP_CLASS:       Record<DelayCategory, string> = { late: 'chip-late', early: 'chip-early', ontime: 'chip-ok' };
const CELL_CLASS:       Record<DelayCategory, string> = { late: 's-delayed', early: 's-early',    ontime: 's-ontime' };
const CARD_TIME_CLASS:  Record<DelayCategory, string> = { late: 'amber',     early: 'blue',       ontime: 'green' };
// Small late/early label shown beside a cell time; on-time cells show none.
const CELL_LABEL_CLASS: Record<DelayCategory, string | null> = { late: 'lc', early: 'ec', ontime: null };

interface ArrivalSummary {
  time: string;
  mins: number | null;
  train: TrainBoardData;
}

@Component({
  selector: 'app-train-board',
  standalone: true,
  imports: [FormsModule, NgClass],
  templateUrl: './train-board.component.html',
  styleUrls: ['./train-board.component.scss'],
})
export class TrainBoardComponent implements OnInit, OnDestroy, OnChanges {
  @Input() routeId: string | null = null;
  @Input() initialStation: string | null = null;
  @Output() stationSelected = new EventEmitter<string | null>();

  boardData: RouteBoardData | null = null;
  selectedStation: string | null = null;
  selectedDirection: 'inbound' | 'outbound' = 'inbound';
  loading = false;

  private routeId$ = new Subject<string | null>();
  private sub = new Subscription();

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.sub.add(
      this.routeId$.pipe(
        switchMap(routeId => {
          if (!routeId) return of(null);
          this.loading = true;
          return this.api.getRouteBoardData(routeId).pipe(catchError(() => of(null)));
        })
      ).subscribe(data => {
        this.loading = false;
        this.boardData = data;
        if (data && this.selectedStation) {
          const still = data.inboundStops.some(s => s.name === this.selectedStation);
          if (!still) this.selectedStation = null;
        }
      })
    );
    this.selectedStation = this.initialStation ?? null;
    this.routeId$.next(this.routeId);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['routeId'] && !changes['routeId'].isFirstChange()) {
      this.selectedStation = null;
      this.boardData = null;
      this.routeId$.next(this.routeId);
    }
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
    this.routeId$.complete();
  }

  // ── Station picker ────────────────────────────────────────────────────────

  get stationList(): string[] {
    return this.boardData?.inboundStops.map(s => s.name) ?? [];
  }

  onStationChange(value: string): void {
    this.selectedStation = value || null;
    this.stationSelected.emit(this.selectedStation);
  }

  // ── Selected stop lookup ──────────────────────────────────────────────────

  get selectedInboundStop(): BoardStopInfo | undefined {
    return this.boardData?.inboundStops.find(s => s.name === this.selectedStation);
  }

  get selectedOutboundStop(): BoardStopInfo | undefined {
    return this.boardData?.outboundStops.find(s => s.name === this.selectedStation);
  }

  // ── Approaching trains ────────────────────────────────────────────────────

  get approachingInbound(): TrainBoardData[] {
    const sel = this.selectedInboundStop;
    if (!sel || !this.boardData) return [];
    return this.boardData.trains
      .filter(t => t.directionId === 1 && t.currentStopSequence <= sel.sequence)
      .sort((a, b) => this.sortByPredAt(a, b, sel))
      .slice(0, MAX_COLS);
  }

  get approachingOutbound(): TrainBoardData[] {
    const sel = this.selectedOutboundStop;
    if (!sel || !this.boardData) return [];
    return this.boardData.trains
      .filter(t => t.directionId === 0 && t.currentStopSequence <= sel.sequence)
      .sort((a, b) => this.sortByPredAt(a, b, sel))
      .slice(0, MAX_COLS);
  }

  private sortByPredAt(a: TrainBoardData, b: TrainBoardData, stop: BoardStopInfo): number {
    const pa = this.predAt(a, stop);
    const pb = this.predAt(b, stop);
    const ta = pa?.predictedTime ?? pa?.scheduledTime ?? '9';
    const tb = pb?.predictedTime ?? pb?.scheduledTime ?? '9';
    return ta.localeCompare(tb);
  }

  // ── Stop rows ─────────────────────────────────────────────────────────────

  get inboundAllStops(): BoardStopInfo[] {
    if (!this.boardData) return [];
    return [...this.boardData.inboundStops].sort((a, b) => a.sequence - b.sequence);
  }

  get outboundAllStops(): BoardStopInfo[] {
    if (!this.boardData) return [];
    return [...this.boardData.outboundStops].sort((a, b) => a.sequence - b.sequence);
  }

  // ── Grid column templates ─────────────────────────────────────────────────

  get inboundGridCols(): string {
    const n = this.approachingInbound.length;
    return n === 0 ? '1fr' : `100px repeat(${n}, 1fr)`;
  }

  get outboundGridCols(): string {
    const n = this.approachingOutbound.length;
    return n === 0 ? '1fr' : `repeat(${n}, 1fr) 100px`;
  }

  // ── Direction labels ──────────────────────────────────────────────────────

  get inboundDest(): string {
    return (
      this.approachingInbound.find(t => t.destination)?.destination ??
      this.boardData?.trains.find(t => t.directionId === 1 && t.destination)?.destination ??
      ''
    );
  }

  get outboundDest(): string {
    return (
      this.approachingOutbound.find(t => t.destination)?.destination ??
      this.boardData?.trains.find(t => t.directionId === 0 && t.destination)?.destination ??
      ''
    );
  }

  get inboundTrainNames(): string {
    return this.approachingInbound.map(t => '#' + (t.tripName ?? t.vehicleId)).join(' · ');
  }

  get outboundTrainNames(): string {
    return this.approachingOutbound.map(t => '#' + (t.tripName ?? t.vehicleId)).join(' · ');
  }

  get inboundDirectionName(): string {
    return this.boardData?.trains.find(t => t.directionId === 1 && t.direction)?.direction ?? 'Inbound';
  }

  get outboundDirectionName(): string {
    return this.boardData?.trains.find(t => t.directionId === 0 && t.direction)?.direction ?? 'Outbound';
  }

  // ── Cell helpers ──────────────────────────────────────────────────────────

  predAt(train: TrainBoardData, stop: BoardStopInfo): StopPrediction | undefined {
    return train.predictions.find(p => p.stopId === stop.id);
  }

  isCurrentStop(train: TrainBoardData, stop: BoardStopInfo): boolean {
    return train.currentStopId === stop.id;
  }

  cellClass(train: TrainBoardData, stop: BoardStopInfo): string {
    if (this.isCurrentStop(train, stop)) return 's-here';
    const pred = this.predAt(train, stop);
    if (!pred || (!pred.predictedTime && !pred.scheduledTime)) return 's-pass';
    const time = pred.predictedTime ?? pred.scheduledTime!;
    const mins = this.minsUntil(time);
    if (mins !== null && mins <= SOON_MINS) return 's-soon';
    return CELL_CLASS[delayCategory(train.delaySeconds)];
  }

  headerClass(train: TrainBoardData): string {
    return HEADER_CLASS[delayCategory(train.delaySeconds)];
  }

  formatTime(isoString: string | null | undefined): string {
    if (!isoString) return '—';
    const dt = new Date(isoString);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  minsUntil(isoString: string | null | undefined): number | null {
    if (!isoString) return null;
    const dt = new Date(isoString);
    if (isNaN(dt.getTime())) return null;
    const diff = (dt.getTime() - Date.now()) / 60000;
    return diff > 0 ? Math.round(diff) : null;
  }

  delayLabel(train: TrainBoardData): string {
    if (train.delaySeconds === null || train.delaySeconds === undefined) return '';
    const mins = Math.round(train.delaySeconds / 60);
    if (Math.abs(mins) < 1) return '✓';
    return mins > 0 ? `+${mins}m` : `${mins}m`;
  }

  delayClass(train: TrainBoardData): string {
    return CHIP_CLASS[delayCategory(train.delaySeconds)];
  }

  delayLabelClass(train: TrainBoardData): string | null {
    return CELL_LABEL_CLASS[delayCategory(train.delaySeconds)];
  }

  // ── Arrivals banner data ──────────────────────────────────────────────────

  get nextInboundArrivals(): ArrivalSummary[] {
    const sel = this.selectedInboundStop;
    if (!sel) return [];
    return this.approachingInbound
      .map(t => {
        const pred = this.predAt(t, sel);
        const iso = pred?.predictedTime ?? pred?.scheduledTime ?? null;
        return { time: this.formatTime(iso), mins: this.minsUntil(iso), train: t };
      })
      .filter(a => a.time !== '—');
  }

  get nextOutboundArrivals(): ArrivalSummary[] {
    const sel = this.selectedOutboundStop;
    if (!sel) return [];
    return this.approachingOutbound
      .map(t => {
        const pred = this.predAt(t, sel);
        const iso = pred?.predictedTime ?? pred?.scheduledTime ?? null;
        return { time: this.formatTime(iso), mins: this.minsUntil(iso), train: t };
      })
      .filter(a => a.time !== '—');
  }

  // ── Card color class ──────────────────────────────────────────────────────

  cardTimeClass(a: ArrivalSummary): string {
    if (a.mins !== null && a.mins <= SOON_MINS) return 'gold';
    return CARD_TIME_CLASS[delayCategory(a.train.delaySeconds)];
  }
}
