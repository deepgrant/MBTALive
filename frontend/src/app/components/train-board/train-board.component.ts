import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { NgClass } from '@angular/common';
import { Subject, Subscription, of } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { RouteBoardData, BoardStopInfo, TrainBoardData } from '../../models/board.model';
import { DelayCategory, delayCategory } from '../../shared/delay.utils';

const MAX_COLS = 3;
const SOON_MINS = 5;

const HEADER_CLASS:     Record<DelayCategory, string> = { late: 'g-late',    early: 'g-early',    ontime: 'g-ontime' };
const CHIP_CLASS:       Record<DelayCategory, string> = { late: 'chip-late', early: 'chip-early', ontime: 'chip-ok' };
const CELL_CLASS:       Record<DelayCategory, string> = { late: 's-delayed', early: 's-early',    ontime: 's-ontime' };
const CARD_TIME_CLASS:  Record<DelayCategory, string> = { late: 'amber',     early: 'blue',       ontime: 'green' };
// Small late/early label shown beside a cell time; on-time cells show none.
const CELL_LABEL_CLASS: Record<DelayCategory, string | null> = { late: 'lc', early: 'ec', ontime: null };

// View model precomputed once per poll/station/direction change so the template
// binds plain fields instead of re-running sorts and lookups every CD cycle.

interface ArrivalCard {
  key: string;        // vehicleId, for @for track
  label: string;      // "#tripName" (falls back to vehicleId)
  time: string;
  timeClass: string;
  mins: number | null;
  delayLabel: string;
  chipClass: string;
}

interface TrainColumn {
  key: string;
  title: string;      // "#tripName" (falls back to vehicleId)
  delayLabel: string;
  headerClass: string;
}

interface GridCell {
  cls: string;
  isHere: boolean;
  time: string;
  delayLabel: string;            // '' when no label is shown
  delayLabelCls: string | null;  // 'lc' | 'ec' | null
}

interface GridRow {
  stopId: string;
  stopName: string;
  selected: boolean;
  cells: GridCell[];
}

interface DirectionBoard {
  directionName: string;
  dest: string;
  trainNames: string;
  gridCols: string;
  columns: TrainColumn[];
  rows: GridRow[];
  arrivals: ArrivalCard[];
}

function emptyBoard(fallbackName: string): DirectionBoard {
  return { directionName: fallbackName, dest: '', trainNames: '', gridCols: '1fr', columns: [], rows: [], arrivals: [] };
}

@Component({
  selector: 'app-train-board',
  standalone: true,
  imports: [NgClass],
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

  stationList: string[] = [];
  inbound: DirectionBoard = emptyBoard('Inbound');
  outbound: DirectionBoard = emptyBoard('Outbound');

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
        this.rebuildDerivedState();
      })
    );
    this.selectedStation = this.initialStation ?? null;
    this.routeId$.next(this.routeId);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['routeId'] && !changes['routeId'].isFirstChange()) {
      this.selectedStation = null;
      this.boardData = null;
      this.rebuildDerivedState();
      this.routeId$.next(this.routeId);
    }
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
    this.routeId$.complete();
  }

  onStationChange(value: string): void {
    this.selectedStation = value || null;
    this.rebuildDerivedState();
    this.stationSelected.emit(this.selectedStation);
  }

  setDirection(direction: 'inbound' | 'outbound'): void {
    this.selectedDirection = direction;
  }

  // ── View-model construction ───────────────────────────────────────────────

  private rebuildDerivedState(): void {
    this.stationList = this.boardData?.inboundStops.map(s => s.name) ?? [];
    this.inbound = this.buildDirectionBoard(1, 'Inbound');
    this.outbound = this.buildDirectionBoard(0, 'Outbound');
  }

  private buildDirectionBoard(directionId: number, fallbackName: string): DirectionBoard {
    const data = this.boardData;
    if (!data) return emptyBoard(fallbackName);

    const stops = directionId === 1 ? data.inboundStops : data.outboundStops;
    const directionTrains = data.trains.filter(t => t.directionId === directionId);
    const sel = stops.find(s => s.name === this.selectedStation);

    const approaching = sel
      ? directionTrains
          .filter(t => t.currentStopSequence <= sel.sequence)
          .sort((a, b) => this.sortByPredAt(a, b, sel))
          .slice(0, MAX_COLS)
      : [];

    const allStops = [...stops].sort((a, b) => a.sequence - b.sequence);
    const n = approaching.length;

    return {
      directionName: directionTrains.find(t => t.direction)?.direction ?? fallbackName,
      dest: approaching.find(t => t.destination)?.destination
        ?? directionTrains.find(t => t.destination)?.destination
        ?? '',
      trainNames: approaching.map(t => this.trainTitle(t)).join(' · '),
      // Station-name column sits left of the train columns inbound, right of them outbound.
      gridCols: n === 0 ? '1fr' : (directionId === 1 ? `100px repeat(${n}, 1fr)` : `repeat(${n}, 1fr) 100px`),
      columns: approaching.map(t => ({
        key: t.vehicleId,
        title: this.trainTitle(t),
        delayLabel: this.delayLabel(t),
        headerClass: HEADER_CLASS[delayCategory(t.delaySeconds)],
      })),
      rows: n === 0 ? [] : allStops.map(stop => ({
        stopId: stop.id,
        stopName: stop.name,
        selected: stop.name === this.selectedStation,
        cells: approaching.map(t => this.buildCell(t, stop)),
      })),
      arrivals: sel
        ? approaching
            .map(t => this.buildArrivalCard(t, sel))
            .filter((a): a is ArrivalCard => a !== null)
        : [],
    };
  }

  private buildCell(train: TrainBoardData, stop: BoardStopInfo): GridCell {
    if (train.currentStopId === stop.id) {
      const label = this.delayLabel(train);
      return { cls: 's-here', isHere: true, time: '', delayLabel: label, delayLabelCls: label ? 'lc' : null };
    }

    const pred = train.predictions.find(p => p.stopId === stop.id);
    const iso = pred?.predictedTime ?? pred?.scheduledTime;
    let cls = 's-pass';
    if (iso) {
      const mins = this.minsUntil(iso);
      cls = mins !== null && mins <= SOON_MINS
        ? 's-soon'
        : CELL_CLASS[delayCategory(train.delaySeconds)];
    }

    const delayLabelCls = pred ? CELL_LABEL_CLASS[delayCategory(train.delaySeconds)] : null;
    return {
      cls,
      isHere: false,
      time: this.formatTime(iso),
      delayLabel: delayLabelCls ? this.delayLabel(train) : '',
      delayLabelCls,
    };
  }

  private buildArrivalCard(train: TrainBoardData, stop: BoardStopInfo): ArrivalCard | null {
    const pred = train.predictions.find(p => p.stopId === stop.id);
    const iso = pred?.predictedTime ?? pred?.scheduledTime ?? null;
    const time = this.formatTime(iso);
    if (time === '—') return null;

    const mins = this.minsUntil(iso);
    return {
      key: train.vehicleId,
      label: this.trainTitle(train),
      time,
      timeClass: mins !== null && mins <= SOON_MINS
        ? 'gold'
        : CARD_TIME_CLASS[delayCategory(train.delaySeconds)],
      mins,
      delayLabel: this.delayLabel(train),
      chipClass: CHIP_CLASS[delayCategory(train.delaySeconds)],
    };
  }

  // ── Formatting helpers ────────────────────────────────────────────────────

  private trainTitle(train: TrainBoardData): string {
    return '#' + (train.tripName ?? train.vehicleId);
  }

  private sortByPredAt(a: TrainBoardData, b: TrainBoardData, stop: BoardStopInfo): number {
    const pa = a.predictions.find(p => p.stopId === stop.id);
    const pb = b.predictions.find(p => p.stopId === stop.id);
    const ta = pa?.predictedTime ?? pa?.scheduledTime ?? '9';
    const tb = pb?.predictedTime ?? pb?.scheduledTime ?? '9';
    return ta.localeCompare(tb);
  }

  private formatTime(isoString: string | null | undefined): string {
    if (!isoString) return '—';
    const dt = new Date(isoString);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  private minsUntil(isoString: string | null | undefined): number | null {
    if (!isoString) return null;
    const dt = new Date(isoString);
    if (isNaN(dt.getTime())) return null;
    const diff = (dt.getTime() - Date.now()) / 60000;
    return diff > 0 ? Math.round(diff) : null;
  }

  private delayLabel(train: TrainBoardData): string {
    if (train.delaySeconds === null || train.delaySeconds === undefined) return '';
    const mins = Math.round(train.delaySeconds / 60);
    if (Math.abs(mins) < 1) return '✓';
    return mins > 0 ? `+${mins}m` : `${mins}m`;
  }
}
